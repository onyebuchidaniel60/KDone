import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { errors } from "@kdone/shared";

/**
 * Object storage abstraction. Assets are versioned and never overwritten in
 * place; each version gets a distinct key.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Uint8Array | string, contentType: string): Promise<{ key: string; sizeBytes: number }>;
  get(key: string): Promise<Uint8Array | null>;
  /** Time-limited signed URL. Never a permanent public URL. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

function sha256(body: Uint8Array | string): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * In-memory storage for tests and single-process local dev. Holds bytes in the
 * process, so it is not durable across restarts; durability of *artifacts* is
 * provided by the BookAsset row and its storage key.
 */
export class MockStorageProvider implements StorageProvider {
  readonly name = "mock-storage";
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(key: string, body: Uint8Array | string, _contentType: string): Promise<{ key: string; sizeBytes: number }> {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    this.objects.set(key, { body: bytes, contentType: _contentType });
    return { key, sizeBytes: bytes.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key)?.body ?? null;
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(key)) throw errors.notFound("Object", key);
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const signature = createHmac("sha256", MOCK_SIGNING_SECRET).update(`${key}:${expires}`).digest("hex");
    return `mock://${key}?expires=${expires}&sig=${signature}`;
  }

  /** Test helper: verifies a URL was signed with the same secret and is unexpired. */
  verifySignedUrl(url: string): boolean {
    const parsed = new URL(url.replace(/^mock:\/\//, "https://"));
    const expires = Number(parsed.searchParams.get("expires") ?? "0");
    const signature = parsed.searchParams.get("sig") ?? "";
    if (expires * 1000 < Date.now()) return false;
    const expected = createHmac("sha256", MOCK_SIGNING_SECRET)
      .update(`${parsed.host}${parsed.pathname}:${expires}`)
      .digest("hex");
    const a = Buffer.from(signature, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  get size(): number {
    return this.objects.size;
  }
}

const MOCK_SIGNING_SECRET = "kdone-mock-signing-secret-not-a-real-secret";

/** Versioned, collision-free key builder. */
export function assetKey(input: {
  bookProjectId: string;
  assetType: string;
  version: number;
  extension: string;
}): string {
  return `books/${input.bookProjectId}/${input.assetType}/v${input.version}.${input.extension}`;
}

export { sha256 };
export * from "./s3-storage.js";
export { selectStorage, isS3Configured, type StorageConfig } from "./select-storage.js";