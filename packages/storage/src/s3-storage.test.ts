import { describe, expect, it } from "vitest";
import { S3StorageProvider } from "./s3-storage.js";
import { isS3Configured, selectStorage } from "./select-storage.js";
import { MockStorageProvider } from "./index.js";

/**
 * Unit tests use a mocked S3 client. Nothing here touches the network.
 */
function mockClient() {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();

  const send = async (command: unknown): Promise<unknown> => {
    const cmd = command as {
      constructor: { name: string };
      input: { Bucket: string; Key: string; Body?: Uint8Array; ContentType?: string };
    };
    const { name } = cmd.constructor;
    const { Key, Body, ContentType } = cmd.input;

    if (name === "PutObjectCommand") {
      store.set(Key, { bytes: Body!, contentType: ContentType });
      return {};
    }
    if (name === "GetObjectCommand") {
      const found = store.get(Key);
      if (!found) {
        const error = new Error("NoSuchKey") as Error & { name: string };
        error.name = "NoSuchKey";
        throw error;
      }
      return { Body: { transformToByteArray: async () => found.bytes } };
    }
    if (name === "HeadObjectCommand") {
      const found = store.get(Key);
      if (!found) {
        const error = new Error("NotFound") as Error & { name: string };
        error.name = "NotFound";
        throw error;
      }
      return { ContentType: found.contentType };
    }
    if (name === "DeleteObjectCommand") {
      store.delete(Key);
      return {};
    }
    throw new Error(`unexpected command ${name}`);
  };

  return { send, store };
}

function provider() {
  const client = mockClient();
  const s3 = new S3StorageProvider(
    {
      bucket: "kdone-test",
      endpoint: "https://example.invalid",
      region: "auto",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
    },
    client as never,
  );
  return { s3, client };
}

describe("S3StorageProvider (mocked client)", () => {
  it("round-trips an object", async () => {
    const { s3 } = provider();
    const { key, sizeBytes } = await s3.put("books/b/cover/v1.svg", "<svg/>", "image/svg+xml");
    expect(key).toBe("books/b/cover/v1.svg");
    expect(sizeBytes).toBe(6);

    const got = await s3.get(key);
    expect(new TextDecoder().decode(got!)).toBe("<svg/>");
  });

  it("records the content type on put and reports it back", async () => {
    const { s3 } = provider();
    await s3.put("books/b/epub/v1.epub", new Uint8Array([1, 2, 3]), "application/epub+zip");
    expect(await s3.contentType("books/b/epub/v1.epub")).toBe("application/epub+zip");
  });

  it("stores binary bodies unchanged", async () => {
    const { s3 } = provider();
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await s3.put("books/b/cover/v1.png", bytes, "image/png");
    expect(Array.from((await s3.get("books/b/cover/v1.png"))!)).toEqual([0, 1, 2, 250, 255]);
  });

  it("returns null for a missing key on get", async () => {
    const { s3 } = provider();
    expect(await s3.get("nope")).toBeNull();
  });

  it("reports existence via exists()", async () => {
    const { s3 } = provider();
    expect(await s3.exists("nope")).toBe(false);
    await s3.put("here", "x", "text/plain");
    expect(await s3.exists("here")).toBe(true);
  });

  it("deletes an object", async () => {
    const { s3 } = provider();
    await s3.put("gone", "x", "text/plain");
    await s3.delete("gone");
    expect(await s3.exists("gone")).toBe(false);
  });

  it("overwrites the same key without erroring", async () => {
    const { s3 } = provider();
    await s3.put("k", "first", "text/plain");
    await s3.put("k", "second", "text/plain");
    expect(new TextDecoder().decode((await s3.get("k"))!)).toBe("second");
  });
});

describe("storage selection", () => {
  const full = {
    S3_ENDPOINT: "https://x.r2.cloudflarestorage.com",
    S3_BUCKET: "kdone",
    S3_ACCESS_KEY_ID: "id",
    S3_SECRET_ACCESS_KEY: "secret",
  };

  it("selects S3 when fully configured", () => {
    expect(isS3Configured(full)).toBe(true);
    expect(selectStorage(full).name).toBe("s3");
  });

  it("falls back to the mock when credentials are absent", () => {
    expect(isS3Configured({})).toBe(false);
    expect(selectStorage({}).name).toBe("mock-storage");
    // Partial config must not select S3.
    expect(isS3Configured({ ...full, S3_SECRET_ACCESS_KEY: undefined })).toBe(false);
    expect(selectStorage({ ...full, S3_BUCKET: undefined }).name).toBe("mock-storage");
  });

  it("defaults the region to auto for R2", () => {
    expect(isS3Configured(full)).toBe(true);
    expect(selectStorage(full).name).toBe("s3");
  });
});

describe("MockStorageProvider remains available", () => {
  it("round-trips in process", async () => {
    const mock = new MockStorageProvider();
    await mock.put("a/b", "hello", "text/plain");
    expect(new TextDecoder().decode((await mock.get("a/b"))!)).toBe("hello");
  });
});