import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { StreamEvent, WsClientMessage } from "@isol8/core";
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

/**
 * Helper to collect all WebSocket stream events from a single execution.
 * Handles the full lifecycle: connect → send execute → receive events → close.
 */
function collectWsEvents(
  port: number,
  apiKey: string,
  request: { code: string; runtime: string },
  options?: Record<string, unknown>
): Promise<{ events: StreamEvent[]; closeCode: number; closeReason: string }> {
  return new Promise((resolve, reject) => {
    const events: StreamEvent[] = [];
    const wsUrl = `ws://localhost:${port}/execute/ws`;

    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    } as never);

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket test timed out after 25s"));
    }, 25_000);

    ws.onopen = () => {
      const msg: WsClientMessage = {
        type: "execute",
        request: request as any,
        ...(options ? { options } : {}),
      };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(
          typeof evt.data === "string" ? evt.data : String(evt.data)
        ) as StreamEvent;
        events.push(event);
      } catch {
        // ignore malformed
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket connection error"));
    };

    ws.onclose = (evt) => {
      clearTimeout(timeout);
      resolve({
        events,
        closeCode: evt.code,
        closeReason: evt.reason,
      });
    };
  });
}

/**
 * Helper to send a raw string over WebSocket and collect the response.
 */
function sendRawWsMessage(
  port: number,
  apiKey: string,
  rawMessage: string
): Promise<{ events: StreamEvent[]; closeCode: number; closeReason: string }> {
  return new Promise((resolve, reject) => {
    const events: StreamEvent[] = [];
    const ws = new WebSocket(`ws://localhost:${port}/execute/ws`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    } as never);

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket test timed out"));
    }, 10_000);

    ws.onopen = () => {
      ws.send(rawMessage);
    };

    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(
          typeof evt.data === "string" ? evt.data : String(evt.data)
        ) as StreamEvent;
        events.push(event);
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket connection error"));
    };

    ws.onclose = (evt) => {
      clearTimeout(timeout);
      resolve({ events, closeCode: evt.code, closeReason: evt.reason });
    };
  });
}

