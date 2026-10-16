import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StorageProvider } from "./index.js";

/**
 * S3-compatible object storage (Cloudflare R2 in production).
 *
 * R2 specifics that must not be changed:
 *  - `forcePathStyle: true` - R2 does not do virtual-host style addressing.
 *  - `region: "auto"`      - R2 ignores the region but the SDK requires one.
 *
 * Assets are never served from a public bucket and never via long-lived signed
 * URLs. They are streamed through an authenticated API route that verifies the
 * caller owns the book (see the assets route in apps/web).
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";

  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly options: {
      bucket: string;
      endpoint: string;
      region?: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle?: boolean;
    },
    /** Injectable for testing; defaults to a real S3Client. */
    client?: S3Client,
  ) {
    this.bucket = options.bucket;
    this.client =
      client ??
      new S3Client({
        region: options.region ?? "auto",
        endpoint: options.endpoint,
        forcePathStyle: options.forcePathStyle ?? true,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
      });
  }

  async put(key: string, body: Uint8Array | string, contentType: string): Promise<{ key: string; sizeBytes: number }> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: bytes,
        // R2 stores the content type as metadata; without it browsers and the
        // KDP upload flow cannot tell a cover from an EPUB.
        ContentType: contentType,
      }),
    );

    return { key, sizeBytes: bytes.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!result.Body) return null;

      const bytes = await result.Body.transformToByteArray();
      return bytes;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /**
   * Not used for asset delivery: assets are streamed through the authenticated
   * API route. Present only to satisfy the interface; deliberately short-lived.
   */
  async signedUrl(): Promise<string> {
    throw new Error(
      "Signed URLs are not used for KDone assets. Serve them through GET /api/books/:bookId/assets/:assetId.",
    );
  }

  /** Content type recorded at write time, if known. */
  async contentType(key: string): Promise<string | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return result.ContentType ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}