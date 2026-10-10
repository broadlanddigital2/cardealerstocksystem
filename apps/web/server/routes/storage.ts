import { Router, type Request, type Response } from "../http";
import {
  RequestUploadUrlBody,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError, MAX_UPLOAD_BYTES } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { requireAuth, getSessionUserId } from "../middlewares/requireAuth";

const router = new Router();
const objectStorageService = new ObjectStorageService();

const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const SAFE_SERVE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

// ---------------------------------------------------------------------------
// Per-user rate limit on upload URL issuance
// ---------------------------------------------------------------------------
const UPLOAD_URL_RATE_LIMIT = 10;
const UPLOAD_URL_RATE_WINDOW_MS = 60_000;

interface RateLimitEntry {
  count: number;
  windowStart: number;
}
const uploadUrlRateLimitMap = new Map<string, RateLimitEntry>();

function checkUploadUrlRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = uploadUrlRateLimitMap.get(userId);
  if (!entry || now - entry.windowStart >= UPLOAD_URL_RATE_WINDOW_MS) {
    uploadUrlRateLimitMap.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= UPLOAD_URL_RATE_LIMIT) {
    return false;
  }
  entry.count += 1;
  return true;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /storage/uploads/request-url
 *
 * Issues a short-lived, HMAC-signed upload token and returns a server-side
 * upload URL (PUT /storage/uploads/direct/:token). The client then PUTs the
 * file body directly to that URL — uploads never go to GCS presigned URLs,
 * so the server can enforce the byte limit on the incoming stream.
 */
router.post(
  "/storage/uploads/request-url",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    const { name, size, contentType } = parsed.data;

    if (size > MAX_UPLOAD_BYTES) {
      res.status(400).json({
        error: `File too large. Maximum allowed size is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      });
      return;
    }

    if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(contentType)) {
      res.status(400).json({
        error:
          "Unsupported file type. Only JPEG, PNG, GIF, and WebP images are allowed.",
      });
      return;
    }

    const sessionUserId = getSessionUserId(req) ?? "unknown";
    if (!checkUploadUrlRateLimit(sessionUserId)) {
      res.status(429).json({
        error: "Too many upload URL requests. Please try again shortly.",
      });
      return;
    }

    const objectId = crypto.randomUUID();
    const objectPath = `/objects/uploads/${objectId}`;
    let uploadURL: string;
    try {
      // Browser PUTs the file straight to Supabase Storage via this signed URL.
      uploadURL = await objectStorageService.createSignedUploadUrl(objectId);
    } catch (err) {
      req.log.error({ err }, "Failed to create signed upload URL");
      res.status(500).json({ error: "Uploads are not available right now." });
      return;
    }

    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Kept for API compatibility; the app stores no "public search path" assets in
 * Supabase, so this always 404s.
 */
router.get("/storage/public-objects/*filePath", async (_req: Request, res: Response) => {
  res.status(404).json({ error: "File not found" });
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get(
  "/storage/objects/*path",
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
      const objectPath = `/objects/${wildcardPath}`;
      const objectFile =
        await objectStorageService.getObjectEntityFile(objectPath);

      // Only serve objects that carry an explicit ACL policy. Logos are stored as
      // public-read, so they render in <img> tags without auth; any object lacking
      // a policy (or private to another tenant) is denied.
      const userId = req.userId;
      const canAccess = await objectStorageService.canAccessObjectEntity({
        userId,
        objectFile,
        requestedPermission: ObjectPermission.READ,
      });
      if (!canAccess) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const response = await objectStorageService.downloadObject(objectFile);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      const servedContentType =
        response.headers.get("Content-Type") || "application/octet-stream";
      if (!SAFE_SERVE_CONTENT_TYPES.has(servedContentType)) {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", "attachment");
      }
      res.setHeader("X-Content-Type-Options", "nosniff");

      res.stream(response.body);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        req.log.warn({ err: error }, "Object not found");
        res.status(404).json({ error: "Object not found" });
        return;
      }
      req.log.error({ err: error }, "Error serving object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  },
);

export default router;
