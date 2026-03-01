import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { StreamEvent } from "@isol8/core";
import { RemoteIsol8 } from "@isol8/core";
import Docker from "dockerode";
import { createServer } from "../../../../apps/server/src/index.js";

/**
 * Integration tests for WebSocket streaming via RemoteIsol8 client.
 *
 * These tests start a real isol8 server with WebSocket support and exercise
 * the RemoteIsol8.executeStream() path end-to-end, verifying that the
 * WebSocket transport works correctly through the full stack:
 *   RemoteIsol8 → WebSocket → Hono server → DockerIsol8 → container → stream events
 */

// Check if Docker is available
let hasDocker = false;
try {
  const docker = new Docker();
  await docker.ping();
  hasDocker = true;
} catch {
  hasDocker = false;
}

describe("Integration: RemoteIsol8 WebSocket Streaming", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => { });
    return;
  }

  const PORT = 4580;
  const API_KEY = "ws-remote-integ-key";
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

  test("RemoteIsol8.executeStream() receives stdout via WebSocket", async () => {
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none" }
    );
    await client.start();

    const events: StreamEvent[] = [];
    for await (const event of client.executeStream({
      code: 'print("ws-remote-test")',
      runtime: "python",
    })) {
      events.push(event);
    }

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("ws-remote-test");

    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit!.data).toBe("0");

    await client.stop();
  }, 30_000);

  test("RemoteIsol8.executeStream() receives stderr via WebSocket", async () => {
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none" }
    );
    await client.start();

    const events: StreamEvent[] = [];
    for await (const event of client.executeStream({
      code: "import sys; print('err-msg', file=sys.stderr)",
      runtime: "python",
    })) {
      events.push(event);
    }

    const stderr = events
      .filter((e) => e.type === "stderr")
      .map((e) => e.data)
      .join("");
    expect(stderr).toContain("err-msg");

    await client.stop();
  }, 30_000);

  test("RemoteIsol8.executeStream() streams multiple chunks in order", async () => {
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none" }
    );
    await client.start();

    const events: StreamEvent[] = [];
    for await (const event of client.executeStream({
      code: "for i in range(5): print(f'line-{i}')",
      runtime: "python",
    })) {
      events.push(event);
    }

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    for (let i = 0; i < 5; i++) {
      expect(stdout).toContain(`line-${i}`);
    }

    await client.stop();
  }, 30_000);

  test("RemoteIsol8.executeStream() handles execution errors", async () => {
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none" }
    );
    await client.start();

    const events: StreamEvent[] = [];
    for await (const event of client.executeStream({
      code: "raise RuntimeError('ws-error-test')",
      runtime: "python",
    })) {
      events.push(event);
    }

    const stderr = events
      .filter((e) => e.type === "stderr")
      .map((e) => e.data)
      .join("");
    expect(stderr).toContain("RuntimeError");
    expect(stderr).toContain("ws-error-test");

    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit!.data).not.toBe("0");

    await client.stop();
  }, 30_000);

  test("RemoteIsol8.executeStream() works with Node.js runtime", async () => {
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none" }
    );
    await client.start();

    const events: StreamEvent[] = [];
    for await (const event of client.executeStream({
      code: 'console.log("node-ws-stream")',
      runtime: "node",
    })) {
      events.push(event);
    }

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("node-ws-stream");

    await client.stop();
  }, 30_000);

  test("RemoteIsol8.executeStream() forwards engine options", async () => {
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none", timeoutMs: 15_000 }
    );
    await client.start();

    const events: StreamEvent[] = [];
    for await (const event of client.executeStream({
      code: 'print("options-forwarded")',
      runtime: "python",
    })) {
      events.push(event);
    }

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("options-forwarded");

    await client.stop();
  }, 30_000);

  test("RemoteIsol8.executeStream() can be called multiple times on same client", async () => {
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none" }
    );
    await client.start();

    // First execution
    const events1: StreamEvent[] = [];
    for await (const event of client.executeStream({
      code: 'print("call-1")',
      runtime: "python",
    })) {
      events1.push(event);
    }

    const stdout1 = events1
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout1).toContain("call-1");

    // Second execution on same client
    const events2: StreamEvent[] = [];
    for await (const event of client.executeStream({
      code: 'print("call-2")',
      runtime: "python",
    })) {
      events2.push(event);
    }

    const stdout2 = events2
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout2).toContain("call-2");

    await client.stop();
  }, 60_000);
});
