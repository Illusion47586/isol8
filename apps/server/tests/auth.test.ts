import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "hono";
import { Hono } from "hono";
import { authMiddleware, requireMasterKey } from "../src/auth.js";
import { type AuthStore, createAuthStore } from "../src/db/index.js";

/** Helper: type-safe read of Hono context variables set by auth middleware. */
const getVar = (c: Context, key: string): unknown => (c as any).get(key);

/** Create a minimal Hono app wired with authMiddleware for testing. */
function createTestApp(middleware: ReturnType<typeof authMiddleware>) {
  const app = new Hono();
  app.use("*", middleware);
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/test", (c) =>
    c.json({
      authType: getVar(c, "authType"),
      tenantId: getVar(c, "tenantId"),
    })
  );
  app.get("/admin", requireMasterKey(), (c) => c.json({ ok: true }));
  return app;
}

// ─── authMiddleware ───

describe("authMiddleware", () => {
  const STATIC_KEY = "master-secret";

  test("skips auth for /health endpoint", async () => {
    const app = createTestApp(authMiddleware(STATIC_KEY));
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  test("returns 401 when Authorization header is missing", async () => {
    const app = createTestApp(authMiddleware(STATIC_KEY));
    const res = await app.request("/test");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Missing Authorization header");
  });

  test("returns 403 for invalid token", async () => {
    const app = createTestApp(authMiddleware(STATIC_KEY));
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid API key");
  });

  test("static key sets authType to master", async () => {
    const app = createTestApp(authMiddleware(STATIC_KEY));
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${STATIC_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authType: string };
    expect(body.authType).toBe("master");
  });

  test("accepts AuthMiddlewareOptions object", async () => {
    const app = createTestApp(authMiddleware({ staticKey: STATIC_KEY }));
    const res = await app.request("/test", {
      headers: { Authorization: `Bearer ${STATIC_KEY}` },
    });
    expect(res.status).toBe(200);
  });

  // ─── DB-backed auth ───

  describe("with AuthStore", () => {
    let store: AuthStore;
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "isol8-auth-mw-test-"));
      store = await createAuthStore(join(tempDir, "test.db"));
    });

    afterEach(async () => {
      await store.close();
      await rm(tempDir, { recursive: true, force: true });
    });

    test("DB key sets authType to apikey and tenantId", async () => {
      const created = await store.createKey({ name: "test", tenantId: "org-1", ttlMs: 3_600_000 });

      const app = createTestApp(authMiddleware({ staticKey: STATIC_KEY, authDb: store }));
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${created.key}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { authType: string; tenantId: string };
      expect(body.authType).toBe("apikey");
      expect(body.tenantId).toBe("org-1");
    });

    test("static key takes priority over DB key", async () => {
      const app = createTestApp(authMiddleware({ staticKey: STATIC_KEY, authDb: store }));
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${STATIC_KEY}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { authType: string };
      expect(body.authType).toBe("master");
    });

    test("revoked DB key returns 403", async () => {
      const created = await store.createKey({
        name: "revoked",
        tenantId: "t1",
        ttlMs: 3_600_000,
      });
      await store.revokeKey(created.id);

      const app = createTestApp(authMiddleware({ staticKey: STATIC_KEY, authDb: store }));
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${created.key}` },
      });
      expect(res.status).toBe(403);
    });

    test("expired DB key returns 403", async () => {
      const created = await store.createKey({ name: "expired", tenantId: "t1", ttlMs: 1 });
      // Wait for expiry
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }

      const app = createTestApp(authMiddleware({ staticKey: STATIC_KEY, authDb: store }));
      const res = await app.request("/test", {
        headers: { Authorization: `Bearer ${created.key}` },
      });
      expect(res.status).toBe(403);
    });
  });
});

// ─── requireMasterKey ───

describe("requireMasterKey", () => {
  const STATIC_KEY = "master-secret";

  test("allows master key through", async () => {
    const app = createTestApp(authMiddleware(STATIC_KEY));
    const res = await app.request("/admin", {
      headers: { Authorization: `Bearer ${STATIC_KEY}` },
    });
    expect(res.status).toBe(200);
  });

  test("blocks non-master auth with 403", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "isol8-req-master-test-"));
    const store = await createAuthStore(join(tempDir, "test.db"));

    try {
      const created = await store.createKey({ name: "api", tenantId: "t1", ttlMs: 3_600_000 });

      const app = createTestApp(authMiddleware({ staticKey: STATIC_KEY, authDb: store }));
      const res = await app.request("/admin", {
        headers: { Authorization: `Bearer ${created.key}` },
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("Master key required");
    } finally {
      await store.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
