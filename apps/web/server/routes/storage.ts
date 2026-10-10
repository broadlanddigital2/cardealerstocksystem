import { createHmac, timingSafeEqual } from "node:crypto";
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
// Upload tokens
// ---------------------------------------------------------------------------
// Short-lived (15 min) HMAC-signed tokens encode the exact object id, size
// limit and content type, so the upload route can enforce them without any
// stored state. The secret must be the same on every Worker instance, so it
// comes from configuration (UPLOAD_TOKEN_SECRET, falling back to CRON_SECRET).

interface UploadTokenPayload {
  objectId: string;
  maxSize: number;
  contentType: string;
  exp: number;
}

function tokenSecret(): string {
  const secret = process.env.UPLOAD_TOKEN_SECRET || process.env.CRON_SECRET;
  if (!secret) throw new Error("UPLOAD_TOKEN_SECRET (or CRON_SECRET) is not set");
  return secret;
}

function createUploadToken(payload: UploadTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", tokenSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyUploadToken(token: string): UploadTokenPayload {
  const dot = token.lastIndexOf(".");
  if (dot < 0) throw new Error("Malformed token");
  const data = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(createHmac("sha256", tokenSecret()).update(data).digest("base64url"));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) throw new Error("Invalid token");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as UploadTokenPayload;
  if (Date.now() > payload.exp) throw new Error("Token expired");
  return payload;
}

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
 * Issues a short-lived, HMAC-signed upload token and returns a same-origin
 * upload URL (PUT /storage/uploads/direct/:objectId?token=…). The client PUTs
 * the file body there and the server enforces the limits before storing it.
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
      const token = createUploadToken({
        objectId,
        maxSize: size,
        contentType,
        exp: Date.now() + 15 * 60 * 1000,
      });
      // Same-origin upload route (below) — the browser PUTs the file there and
      // the Worker writes it to R2.
      const protocol = req.get("x-forwarded-proto") ?? req.protocol;
      const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
      uploadURL = `${protocol}://${host}/api/storage/uploads/direct/${objectId}?token=${encodeURIComponent(token)}`;
    } catch (err) {
      req.log.error({ err }, "Failed to create upload token");
      res.status(500).json({ error: "Uploads are not available right now." });
      return;
    }

    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  },
);

/**
 * PUT /storage/uploads/direct/:objectId?token=…
 *
 * Same-origin upload endpoint. The signed token from request-url is the
 * credential: it allows writing this one object, with this content type and
 * size, for 15 minutes. Writes the bytes to R2 and replies with an ETag so the
 * upload widget registers success.
 */
router.put("/storage/uploads/direct/:objectId", async (req: Request, res: Response) => {
  const objectId = req.params.objectId ?? "";
  let payload: UploadTokenPayload;
  try {
    payload = verifyUploadToken(req.query.token ?? "");
  } catch {
    res.status(401).json({ error: "Invalid or expired upload link" });
    return;
  }
  if (payload.objectId !== objectId) {
    res.status(401).json({ error: "Invalid upload link" });
    return;
  }
  const contentType = (req.get("content-type") ?? "").split(";")[0]!.trim();
  if (contentType !== payload.contentType || !ALLOWED_UPLOAD_CONTENT_TYPES.has(contentType)) {
    res.status(400).json({ error: "Content-Type does not match upload token" });
    return;
  }
  const limit = Math.min(payload.maxSize, MAX_UPLOAD_BYTES);
  if (Number(req.get("content-length") ?? "0") > limit) {
    res.status(413).json({ error: "File too large" });
    return;
  }
  const body = await req.raw.arrayBuffer();
  if (body.byteLength > limit) {
    res.status(413).json({ error: "File too large" });
    return;
  }
  try {
    await objectStorageService.uploadObject(objectId, contentType, body, limit);
  } catch (err) {
    req.log.error({ err }, "Error storing upload");
    res.status(500).json({ error: "Upload failed" });
    return;
  }
  // The upload widget treats a response with an ETag as success.
  res.setHeader("ETag", `"${objectId}"`);
  res.status(200).json({ ok: true, objectPath: `/objects/uploads/${objectId}` });
});

/**
 * GET /storage/public-objects/*
 *
 * Kept for API compatibility; the app stores no "public search path" assets in
 * storage, so this always 404s.
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
