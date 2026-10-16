import { afterAll, describe, expect, it } from "vitest";
import { selectStorage } from "./select-storage.js";
import type { S3StorageProvider } from "./s3-storage.js";

/*
 * Integration test against real Cloudflare R2.
 * Opt-in only:  S3_INTEGRATION=1 pnpm vitest run packages/storage
 *
 * Never runs by default, so the unit suite stays network-free.
 */
const enabled = process.env.S3_INTEGRATION === "1";

describe.skipIf(!enabled)("S3StorageProvider against real R2", () => {
  // Narrowed: delete/exists/contentType live on the S3 implementation, not the interface.
  const storage = selectStorage() as S3StorageProvider;
  const key = `integration/${Date.now()}-roundtrip.txt`;
  const body = "KDone R2 integration round-trip";
  const contentType = "text/plain; charset=utf-8";

  afterAll(async () => {
    if (enabled) await storage.delete(key);
  });

  it("puts, gets and deletes an object", async () => {
    expect(storage.name).toBe("s3");

    const put = await storage.put(key, body, contentType);
    expect(put.key).toBe(key);
    expect(put.sizeBytes).toBe(body.length);

    expect(await storage.exists(key)).toBe(true);

    const got = await storage.get(key);
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!)).toBe(body);

    expect(await storage.contentType(key)).toBe(contentType);

    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
    expect(await storage.get(key)).toBeNull();
  });
});