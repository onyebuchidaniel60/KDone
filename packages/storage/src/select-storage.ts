import { MockStorageProvider, type StorageProvider } from "./index.js";
import { S3StorageProvider } from "./s3-storage.js";

export interface StorageConfig {
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
}

/**
 * Mirrors the Queue pattern (ADR-016 amendment): the rest of the app depends
 * only on the `StorageProvider` interface, never on a concrete driver.
 */
export function isS3Configured(config: StorageConfig = process.env as StorageConfig): boolean {
  return Boolean(
    config.S3_ENDPOINT && config.S3_BUCKET && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY,
  );
}

/**
 * Returns an S3-backed provider when credentials are present, otherwise the
 * in-process mock. The mock keeps tests and local dev free of network calls.
 */
export function selectStorage(config: StorageConfig = process.env as StorageConfig): StorageProvider {
  if (!isS3Configured(config)) return new MockStorageProvider();

  return new S3StorageProvider({
    bucket: config.S3_BUCKET!,
    endpoint: config.S3_ENDPOINT!,
    region: config.S3_REGION ?? "auto",
    accessKeyId: config.S3_ACCESS_KEY_ID!,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: true,
  });
}