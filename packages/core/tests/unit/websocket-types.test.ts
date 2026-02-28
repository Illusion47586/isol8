import { describe, expect, test } from "bun:test";
import type { StreamEvent, WsClientMessage, WsServerMessage } from "../../src/types";

/**
 * Unit tests for WebSocket message types.
 *
 * Validates the shape and discriminated-union behavior of WsClientMessage
 * and WsServerMessage. Since these types are used for JSON serialization
 * over WebSocket, correctness here prevents protocol-level bugs.
 */

describe("WsClientMessage", () => {
  test("execute message shape includes request and optional options", () => {
    const msg: WsClientMessage = {
      type: "execute",
      request: { code: "print(1)", runtime: "python" },
      options: { network: "none", timeoutMs: 5000 },
    };

    expect(msg.type).toBe("execute");
    expect(msg.request.code).toBe("print(1)");
    expect(msg.request.runtime).toBe("python");
    expect(msg.options?.network).toBe("none");
  });

  test("execute message works without options", () => {
    const msg: WsClientMessage = {
      type: "execute",
      request: { code: "console.log(1)", runtime: "node" },
    };

    expect(msg.type).toBe("execute");
    expect(msg.request.runtime).toBe("node");
  });

  test("stdin message shape", () => {
    const msg: WsClientMessage = {
      type: "stdin",
      data: "hello\n",
    };

    expect(msg.type).toBe("stdin");
    expect(msg.data).toBe("hello\n");
  });

  test("signal message accepts SIGINT", () => {
    const msg: WsClientMessage = {
      type: "signal",
      signal: "SIGINT",
    };

    expect(msg.type).toBe("signal");
    expect(msg.signal).toBe("SIGINT");
  });

  test("signal message accepts SIGTERM", () => {
    const msg: WsClientMessage = {
      type: "signal",
      signal: "SIGTERM",
    };

    expect(msg.type).toBe("signal");
    expect(msg.signal).toBe("SIGTERM");
  });

  test("discriminated union works with type narrowing", () => {
    const messages: WsClientMessage[] = [
      { type: "execute", request: { code: "1+1", runtime: "python" } },
      { type: "stdin", data: "input" },
      { type: "signal", signal: "SIGINT" },
    ];

    // Simulate server-side type narrowing on each variant
    for (const msg of messages) {
      switch (msg.type) {
        case "execute":
          expect(msg.request).toBeDefined();
          break;
        case "stdin":
          expect(msg.data).toBeDefined();
          break;
        case "signal":
          expect(msg.signal).toBeDefined();
          break;
        default:
          throw new Error(`Unknown type: ${(msg as { type: string }).type}`);
      }
    }
  });

  test("JSON round-trip preserves execute message", () => {
    const original: WsClientMessage = {
      type: "execute",
      request: {
        code: "print('hello')",
        runtime: "python",
        timeoutMs: 10_000,
        env: { FOO: "bar" },
      },
      options: { network: "none", memoryLimit: "256m" },
    };

    const json = JSON.stringify(original);
    const parsed = JSON.parse(json) as WsClientMessage;

    expect(parsed).toEqual(original);
  });

  test("JSON round-trip preserves stdin message", () => {
    const original: WsClientMessage = { type: "stdin", data: "input line\n" };
    const parsed = JSON.parse(JSON.stringify(original)) as WsClientMessage;
    expect(parsed).toEqual(original);
  });

  test("JSON round-trip preserves signal message", () => {
    const original: WsClientMessage = { type: "signal", signal: "SIGINT" };
    const parsed = JSON.parse(JSON.stringify(original)) as WsClientMessage;
    expect(parsed).toEqual(original);
  });
});

describe("WsServerMessage", () => {
  test("is identical to StreamEvent type", () => {
    // WsServerMessage is a type alias for StreamEvent.
    // Verify they are interchangeable at runtime.
    const event: StreamEvent = { type: "stdout", data: "hello\n" };
    const wsMsg: WsServerMessage = event;

    expect(wsMsg.type).toBe("stdout");
    expect(wsMsg.data).toBe("hello\n");
  });

  test("stdout event shape", () => {
    const msg: WsServerMessage = { type: "stdout", data: "output line\n" };
    expect(msg.type).toBe("stdout");
    expect(msg.data).toBe("output line\n");
  });

  test("stderr event shape", () => {
    const msg: WsServerMessage = { type: "stderr", data: "error message\n" };
    expect(msg.type).toBe("stderr");
    expect(msg.data).toBe("error message\n");
  });

  test("exit event shape", () => {
    const msg: WsServerMessage = { type: "exit", data: "0" };
    expect(msg.type).toBe("exit");
    expect(msg.data).toBe("0");
  });

  test("error event shape", () => {
    const msg: WsServerMessage = { type: "error", data: "something went wrong" };
    expect(msg.type).toBe("error");
    expect(msg.data).toBe("something went wrong");
  });

  test("JSON round-trip preserves all event types", () => {
    const events: WsServerMessage[] = [
      { type: "stdout", data: "line 1\n" },
      { type: "stderr", data: "warn\n" },
      { type: "exit", data: "0" },
      { type: "error", data: "timeout" },
    ];

    for (const event of events) {
      const parsed = JSON.parse(JSON.stringify(event)) as WsServerMessage;
      expect(parsed).toEqual(event);
    }
  });
});

describe("WebSocket message parsing (simulated server logic)", () => {
  test("valid JSON parses as WsClientMessage", () => {
    const raw = JSON.stringify({
      type: "execute",
      request: { code: "print(1)", runtime: "python" },
    });

    const msg = JSON.parse(raw) as WsClientMessage;
    expect(msg.type).toBe("execute");
  });

  test("invalid JSON throws SyntaxError", () => {
    expect(() => JSON.parse("not-json")).toThrow();
  });

  test("empty object parses but has no type", () => {
    const msg = JSON.parse("{}") as WsClientMessage;
    expect((msg as any).type).toBeUndefined();
  });

  test("message with unknown type parses without error", () => {
    const raw = JSON.stringify({ type: "unknown-type", data: "test" });
    const msg = JSON.parse(raw) as WsClientMessage;
    expect((msg as any).type).toBe("unknown-type");
  });
});
