import { Storage, File } from "@google-cloud/storage";
import { Readable, Transform } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

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

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);

    // Verify actual stored size against the hard limit. If the client uploaded
    // a larger file than declared (or bypassed the request-url check entirely),
    // delete the oversized object and reject the attachment.
    const [metadata] = await objectFile.getMetadata();
    const actualBytes = Number(metadata.size ?? 0);
    if (actualBytes > MAX_UPLOAD_BYTES) {
      try {
        await objectFile.delete();
      } catch {
        // Best-effort cleanup; the rejection below is the authoritative result.
      }
      throw new MaxUploadSizeExceededError(actualBytes);
    }

    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  /**
   * Proxy-upload a file stream directly to object storage, enforcing a hard
   * byte limit. The file is stored under PRIVATE_OBJECT_DIR/uploads/<objectId>.
   * If the stream exceeds maxBytes the write is aborted and the partial object
   * is deleted (best-effort).
   */
  async streamUploadObject(
    objectId: string,
    contentType: string,
    stream: Readable,
    maxBytes: number,
  ): Promise<void> {
    const privateObjectDir = this.getPrivateObjectDir();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    let bytesReceived = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytesReceived += chunk.length;
        if (bytesReceived > maxBytes) {
          cb(new Error(`Upload too large: received ${bytesReceived} bytes, limit is ${maxBytes} bytes`));
        } else {
          this.push(chunk);
          cb();
        }
      },
    });

    const writeStream = file.createWriteStream({
      resumable: false,
      metadata: { contentType },
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        file.delete().catch(() => {});
        reject(err);
      };
      counter.on("error", onError);
      writeStream.on("error", onError);
      writeStream.on("finish", resolve);
      stream.pipe(counter).pipe(writeStream);
    });
  }

  /**
   * Delete objects under PRIVATE_OBJECT_DIR/uploads/ that are older than
   * maxAgeMs AND have never been finalized (i.e. have no ACL policy metadata).
   *
   * Finalized objects always have "custom:aclPolicy" set in their custom
   * metadata (written by trySetObjectEntityAclPolicy via setObjectAclPolicy).
   * GCS getFiles() returns custom metadata in the list response, so we can
   * distinguish orphans from finalized assets without an extra per-file API
   * call. This ensures that legitimate vehicle photos and logos — which live
   * under the same /uploads/ prefix — are never purged.
   */
  async cleanupOrphanedUploads(maxAgeMs: number): Promise<void> {
    const privateObjectDir = this.getPrivateObjectDir();
    const uploadsPath = `${privateObjectDir}/uploads/`;
    const { bucketName, objectName: uploadsPrefix } = parseObjectPath(uploadsPath);
    const bucket = objectStorageClient.bucket(bucketName);

    const [files] = await bucket.getFiles({ prefix: uploadsPrefix });
    const cutoff = Date.now() - maxAgeMs;

    await Promise.allSettled(
      files
        .filter((f) => {
          const created = f.metadata.timeCreated as string | undefined;
          if (!created || new Date(created).getTime() >= cutoff) return false;
          // Only delete objects that have never been finalized. Finalized objects
          // always carry "custom:aclPolicy" in their custom metadata; unfinalised
          // (orphaned) uploads do not.
          const customMeta = f.metadata.metadata as
            | Record<string, string>
            | undefined;
          return !customMeta?.["custom:aclPolicy"];
        })
        .map((f) => f.delete()),
    );
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = (await response.json()) as {
    signed_url: string;
  };
  return signedURL;
}
