// File storage backed by Supabase Storage (replaces Replit's GCS sidecar).
//
// Objects keep the same logical paths the app has always stored in the
// database ("/objects/uploads/<uuid>"), so existing vehicle/settings rows keep
// working once their files are copied across. Bytes live in a private Supabase
// bucket; the access policy (public vs private + owner) lives in the
// `stored_objects` table. Every read goes through /api/storage/objects/...,
// which checks that policy before streaming the file.
//
// Uses the Storage REST API directly via fetch, so it runs on Node and on
// Cloudflare Workers without extra SDKs.
import { eq, inArray } from "@workspace/db";
import { db, storedObjectsTable } from "@workspace/db";
import { ObjectPermission, type ObjectAclPolicy, canAccessPolicy } from "./objectAcl";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export class MaxUploadSizeExceededError extends Error {
  constructor(actualBytes: number) {
    super(
      `Uploaded file size (${actualBytes} bytes) exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit`,
    );
    this.name = "MaxUploadSizeExceededError";
    Object.setPrototypeOf(this, MaxUploadSizeExceededError.prototype);
  }
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/** A resolved object in storage. `key` is the path inside the bucket. */
export interface StoredFile {
  key: string;
  objectId: string;
}

function config() {
  const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";
  const bucket = process.env.STORAGE_BUCKET ?? "stock-book";
  if (!url || !key) {
    throw new Error(
      "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return { url, key, bucket };
}

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

const UPLOADS_PREFIX = "uploads";

export class ObjectStorageService {
  /** Storage key for an upload id. */
  keyFor(objectId: string): string {
    return `${UPLOADS_PREFIX}/${objectId}`;
  }

  /**
   * Returns a short-lived URL the browser can PUT the file body to directly
   * (Supabase signed upload URL). The bucket's own file-size and MIME limits
   * are enforced by Supabase; we re-check the stored size on finalise.
   */
  async createSignedUploadUrl(objectId: string): Promise<string> {
    const { url, key, bucket } = config();
    const resp = await fetch(
      `${url}/storage/v1/object/upload/sign/${bucket}/${encodeKey(this.keyFor(objectId))}`,
      { method: "POST", headers: { ...authHeaders(key), "Content-Type": "application/json" }, body: "{}" },
    );
    if (!resp.ok) {
      throw new Error(`Failed to sign upload URL (${resp.status}): ${await resp.text()}`);
    }
    const data = (await resp.json()) as { url: string };
    return `${url}/storage/v1${data.url}`;
  }

  /** Upload bytes using a Supabase signed-upload token (browser uploads). */
  async uploadWithSignedToken(
    objectId: string,
    token: string,
    contentType: string,
    body: ArrayBuffer,
  ): Promise<void> {
    const { url, bucket } = config();
    const resp = await fetch(
      `${url}/storage/v1/object/upload/sign/${bucket}/${encodeKey(this.keyFor(objectId))}?token=${encodeURIComponent(token)}`,
      { method: "PUT", headers: { "Content-Type": contentType, "x-upsert": "false" }, body },
    );
    if (!resp.ok) {
      throw new Error(`Signed upload failed (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
    }
  }

  /** Upload bytes server-side (used by the Cazoo photo import). */
  async uploadObject(
    objectId: string,
    contentType: string,
    body: ArrayBuffer | Uint8Array,
    maxBytes: number = MAX_UPLOAD_BYTES,
  ): Promise<void> {
    if (body.byteLength > maxBytes) {
      throw new Error(`Upload too large: received ${body.byteLength} bytes, limit is ${maxBytes} bytes`);
    }
    const { url, key, bucket } = config();
    const resp = await fetch(`${url}/storage/v1/object/${bucket}/${encodeKey(this.keyFor(objectId))}`, {
      method: "POST",
      headers: { ...authHeaders(key), "Content-Type": contentType, "x-upsert": "true" },
      body: body as BodyInit,
    });
    if (!resp.ok) {
      throw new Error(`Upload failed (${resp.status}): ${await resp.text()}`);
    }
  }

  /** Size + content type of a stored object, or null if it doesn't exist. */
  async statObject(objectId: string): Promise<{ size: number; contentType: string | null } | null> {
    const { url, key, bucket } = config();
    const resp = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...authHeaders(key), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: UPLOADS_PREFIX, search: objectId, limit: 10 }),
    });
    if (!resp.ok) throw new Error(`Storage list failed (${resp.status})`);
    const rows = (await resp.json()) as Array<{
      name: string;
      metadata?: { size?: number; mimetype?: string } | null;
    }>;
    const row = rows.find((r) => r.name === objectId);
    if (!row) return null;
    return { size: Number(row.metadata?.size ?? 0), contentType: row.metadata?.mimetype ?? null };
  }

  async deleteObjects(objectIds: string[]): Promise<void> {
    if (objectIds.length === 0) return;
    const { url, key, bucket } = config();
    await fetch(`${url}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: { ...authHeaders(key), "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: objectIds.map((id) => this.keyFor(id)) }),
    });
  }

  /** Resolve "/objects/uploads/<id>" to a stored file, or throw ObjectNotFoundError. */
  async getObjectEntityFile(objectPath: string): Promise<StoredFile> {
    const objectId = parseObjectPath(objectPath);
    if (!objectId) throw new ObjectNotFoundError();
    return { key: this.keyFor(objectId), objectId };
  }

  /** Stream an object as a Web Response (status/headers mirror the original). */
  async downloadObject(file: StoredFile, cacheTtlSec = 3600): Promise<Response> {
    const { url, key, bucket } = config();
    const resp = await fetch(`${url}/storage/v1/object/${bucket}/${encodeKey(file.key)}`, {
      headers: authHeaders(key),
    });
    if (resp.status === 400 || resp.status === 404) throw new ObjectNotFoundError();
    if (!resp.ok) throw new Error(`Storage download failed (${resp.status})`);
    const [policy] = await db
      .select({ visibility: storedObjectsTable.visibility })
      .from(storedObjectsTable)
      .where(eq(storedObjectsTable.objectId, file.objectId));
    const isPublic = policy?.visibility === "public";
    const headers: Record<string, string> = {
      "Content-Type": resp.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    const len = resp.headers.get("content-length");
    if (len) headers["Content-Length"] = len;
    return new Response(resp.body, { headers });
  }

  normalizeObjectEntityPath(rawPath: string): string {
    // Accept full URLs to our own object route as well as bare paths.
    const m = rawPath.match(/\/objects\/uploads\/([0-9a-zA-Z-]+)/);
    if (m && !rawPath.startsWith("/objects/")) return `/objects/uploads/${m[1]}`;
    return rawPath;
  }

  /**
   * Finalise an upload: verify it exists and is within the size limit, then
   * record its ACL policy. Returns the normalised "/objects/uploads/<id>" path.
   * Non-object paths (e.g. external URLs) are returned unchanged.
   */
  async trySetObjectEntityAclPolicy(rawPath: string, aclPolicy: ObjectAclPolicy): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) return normalizedPath;

    const objectId = parseObjectPath(normalizedPath);
    if (!objectId) throw new ObjectNotFoundError();

    // Already finalised (e.g. re-saving a vehicle with existing photos).
    const [existing] = await db
      .select()
      .from(storedObjectsTable)
      .where(eq(storedObjectsTable.objectId, objectId));

    if (!existing) {
      const stat = await this.statObject(objectId);
      if (!stat) throw new ObjectNotFoundError();
      if (stat.size > MAX_UPLOAD_BYTES) {
        await this.deleteObjects([objectId]).catch(() => {});
        throw new MaxUploadSizeExceededError(stat.size);
      }
      await db
        .insert(storedObjectsTable)
        .values({
          objectId,
          owner: aclPolicy.owner,
          visibility: aclPolicy.visibility,
          contentType: stat.contentType,
          size: stat.size,
        })
        .onConflictDoUpdate({
          target: storedObjectsTable.objectId,
          set: { owner: aclPolicy.owner, visibility: aclPolicy.visibility },
        });
    } else if (existing.visibility !== aclPolicy.visibility || existing.owner !== aclPolicy.owner) {
      await db
        .update(storedObjectsTable)
        .set({ owner: aclPolicy.owner, visibility: aclPolicy.visibility })
        .where(eq(storedObjectsTable.objectId, objectId));
    }
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StoredFile;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    const [row] = await db
      .select()
      .from(storedObjectsTable)
      .where(eq(storedObjectsTable.objectId, objectFile.objectId));
    if (!row) return false;
    return canAccessPolicy(
      { owner: row.owner, visibility: row.visibility === "public" ? "public" : "private" },
      userId,
      requestedPermission ?? ObjectPermission.READ,
    );
  }

  /**
   * Delete uploads older than maxAgeMs that were never finalised (no
   * stored_objects row). Finalised files are never touched.
   */
  async cleanupOrphanedUploads(maxAgeMs: number): Promise<number> {
    const { url, key, bucket } = config();
    const cutoff = Date.now() - maxAgeMs;
    let offset = 0;
    const candidates: string[] = [];
    for (;;) {
      const resp = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { ...authHeaders(key), "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: UPLOADS_PREFIX, limit: 1000, offset, sortBy: { column: "created_at", order: "asc" } }),
      });
      if (!resp.ok) throw new Error(`Storage list failed (${resp.status})`);
      const rows = (await resp.json()) as Array<{ name: string; created_at?: string | null }>;
      for (const r of rows) {
        if (r.created_at && new Date(r.created_at).getTime() < cutoff) candidates.push(r.name);
      }
      if (rows.length < 1000) break;
      offset += rows.length;
    }
    if (candidates.length === 0) return 0;
    const orphans: string[] = [];
    for (let i = 0; i < candidates.length; i += 500) {
      const chunk = candidates.slice(i, i + 500);
      const known = await db
        .select({ id: storedObjectsTable.objectId })
        .from(storedObjectsTable)
        .where(inArray(storedObjectsTable.objectId, chunk));
      const knownSet = new Set(known.map((k) => k.id));
      orphans.push(...chunk.filter((c) => !knownSet.has(c)));
    }
    for (let i = 0; i < orphans.length; i += 500) {
      await this.deleteObjects(orphans.slice(i, i + 500));
    }
    return orphans.length;
  }
}

/** "/objects/uploads/<id>" -> "<id>" (only ids that look safe). */
function parseObjectPath(objectPath: string): string | null {
  const m = objectPath.match(/^\/objects\/uploads\/([0-9a-zA-Z-]{8,64})$/);
  return m ? m[1]! : null;
}
