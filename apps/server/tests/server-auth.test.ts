import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Docker from "dockerode";
import { createServer } from "../src/index.js";

// Check if Docker is available
let hasDocker = false;
try {
  const docker = new Docker();
  await docker.ping();
  hasDocker = true;
} catch {
  hasDocker = false;
}

describe("Integration: Server Auth & Key Management", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const PORT = 4570;
  const MASTER_KEY = "master-key-for-auth-tests";
  let server: Awaited<ReturnType<typeof createServer>>;
  let serverInstance: any;
  let tempDir: string;

  const authHeaders = {
    Authorization: `Bearer ${MASTER_KEY}`,
    "Content-Type": "application/json",
  };

  const baseUrl = `http://localhost:${PORT}`;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "isol8-server-auth-test-"));
    server = await createServer({
      port: PORT,
      apiKey: MASTER_KEY,
      authDbPath: join(tempDir, "auth.db"),
    });
    serverInstance = Bun.serve({
      fetch: server.app.fetch,
      port: PORT,
      websocket: server.websocket,
    });
  });

  afterAll(async () => {
    serverInstance.stop();
    await server.shutdown(false);
    await rm(tempDir, { recursive: true, force: true });
  });

  // ─── POST /auth/keys ───

  test("POST /auth/keys creates a new key", async () => {
    const res = await fetch(`${baseUrl}/auth/keys`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "test-key", tenantId: "org-1" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      key: string;
      name: string;
      keyPrefix: string;
      tenantId: string;
      expiresAt: string;
    };
    expect(body.id).toBeString();
    expect(body.key).toStartWith("isol8_");
    expect(body.name).toBe("test-key");
    expect(body.tenantId).toBe("org-1");
    expect(body.expiresAt).toBeString();
  }, 30_000);

  test("POST /auth/keys rejects missing name with 400", async () => {
    const res = await fetch(`${baseUrl}/auth/keys`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ tenantId: "org-1" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("name is required");
  }, 30_000);

  // ─── GET /auth/keys ───

  test("GET /auth/keys lists all keys", async () => {
    // Create a key first
    await fetch(`${baseUrl}/auth/keys`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "list-test", tenantId: "org-list" }),
    });

    const res = await fetch(`${baseUrl}/auth/keys`, {
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: any[] };
    expect(body.keys).toBeArray();
    expect(body.keys.length).toBeGreaterThanOrEqual(1);
    // Keys should not contain plaintext key or hash
    for (const key of body.keys) {
      expect(key.key).toBeUndefined();
      expect(key.keyHash).toBeUndefined();
    }
  }, 30_000);

  test("GET /auth/keys filters by tenantId", async () => {
    // Create keys for two different tenants
    await fetch(`${baseUrl}/auth/keys`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "alpha-key", tenantId: "alpha" }),
    });
    await fetch(`${baseUrl}/auth/keys`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "beta-key", tenantId: "beta" }),
    });

    const res = await fetch(`${baseUrl}/auth/keys?tenantId=alpha`, {
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: any[] };
    expect(body.keys.length).toBeGreaterThanOrEqual(1);
    expect(body.keys.every((k: any) => k.tenantId === "alpha")).toBe(true);
  }, 30_000);

  // ─── DELETE /auth/keys/:id ───

  test("DELETE /auth/keys/:id revokes a key", async () => {
    // Create a key to revoke
    const createRes = await fetch(`${baseUrl}/auth/keys`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "to-revoke", tenantId: "org-del" }),
    });
    const created = (await createRes.json()) as { id: string };

    const res = await fetch(`${baseUrl}/auth/keys/${created.id}`, {
      method: "DELETE",
      headers: authHeaders,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBe(created.id);
  }, 30_000);

  test("DELETE /auth/keys/:id returns 404 for unknown id", async () => {
    const res = await fetch(`${baseUrl}/auth/keys/nonexistent-id`, {
      method: "DELETE",
      headers: authHeaders,
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Key not found");
  }, 30_000);

  // ─── POST /auth/login ───

  test("POST /auth/login returns a short-lived token", async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "login-token", tenantId: "org-login" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token: string;
      expiresAt: string;
      keyId: string;
    };
    expect(body.token).toStartWith("isol8_");
    expect(body.expiresAt).toBeString();
    expect(body.keyId).toBeString();
  }, 30_000);

  // ─── Auth enforcement ───

  test("auth routes reject non-master API key with 403", async () => {
    // Create a non-master key via the API
    const createRes = await fetch(`${baseUrl}/auth/keys`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "non-master", tenantId: "org-test" }),
    });
    const created = (await createRes.json()) as { key: string };

    const nonMasterHeaders = {
      Authorization: `Bearer ${created.key}`,
      "Content-Type": "application/json",
    };

    // POST /auth/keys should be blocked
    const postRes = await fetch(`${baseUrl}/auth/keys`, {
      method: "POST",
      headers: nonMasterHeaders,
      body: JSON.stringify({ name: "blocked" }),
    });
    expect(postRes.status).toBe(403);

    // GET /auth/keys should be blocked
    const getRes = await fetch(`${baseUrl}/auth/keys`, {
      headers: nonMasterHeaders,
    });
    expect(getRes.status).toBe(403);

    // POST /auth/login should be blocked
    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: nonMasterHeaders,
    });
    expect(loginRes.status).toBe(403);
  }, 30_000);

  test("auth routes reject unauthenticated requests with 401", async () => {
    const res = await fetch(`${baseUrl}/auth/keys`);
    expect(res.status).toBe(401);
  }, 30_000);
});

describe("Integration: Server Auth Disabled", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const PORT = 4571;
  const API_KEY = "no-db-key";
  let server: Awaited<ReturnType<typeof createServer>>;
  let serverInstance: any;

  const authHeaders = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };

  const baseUrl = `http://localhost:${PORT}`;

  beforeAll(async () => {
    // No authDbPath — DB-backed auth is disabled
    server = await createServer({ port: PORT, apiKey: API_KEY });
    serverInstance = Bun.serve({
      fetch: server.app.fetch,
      port: PORT,
      websocket: server.websocket,
    });
  });

  afterAll(async () => {
    serverInstance.stop();
    await server.shutdown(false);
  });

  test("POST /auth/keys returns 400 when DB auth is disabled", async () => {
    const res = await fetch(`${baseUrl}/auth/keys`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: "nope" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("DB-backed auth is not enabled");
  }, 30_000);

  test("GET /auth/keys returns 400 when DB auth is disabled", async () => {
    const res = await fetch(`${baseUrl}/auth/keys`, {
      headers: authHeaders,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("DB-backed auth is not enabled");
  }, 30_000);

  test("POST /auth/login returns 400 when DB auth is disabled", async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: authHeaders,
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("DB-backed auth is not enabled");
  }, 30_000);
});