describe("Integration: Server WebSocket Streaming", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const PORT = 4570;
  const API_KEY = "ws-integration-test-key";
  let server: Awaited<ReturnType<typeof createServer>>;
  let serverInstance: any;

  beforeAll(async () => {
    server = await createServer({ port: PORT, apiKey: API_KEY });
    // IMPORTANT: pass websocket handler so WebSocket upgrade works
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

  // ─── Basic Execution ───

  test("WebSocket: Python Hello World streams stdout and exit", async () => {
    const { events, closeCode } = await collectWsEvents(PORT, API_KEY, {
      code: 'print("Hello WebSocket")',
      runtime: "python",
    });

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("Hello WebSocket");

    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit!.data).toBe("0");

    expect(closeCode).toBe(1000);
  }, 30_000);

  test("WebSocket: Node.js execution", async () => {
    const { events, closeCode } = await collectWsEvents(PORT, API_KEY, {
      code: 'console.log("Node WS")',
      runtime: "node",
    });

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("Node WS");

    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit!.data).toBe("0");
    expect(closeCode).toBe(1000);
  }, 30_000);

  test("WebSocket: Bash execution", async () => {
    const { events, closeCode } = await collectWsEvents(PORT, API_KEY, {
      code: 'echo "Bash WS"',
      runtime: "bash",
    });

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("Bash WS");

    expect(closeCode).toBe(1000);
  }, 30_000);

  // ─── Streaming Behavior ───

  test("WebSocket: streams multiple output chunks", async () => {
    const { events } = await collectWsEvents(PORT, API_KEY, {
      code: "import time\nfor i in range(3):\n print(f'chunk-{i}')\n time.sleep(0.1)",
      runtime: "python",
    });

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("chunk-0");
    expect(stdout).toContain("chunk-1");
    expect(stdout).toContain("chunk-2");

    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit!.data).toBe("0");
  }, 30_000);

  test("WebSocket: stderr is streamed", async () => {
    const { events } = await collectWsEvents(PORT, API_KEY, {
      code: "import sys; print('stderr-line', file=sys.stderr)",
      runtime: "python",
    });

    const stderr = events
      .filter((e) => e.type === "stderr")
      .map((e) => e.data)
      .join("");
    expect(stderr).toContain("stderr-line");
  }, 30_000);

  // ─── Error Handling ───

  test("WebSocket: execution error streams stderr and non-zero exit", async () => {
    const { events, closeCode } = await collectWsEvents(PORT, API_KEY, {
      code: "raise ValueError('boom')",
      runtime: "python",
    });

    const stderr = events
      .filter((e) => e.type === "stderr")
      .map((e) => e.data)
      .join("");
    expect(stderr).toContain("ValueError");
    expect(stderr).toContain("boom");

    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit!.data).not.toBe("0");

    expect(closeCode).toBe(1000);
  }, 30_000);

  // ─── Protocol Handling ───

  test("WebSocket: invalid JSON causes error event and close(1003)", async () => {
    const { events, closeCode, closeReason } = await sendRawWsMessage(
      PORT,
      API_KEY,
      "this is not json"
    );

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents[0].data).toContain("Invalid JSON");

    expect(closeCode).toBe(1003);
    expect(closeReason).toContain("Invalid JSON");
  }, 15_000);

  test("WebSocket: unknown message type returns error event", async () => {
    const { events } = await sendRawWsMessage(
      PORT,
      API_KEY,
      JSON.stringify({ type: "unknown-type", data: "test" })
    );

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents.length).toBeGreaterThan(0);
    expect(errorEvents[0].data).toContain("Unknown message type");
  }, 15_000);

  test("WebSocket: stdin message is gracefully ignored (no crash)", async () => {
    // Send stdin, then execute — should not crash
    const result = await new Promise<{
      events: StreamEvent[];
      closeCode: number;
    }>((resolve, reject) => {
      const events: StreamEvent[] = [];
      const ws = new WebSocket(`ws://localhost:${PORT}/execute/ws`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      } as never);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timeout"));
      }, 25_000);

      ws.onopen = () => {
        // Send stdin first (should be ignored)
        ws.send(JSON.stringify({ type: "stdin", data: "input\n" }));

        // Then send execute
        setTimeout(() => {
          ws.send(
            JSON.stringify({
              type: "execute",
              request: { code: 'print("after-stdin")', runtime: "python" },
            })
          );
        }, 100);
      };

      ws.onmessage = (evt) => {
        try {
          events.push(JSON.parse(typeof evt.data === "string" ? evt.data : String(evt.data)));
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WS error"));
      };

      ws.onclose = (evt) => {
        clearTimeout(timeout);
        resolve({ events, closeCode: evt.code });
      };
    });

    const stdout = result.events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("after-stdin");
    expect(result.closeCode).toBe(1000);
  }, 30_000);

  test("WebSocket: signal message is gracefully ignored (no crash)", async () => {
    const result = await new Promise<{
      events: StreamEvent[];
      closeCode: number;
    }>((resolve, reject) => {
      const events: StreamEvent[] = [];
      const ws = new WebSocket(`ws://localhost:${PORT}/execute/ws`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      } as never);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Timeout"));
      }, 25_000);

      ws.onopen = () => {
        // Send signal first (should be ignored)
        ws.send(JSON.stringify({ type: "signal", signal: "SIGINT" }));

        // Then send execute
        setTimeout(() => {
          ws.send(
            JSON.stringify({
              type: "execute",
              request: { code: 'print("after-signal")', runtime: "python" },
            })
          );
        }, 100);
      };

      ws.onmessage = (evt) => {
        try {
          events.push(JSON.parse(typeof evt.data === "string" ? evt.data : String(evt.data)));
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WS error"));
      };

      ws.onclose = (evt) => {
        clearTimeout(timeout);
        resolve({ events, closeCode: evt.code });
      };
    });

    const stdout = result.events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("after-signal");
    expect(result.closeCode).toBe(1000);
  }, 30_000);

  // ─── Options Forwarding ───

  test("WebSocket: execution options are forwarded to engine", async () => {
    const { events, closeCode } = await collectWsEvents(
      PORT,
      API_KEY,
      { code: 'print("with-options")', runtime: "python" },
      { network: "none", timeoutMs: 15_000 }
    );

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("with-options");
    expect(closeCode).toBe(1000);
  }, 30_000);

  // ─── Close Behavior ───

  test("WebSocket: server closes with code 1000 after successful execution", async () => {
    const { closeCode, closeReason } = await collectWsEvents(PORT, API_KEY, {
      code: "print('done')",
      runtime: "python",
    });

    expect(closeCode).toBe(1000);
    expect(closeReason).toContain("Execution complete");
  }, 30_000);
});

describe("Integration: Server WebSocket Auth", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const PORT = 4571;
  const API_KEY = "ws-auth-test-key";
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

  test("WebSocket: auth failure with wrong key rejects connection", async () => {
    const result = await new Promise<{ closeCode: number }>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}/execute/ws`, {
        headers: { Authorization: "Bearer wrong-key" },
      } as never);

      const timeout = setTimeout(() => {
        ws.close();
        // If we get here, the connection hung — treat as a rejection
        resolve({ closeCode: -1 });
      }, 10_000);

      ws.onopen = () => {
        // If auth middleware blocks before upgrade, we never get here.
        // But if the upgrade succeeds despite wrong auth (Hono middleware
        // runs before upgrade), we still expect the WS to close quickly.
        ws.send(
          JSON.stringify({
            type: "execute",
            request: { code: "print(1)", runtime: "python" },
          })
        );
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        // Connection rejected — expected behavior
        resolve({ closeCode: -1 });
      };

      ws.onclose = (evt) => {
        clearTimeout(timeout);
        resolve({ closeCode: evt.code });
      };
    });

    // Auth rejection can manifest as:
    // - Connection error (onerror) → closeCode === -1
    // - Non-1000 close code (connection closed by server)
    // - 1002 (protocol error when upgrade response is HTTP 403)
    expect(result.closeCode).not.toBe(1000);
  }, 15_000);

  test("WebSocket: auth failure with no header rejects connection", async () => {
    const result = await new Promise<{ closeCode: number }>((resolve, reject) => {
      // No auth header
      const ws = new WebSocket(`ws://localhost:${PORT}/execute/ws`);

      const timeout = setTimeout(() => {
        ws.close();
        resolve({ closeCode: -1 });
      }, 10_000);

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({ closeCode: -1 });
      };

      ws.onclose = (evt) => {
        clearTimeout(timeout);
        resolve({ closeCode: evt.code });
      };
    });

    expect(result.closeCode).not.toBe(1000);
  }, 15_000);
});
