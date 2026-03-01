import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SessionInfo } from "@isol8/core";
import { RemoteIsol8 } from "@isol8/core";
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

describe("Integration: Session Management", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const PORT = 4569;
  const API_KEY = "session-test-key";
  let server: Awaited<ReturnType<typeof createServer>>;
  let serverInstance: any;

  beforeAll(async () => {
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

  // ─── GET /sessions endpoint ───

  test("GET /sessions returns empty list when no sessions exist", async () => {
    const res = await fetch(`http://localhost:${PORT}/sessions`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: SessionInfo[] };
    expect(body.sessions).toBeArray();
    expect(body.sessions.length).toBe(0);
  });

  test("GET /sessions requires auth", async () => {
    const res = await fetch(`http://localhost:${PORT}/sessions`);
    expect(res.status).toBe(401);
  });

  test("GET /sessions rejects invalid key", async () => {
    const res = await fetch(`http://localhost:${PORT}/sessions`, {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(res.status).toBe(403);
  });

  // ─── Session lifecycle via raw HTTP ───

  test("session appears in list after execution", async () => {
    const sessionId = "test-session-list";

    // Create a persistent session by executing code
    const execRes = await fetch(`http://localhost:${PORT}/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        request: { code: "print('hello')", runtime: "python" },
      }),
    });
    expect(execRes.status).toBe(200);

    // List sessions — our session should appear
    const listRes = await fetch(`http://localhost:${PORT}/sessions`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const body = (await listRes.json()) as { sessions: SessionInfo[] };
    const session = body.sessions.find((s) => s.id === sessionId);

    expect(session).toBeDefined();
    expect(session!.isActive).toBe(false); // execution completed, session is idle
    expect(session!.lastAccessedAt).toBeTruthy();
    // lastAccessedAt should be a valid ISO date string
    expect(Number.isNaN(Date.parse(session!.lastAccessedAt))).toBe(false);

    // Clean up
    await fetch(`http://localhost:${PORT}/session/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
  }, 30_000);

  test("session disappears from list after DELETE", async () => {
    const sessionId = "test-session-delete";

    // Create session
    await fetch(`http://localhost:${PORT}/execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        request: { code: "print('temp')", runtime: "python" },
      }),
    });

    // Verify it exists
    let listRes = await fetch(`http://localhost:${PORT}/sessions`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    let body = (await listRes.json()) as { sessions: SessionInfo[] };
    expect(body.sessions.some((s) => s.id === sessionId)).toBe(true);

    // Delete it
    const delRes = await fetch(`http://localhost:${PORT}/session/${sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    expect(delRes.status).toBe(200);

    // Verify it's gone
    listRes = await fetch(`http://localhost:${PORT}/sessions`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    body = (await listRes.json()) as { sessions: SessionInfo[] };
    expect(body.sessions.some((s) => s.id === sessionId)).toBe(false);
  }, 30_000);

  test("multiple sessions appear in list", async () => {
    const ids = ["multi-session-a", "multi-session-b"];

    // Create two sessions
    for (const id of ids) {
      await fetch(`http://localhost:${PORT}/execute`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: id,
          request: { code: "print(1)", runtime: "python" },
        }),
      });
    }

    // List — both should be present
    const listRes = await fetch(`http://localhost:${PORT}/sessions`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const body = (await listRes.json()) as { sessions: SessionInfo[] };
    for (const id of ids) {
      expect(body.sessions.some((s) => s.id === id)).toBe(true);
    }

    // Clean up
    for (const id of ids) {
      await fetch(`http://localhost:${PORT}/session/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
    }
  }, 60_000);

  // ─── RemoteIsol8 client methods ───

  test("RemoteIsol8.listSessions() returns sessions", async () => {
    const sessionId = "client-list-test";

    // Create a session via a separate client
    const sessionClient = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY, sessionId },
      { network: "none" }
    );
    await sessionClient.execute({
      code: "print('setup')",
      runtime: "python",
    });

    // Use a sessionless client to list sessions
    const listClient = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none" }
    );
    const sessions = await listClient.listSessions();

    expect(sessions).toBeArray();
    const found = sessions.find((s) => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found!.isActive).toBe(false); // execution completed, session is idle
    expect(typeof found!.lastAccessedAt).toBe("string");

    // Clean up
    await sessionClient.stop();
  }, 30_000);

  test("RemoteIsol8.deleteSession() destroys a session", async () => {
    const sessionId = "client-delete-test";

    // Create a session
    const sessionClient = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY, sessionId },
      { network: "none" }
    );
    await sessionClient.execute({
      code: "print('to-delete')",
      runtime: "python",
    });

    // Delete via a different client instance
    const mgmtClient = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none" }
    );
    await mgmtClient.deleteSession(sessionId);

    // Verify it's gone
    const sessions = await mgmtClient.listSessions();
    expect(sessions.some((s) => s.id === sessionId)).toBe(false);
  }, 30_000);

  test("RemoteIsol8.deleteSession() is idempotent", async () => {
    const mgmtClient = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none" }
    );

    // Deleting a non-existent session should not throw
    await mgmtClient.deleteSession("nonexistent-session-xyz");
  });
});
