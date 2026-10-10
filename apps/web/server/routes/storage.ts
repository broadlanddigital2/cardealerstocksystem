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
      // Supabase issues a signed, single-use upload token for this object. The
      // browser PUTs to our own same-origin route below, which forwards the
      // bytes to Supabase. (Uploading cross-origin straight to Supabase works,
      // but the browser hides the ETag header the upload widget waits for.)
      const signed = new URL(await objectStorageService.createSignedUploadUrl(objectId));
      const token = signed.searchParams.get("token") ?? "";
      const protocol = req.get("x-forwarded-proto") ?? req.protocol;
      const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
      uploadURL = `${protocol}://${host}/api/storage/uploads/direct/${objectId}?token=${encodeURIComponent(token)}`;
    } catch (err) {
      req.log.error({ err }, "Failed to create signed upload URL");
      res.status(500).json({ error: "Uploads are not available right now." });
      return;
    }

    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  },
);

/**
 * PUT /storage/uploads/direct/:objectId?token=…
 *
 * Same-origin upload endpoint. The Supabase-signed token (from request-url) is
 * the credential — it only allows writing this one object, once, for a short
 * time. Enforces the size/type limits, forwards the bytes to Supabase Storage
 * and replies with an ETag so the upload widget registers success.
 */
router.put("/storage/uploads/direct/:objectId", async (req: Request, res: Response) => {
  const objectId = req.params.objectId ?? "";
  const token = req.query.token ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(objectId) || !token) {
    res.status(400).json({ error: "Invalid upload link" });
    return;
  }
  const contentType = (req.get("content-type") ?? "").split(";")[0]!.trim();
  if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(contentType)) {
    res.status(400).json({ error: "Unsupported file type." });
    return;
  }
  const declared = Number(req.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) {
    res.status(413).json({ error: "File too large" });
    return;
  }
  const body = await req.raw.arrayBuffer();
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    res.status(413).json({ error: "File too large" });
    return;
  }
  try {
    await objectStorageService.uploadWithSignedToken(objectId, token, contentType, body);
  } catch (err) {
    req.log.error({ err }, "Error forwarding upload to storage");
    res.status(502).json({ error: "Upload failed" });
    return;
  }
  res.setHeader("ETag", `"${objectId}"`);
  res.status(200).json({ ok: true, objectPath: `/objects/uploads/${objectId}` });
});

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
