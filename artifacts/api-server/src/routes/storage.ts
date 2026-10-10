import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { createHmac, randomBytes, timingSafeEqual, randomUUID } from "crypto";
import {
  RequestUploadUrlBody,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError, MAX_UPLOAD_BYTES } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { requireAuth, getSessionUserId } from "../middlewares/requireAuth";

const router: IRouter = Router();
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
// Upload token utilities
// ---------------------------------------------------------------------------
// Tokens are HMAC-SHA256 signed, short-lived (15 min), and encode the exact
// objectId + maxSize + contentType so the PUT endpoint can enforce limits
// without any additional state. A random secret is generated per process start;
// tokens are invalidated on server restart, which is acceptable for a 15-minute
// window.
const UPLOAD_TOKEN_SECRET =
  process.env.UPLOAD_TOKEN_SECRET ?? randomBytes(32).toString("hex");

interface UploadTokenPayload {
  userId: string;
  objectId: string;
  maxSize: number;
  contentType: string;
  exp: number;
}

function createUploadToken(payload: UploadTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", UPLOAD_TOKEN_SECRET)
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

function verifyUploadToken(token: string): UploadTokenPayload {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx < 0) throw new Error("Malformed token");
  const data = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expectedSig = createHmac("sha256", UPLOAD_TOKEN_SECRET)
    .update(data)
    .digest("base64url");
  const expectedBuf = Buffer.from(expectedSig);
  const sigBuf = Buffer.from(sig);
  if (
    expectedBuf.length !== sigBuf.length ||
    !timingSafeEqual(expectedBuf, sigBuf)
  ) {
    throw new Error("Invalid token signature");
  }
  const payload = JSON.parse(
    Buffer.from(data, "base64url").toString(),
  ) as UploadTokenPayload;
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

    const objectId = randomUUID();
    const objectPath = `/objects/uploads/${objectId}`;
    const token = createUploadToken({
      userId: sessionUserId,
      objectId,
      maxSize: size,
      contentType,
      exp: Date.now() + 15 * 60 * 1000,
    });

    // Construct an absolute URL pointing back to our own PUT endpoint so the
    // client (Uppy / fetch) can PUT the file body to it directly.
    const protocol = req.get("x-forwarded-proto") ?? req.protocol;
    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "";
    const uploadURL = `${protocol}://${host}/api/storage/uploads/direct/${token}`;

    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  },
);

/**
 * PUT /storage/uploads/direct/:token
 *
 * Server-proxied upload. The client PUTs the raw file body here; the server
 * enforces the byte limit encoded in the signed token and writes the stream
 * directly to object storage. Authentication is the signed token itself (issued
 * by POST /storage/uploads/request-url). No Clerk auth is required on this
 * route — the token is the credential.
 */
router.put(
  "/storage/uploads/direct/:token",
  async (req: Request, res: Response) => {
    let payload: UploadTokenPayload;
    const rawToken = Array.isArray(req.params.token)
      ? req.params.token[0]
      : req.params.token;
    try {
      payload = verifyUploadToken(rawToken ?? "");
    } catch {
      res.status(401).json({ error: "Invalid or expired upload token" });
      return;
    }

    const contentType = (req.get("Content-Type") ?? "").split(";")[0].trim();
    if (contentType !== payload.contentType) {
      res
        .status(400)
        .json({ error: "Content-Type does not match upload token" });
      return;
    }

    try {
      await objectStorageService.streamUploadObject(
        payload.objectId,
        payload.contentType,
        req as unknown as Readable,
        payload.maxSize,
      );
      res.status(200).json({ ok: true });
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.startsWith("Upload too large")
      ) {
        res.status(413).json({ error: "File too large" });
        return;
      }
      req.log.error({ err }, "Error during proxied file upload");
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  "/storage/public-objects/*filePath",
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join("/") : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, "Error serving public object");
      res.status(500).json({ error: "Failed to serve public object" });
    }
  },
);

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
      const userId = (req as Request & { userId?: string }).userId;
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

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
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
