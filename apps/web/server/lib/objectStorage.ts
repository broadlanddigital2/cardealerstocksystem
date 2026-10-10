// File storage backed by Cloudflare R2 (binding `FILES`, see wrangler.jsonc).
//
// Objects keep the same logical paths the app has always stored in the
// database ("/objects/uploads/<uuid>"), so existing vehicle/settings rows keep
// working once their files are copied across. Bytes live in a private R2
// bucket; the access policy (public vs private + owner) lives in the
// `stored_objects` table. Every read goes through /api/storage/objects/...,
// which checks that policy before streaming the file.
import { getCloudflareContext } from "@opennextjs/cloudflare";
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

// Minimal R2 binding types (avoids depending on @cloudflare/workers-types).
interface R2ObjectLike {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
}
interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream;
}
interface R2BucketLike {
  head(key: string): Promise<R2ObjectLike | null>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(key: string, value: ArrayBuffer | ReadableStream | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<R2ObjectLike | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }>;
}

function bucket(): R2BucketLike {
  let files: R2BucketLike | undefined;
  try {
    files = (getCloudflareContext().env as unknown as { FILES?: R2BucketLike }).FILES;
  } catch {
    files = undefined;
  }
  if (!files) {
    throw new Error("File storage is not configured (missing R2 binding FILES).");
  }
  return files;
}

const UPLOADS_PREFIX = "uploads";

export class ObjectStorageService {
  /** Storage key for an upload id. */
  keyFor(objectId: string): string {
    return `${UPLOADS_PREFIX}/${objectId}`;
  }

  /** Store bytes for an upload id (browser uploads and the Cazoo photo import). */
  async uploadObject(
    objectId: string,
    contentType: string,
    body: ArrayBuffer | Uint8Array,
    maxBytes: number = MAX_UPLOAD_BYTES,
  ): Promise<void> {
    if (body.byteLength > maxBytes) {
      throw new Error(`Upload too large: received ${body.byteLength} bytes, limit is ${maxBytes} bytes`);
    }
    await bucket().put(this.keyFor(objectId), body, { httpMetadata: { contentType } });
  }

  /** Size + content type of a stored object, or null if it doesn't exist. */
  async statObject(objectId: string): Promise<{ size: number; contentType: string | null } | null> {
    const head = await bucket().head(this.keyFor(objectId));
    if (!head) return null;
    return { size: head.size, contentType: head.httpMetadata?.contentType ?? null };
  }

  async deleteObjects(objectIds: string[]): Promise<void> {
    if (objectIds.length === 0) return;
    await bucket().delete(objectIds.map((id) => this.keyFor(id)));
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredFile> {
    const objectId = parseObjectPath(objectPath);
    if (!objectId) throw new ObjectNotFoundError();
    return { key: this.keyFor(objectId), objectId };
  }

  /** Stream an object as a Web Response. */
  async downloadObject(file: StoredFile, cacheTtlSec = 3600): Promise<Response> {
    const obj = await bucket().get(file.key);
    if (!obj) throw new ObjectNotFoundError();
    const [policy] = await db
      .select({ visibility: storedObjectsTable.visibility })
      .from(storedObjectsTable)
      .where(eq(storedObjectsTable.objectId, file.objectId));
    const isPublic = policy?.visibility === "public";
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": String(obj.size),
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      },
    });
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
    const cutoff = Date.now() - maxAgeMs;
    const candidates: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await bucket().list({ prefix: `${UPLOADS_PREFIX}/`, cursor, limit: 1000 });
      for (const o of page.objects) {
        if (new Date(o.uploaded).getTime() < cutoff) candidates.push(o.key.slice(UPLOADS_PREFIX.length + 1));
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
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
