import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthDB } from "../src/db.js";

describe("AuthDB", () => {
  let db: AuthDB;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "isol8-auth-test-"));
    db = new AuthDB(join(tempDir, "test.db"));
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── createKey ───

  test("createKey returns a valid result with isol8_ prefix", () => {
    const result = db.createKey({
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

  test("createKey generates unique keys each time", () => {
    const opts = { name: "key", tenantId: "t", ttlMs: 3_600_000 };
    const a = db.createKey(opts);
    const b = db.createKey(opts);

    expect(a.id).not.toBe(b.id);
    expect(a.key).not.toBe(b.key);
  });

  // ─── validateKey ───

  test("validateKey returns info for a valid key", () => {
    const created = db.createKey({
      name: "valid",
      tenantId: "t1",
      ttlMs: 3_600_000,
    });

    const info = db.validateKey(created.key);
    expect(info).not.toBeNull();
    expect(info!.id).toBe(created.id);
    expect(info!.name).toBe("valid");
    expect(info!.tenantId).toBe("t1");
    expect(info!.revoked).toBe(false);
    // Hash is never exposed
    expect((info as any).keyHash).toBeUndefined();
  });

  test("validateKey returns null for unknown keys", () => {
    expect(db.validateKey("isol8_nonexistent")).toBeNull();
  });

  test("validateKey returns null for expired keys", () => {
    // Create key that expires immediately (1ms TTL)
    const created = db.createKey({
      name: "expired",
      tenantId: "t1",
      ttlMs: 1,
    });

    // Wait a bit to ensure it expires
    const start = Date.now();
    while (Date.now() - start < 10) {
      // busy wait
    }

    expect(db.validateKey(created.key)).toBeNull();
  });

  test("validateKey returns null for revoked keys", () => {
    const created = db.createKey({
      name: "revoked",
      tenantId: "t1",
      ttlMs: 3_600_000,
    });

    db.revokeKey(created.id);
    expect(db.validateKey(created.key)).toBeNull();
  });

  test("validateKey updates lastUsedAt on success", () => {
    const created = db.createKey({
      name: "used",
      tenantId: "t1",
      ttlMs: 3_600_000,
    });

    // Initially lastUsedAt should be null
    const keysBefore = db.listKeys();
    const before = keysBefore.find((k) => k.id === created.id);
    expect(before!.lastUsedAt).toBeNull();

    // Validate to trigger lastUsedAt update
    db.validateKey(created.key);

    const keysAfter = db.listKeys();
    const after = keysAfter.find((k) => k.id === created.id);
    expect(after!.lastUsedAt).not.toBeNull();
  });

  // ─── revokeKey ───

  test("revokeKey returns true for existing keys", () => {
    const created = db.createKey({
      name: "to-revoke",
      tenantId: "t1",
      ttlMs: 3_600_000,
    });

    expect(db.revokeKey(created.id)).toBe(true);
  });

  test("revokeKey returns false for non-existent keys", () => {
    expect(db.revokeKey("non-existent-id")).toBe(false);
  });

  // ─── listKeys ───

  test("listKeys returns all keys", () => {
    db.createKey({ name: "a", tenantId: "t1", ttlMs: 3_600_000 });
    db.createKey({ name: "b", tenantId: "t2", ttlMs: 3_600_000 });

    const keys = db.listKeys();
    expect(keys.length).toBe(2);
    const names = keys.map((k) => k.name).sort();
    expect(names).toEqual(["a", "b"]);
  });

  test("listKeys filters by tenantId", () => {
    db.createKey({ name: "a", tenantId: "alpha", ttlMs: 3_600_000 });
    db.createKey({ name: "b", tenantId: "beta", ttlMs: 3_600_000 });
    db.createKey({ name: "c", tenantId: "alpha", ttlMs: 3_600_000 });

    const alpha = db.listKeys("alpha");
    expect(alpha.length).toBe(2);
    expect(alpha.every((k) => k.tenantId === "alpha")).toBe(true);

    const beta = db.listKeys("beta");
    expect(beta.length).toBe(1);
    expect(beta[0].tenantId).toBe("beta");
  });

  test("listKeys never exposes key hashes", () => {
    db.createKey({ name: "safe", tenantId: "t1", ttlMs: 3_600_000 });

    const keys = db.listKeys();
    for (const key of keys) {
      expect((key as any).keyHash).toBeUndefined();
    }
  });

  // ─── cleanup ───

  test("cleanup removes expired keys", () => {
    // Create an already-expired key (1ms TTL)
    db.createKey({ name: "expired", tenantId: "t1", ttlMs: 1 });
    // Create a valid key
    db.createKey({ name: "valid", tenantId: "t1", ttlMs: 3_600_000 });

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 10) {
      // busy wait
    }

    const removed = db.cleanup();
    expect(removed).toBe(1);
    expect(db.listKeys().length).toBe(1);
    expect(db.listKeys()[0].name).toBe("valid");
  });

  test("cleanup removes revoked keys", () => {
    const key = db.createKey({ name: "revoked", tenantId: "t1", ttlMs: 3_600_000 });
    db.createKey({ name: "active", tenantId: "t1", ttlMs: 3_600_000 });

    db.revokeKey(key.id);
    const removed = db.cleanup();

    expect(removed).toBe(1);
    expect(db.listKeys().length).toBe(1);
    expect(db.listKeys()[0].name).toBe("active");
  });

  // ─── close ───

  test("close completes without error", () => {
    // Create a fresh DB just for this test since afterEach also closes
    const extraDb = new AuthDB(join(tempDir, "close-test.db"));
    expect(() => extraDb.close()).not.toThrow();
  });
});
