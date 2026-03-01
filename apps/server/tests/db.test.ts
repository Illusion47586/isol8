import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AuthStore, createAuthStore, detectBackend } from "../src/db/index.js";

describe("AuthStore (SQLite)", () => {
  let store: AuthStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "isol8-auth-test-"));
    store = await createAuthStore(join(tempDir, "test.db"));
  });

  afterEach(async () => {
    await store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── createKey ───

  test("createKey returns a valid result with isol8_ prefix", async () => {
    const result = await store.createKey({
      name: "test-key",
      tenantId: "tenant-1",
      ttlMs: 3_600_000,
    });

    expect(result.id).toBeString();
    expect(result.key).toStartWith("isol8_");
    expect(result.key.length).toBeGreaterThan(10);
    expect(result.name).toBe("test-key");
    expect(result.keyPrefix).toStartWith("isol8_");
    expect(result.keyPrefix).toEndWith("...");
    expect(result.tenantId).toBe("tenant-1");
    expect(result.expiresAt).toBeString();
    // expiresAt should be in the future
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test("createKey generates unique keys each time", async () => {
    const opts = { name: "key", tenantId: "t", ttlMs: 3_600_000 };
    const a = await store.createKey(opts);
    const b = await store.createKey(opts);

    expect(a.id).not.toBe(b.id);
    expect(a.key).not.toBe(b.key);
  });

  // ─── validateKey ───

  test("validateKey returns info for a valid key", async () => {
    const created = await store.createKey({
      name: "valid",
      tenantId: "t1",
      ttlMs: 3_600_000,
    });

    const info = await store.validateKey(created.key);
    expect(info).not.toBeNull();
    expect(info!.id).toBe(created.id);
    expect(info!.name).toBe("valid");
    expect(info!.tenantId).toBe("t1");
    expect(info!.revoked).toBe(false);
    // Hash is never exposed
    expect((info as any).keyHash).toBeUndefined();
  });

  test("validateKey returns null for unknown keys", async () => {
    expect(await store.validateKey("isol8_nonexistent")).toBeNull();
  });

  test("validateKey returns null for expired keys", async () => {
    // Create key that expires immediately (1ms TTL)
    const created = await store.createKey({
      name: "expired",
      tenantId: "t1",
      ttlMs: 1,
    });

    // Wait a bit to ensure it expires
    const start = Date.now();
    while (Date.now() - start < 10) {
      // busy wait
    }

    expect(await store.validateKey(created.key)).toBeNull();
  });

  test("validateKey returns null for revoked keys", async () => {
    const created = await store.createKey({
      name: "revoked",
      tenantId: "t1",
      ttlMs: 3_600_000,
    });

    await store.revokeKey(created.id);
    expect(await store.validateKey(created.key)).toBeNull();
  });

  test("validateKey updates lastUsedAt on success", async () => {
    const created = await store.createKey({
      name: "used",
      tenantId: "t1",
      ttlMs: 3_600_000,
    });

    // Initially lastUsedAt should be null
    const keysBefore = await store.listKeys();
    const before = keysBefore.find((k) => k.id === created.id);
    expect(before!.lastUsedAt).toBeNull();

    // Validate to trigger lastUsedAt update
    await store.validateKey(created.key);

    const keysAfter = await store.listKeys();
    const after = keysAfter.find((k) => k.id === created.id);
    expect(after!.lastUsedAt).not.toBeNull();
  });

  // ─── revokeKey ───

  test("revokeKey returns true for existing keys", async () => {
    const created = await store.createKey({
      name: "to-revoke",
      tenantId: "t1",
      ttlMs: 3_600_000,
    });

    expect(await store.revokeKey(created.id)).toBe(true);
  });

  test("revokeKey returns false for non-existent keys", async () => {
    expect(await store.revokeKey("non-existent-id")).toBe(false);
  });

  // ─── listKeys ───

  test("listKeys returns all keys", async () => {
    await store.createKey({ name: "a", tenantId: "t1", ttlMs: 3_600_000 });
    await store.createKey({ name: "b", tenantId: "t2", ttlMs: 3_600_000 });

    const keys = await store.listKeys();
    expect(keys.length).toBe(2);
    const names = keys.map((k) => k.name).sort();
    expect(names).toEqual(["a", "b"]);
  });

  test("listKeys filters by tenantId", async () => {
    await store.createKey({ name: "a", tenantId: "alpha", ttlMs: 3_600_000 });
    await store.createKey({ name: "b", tenantId: "beta", ttlMs: 3_600_000 });
    await store.createKey({ name: "c", tenantId: "alpha", ttlMs: 3_600_000 });

    const alpha = await store.listKeys("alpha");
    expect(alpha.length).toBe(2);
    expect(alpha.every((k) => k.tenantId === "alpha")).toBe(true);

    const beta = await store.listKeys("beta");
    expect(beta.length).toBe(1);
    expect(beta[0].tenantId).toBe("beta");
  });

  test("listKeys never exposes key hashes", async () => {
    await store.createKey({ name: "safe", tenantId: "t1", ttlMs: 3_600_000 });

    const keys = await store.listKeys();
    for (const key of keys) {
      expect((key as any).keyHash).toBeUndefined();
    }
  });

  // ─── cleanup ───

  test("cleanup removes expired keys", async () => {
    // Create an already-expired key (1ms TTL)
    await store.createKey({ name: "expired", tenantId: "t1", ttlMs: 1 });
    // Create a valid key
    await store.createKey({ name: "valid", tenantId: "t1", ttlMs: 3_600_000 });

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 10) {
      // busy wait
    }

    const removed = await store.cleanup();
    expect(removed).toBe(1);
    expect((await store.listKeys()).length).toBe(1);
    expect((await store.listKeys())[0].name).toBe("valid");
  });

  test("cleanup removes revoked keys", async () => {
    const key = await store.createKey({ name: "revoked", tenantId: "t1", ttlMs: 3_600_000 });
    await store.createKey({ name: "active", tenantId: "t1", ttlMs: 3_600_000 });

    await store.revokeKey(key.id);
    const removed = await store.cleanup();

    expect(removed).toBe(1);
    expect((await store.listKeys()).length).toBe(1);
    expect((await store.listKeys())[0].name).toBe("active");
  });

  // ─── close ───

  test("close completes without error", async () => {
    // Create a fresh store just for this test since afterEach also closes
    const extraStore = await createAuthStore(join(tempDir, "close-test.db"));
    await expect(extraStore.close()).resolves.toBeUndefined();
  });
});

// ─── detectBackend ───

describe("detectBackend", () => {
  test("returns 'postgres' for postgres:// URLs", () => {
    expect(detectBackend("postgres://user:pass@localhost:5432/isol8")).toBe("postgres");
  });

  test("returns 'postgres' for postgresql:// URLs", () => {
    expect(detectBackend("postgresql://user:pass@db.host:5432/isol8")).toBe("postgres");
  });

  test("returns 'mysql' for mysql:// URLs", () => {
    expect(detectBackend("mysql://root:secret@localhost:3306/isol8")).toBe("mysql");
  });

  test("returns 'sqlite' for plain file paths", () => {
    expect(detectBackend("./auth.db")).toBe("sqlite");
    expect(detectBackend("/home/user/.isol8/auth.db")).toBe("sqlite");
    expect(detectBackend("auth.db")).toBe("sqlite");
  });

  test("returns 'sqlite' for home-relative paths", () => {
    expect(detectBackend("~/.isol8/auth.db")).toBe("sqlite");
  });
});
