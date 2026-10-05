import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

/**
 * Document storage.
 *
 * Callers depend on `StorageProvider`, not on S3. One S3-compatible
 * implementation serves both Cloudflare R2 (production) and MinIO
 * (development); the difference is entirely in the environment.
 *
 * Document bytes never pass through this application on the way in or out:
 * the browser uploads to, and downloads from, the bucket directly using
 * short-lived signed URLs. That keeps large files off the serverless request
 * path (which caps bodies at a few megabytes) and means a download cannot be
 * rendered inline from our own origin.
 */

export type StoredObjectInfo = { sizeBytes: number; contentType: string | undefined };

export interface StorageProvider {
  /**
   * A URL the browser can PUT exactly one object to. The content type and
   * exact byte length are part of the signature, so the URL cannot be used
   * to upload something larger or of a different declared type.
   */
  presignUpload(input: { key: string; contentType: string; sizeBytes: number }): Promise<string>;
  /** A URL that downloads the object as an attachment with the given name. */
  presignDownload(input: { key: string; filename: string }): Promise<string>;
  /** Size and type of an object, or null if it does not exist. */
  head(key: string): Promise<StoredObjectInfo | null>;
  /** The whole object. Only call after `head` has confirmed it is small. */
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NotFound" || e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

/** Quotes a filename for a Content-Disposition header, with a UTF-8 form. */
function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

class S3StorageProvider implements StorageProvider {
  private client = new S3Client({
    endpoint: env.STORAGE_ENDPOINT,
    region: env.STORAGE_REGION,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    },
    // The SDK otherwise adds checksum headers and query parameters that a
    // plain browser PUT does not send, and the signature then fails.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  private bucket = env.STORAGE_BUCKET;
  private ttl = env.STORAGE_SIGNED_URL_TTL_SECONDS;

  presignUpload(input: { key: string; contentType: string; sizeBytes: number }): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
      { expiresIn: this.ttl, signableHeaders: new Set(["content-type", "content-length"]) },
    );
  }

  presignDownload(input: { key: string; filename: string }): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ResponseContentDisposition: attachmentDisposition(input.filename),
      }),
      { expiresIn: this.ttl },
    );
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { sizeBytes: result.ContentLength ?? 0, contentType: result.ContentType };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async read(key: string): Promise<Uint8Array> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error(`Object ${key} has no body`);
    return result.Body.transformToByteArray();
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let provider: StorageProvider | undefined;

/** The storage provider for this process, created on first use. */
export function storage(): StorageProvider {
  provider ??= new S3StorageProvider();
  return provider;
}
