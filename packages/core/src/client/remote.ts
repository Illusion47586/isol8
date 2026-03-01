/**
 * @module client/remote
 *
 * HTTP client for communicating with a remote isol8 server. Implements the
 * {@link Isol8Engine} interface, so it can be used interchangeably with
 * {@link DockerIsol8} for local-vs-remote execution.
 */

import type {
  ExecutionRequest,
  ExecutionResult,
  Isol8Engine,
  Isol8Options,
  SessionInfo,
  StartOptions,
  StreamEvent,
  WsClientMessage,
} from "../types";

/** Connection options for the remote isol8 client. */
export interface RemoteIsol8Options {
  /** Base URL of the isol8 server (e.g. `"http://localhost:3000"`). */
  host: string;
  /** API key for Bearer token authentication. */
  apiKey: string;
  /** Optional session ID for persistent mode. If set, the server maintains container state across calls. */
  sessionId?: string;
}

/**
 * Remote isol8 client that communicates with an isol8 server over HTTP.
 * Implements the {@link Isol8Engine} interface for seamless local/remote switching.
 *
 * @example
 * ```typescript
 * const isol8 = new RemoteIsol8(
 *   { host: "http://localhost:3000", apiKey: "secret" },
 *   { network: "none" }
 * );
 * await isol8.start();
 * const result = await isol8.execute({ code: "print(1)", runtime: "python" });
 * await isol8.stop();
 * ```
 */
export class RemoteIsol8 implements Isol8Engine {
  private readonly host: string;
  private readonly apiKey: string;
  private readonly sessionId?: string;
  private readonly isol8Options?: Isol8Options;
  /** Whether WebSocket streaming is available on the server. `null` = unknown. */
  private wsAvailable: boolean | null = null;

  /**
   * @param options - Connection options (host, API key, session ID).
   * @param isol8Options - Isol8 configuration to send to the server.
   */
  constructor(options: RemoteIsol8Options, isol8Options?: Isol8Options) {
    this.host = options.host.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.sessionId = options.sessionId;
    this.isol8Options = isol8Options;
  }

  /** Verify the remote server is reachable by hitting the `/health` endpoint. */
  async start(_options?: StartOptions): Promise<void> {
    // Verify server is reachable
    const res = await this.fetch("/health");
    if (!res.ok) {
      throw new Error(`Remote server health check failed: ${res.status}`);
    }
  }

  /** Destroy the remote session (if persistent). No-op for ephemeral mode. */
  async stop(): Promise<void> {
    if (this.sessionId) {
      await this.fetch(`/session/${this.sessionId}`, { method: "DELETE" });
    }
  }

  /** Execute code on the remote server and return the result. */
  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const res = await this.fetch("/execute", {
      method: "POST",
      body: JSON.stringify({
        request: req,
        options: this.isol8Options,
        sessionId: this.sessionId,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Execution failed: ${(body as { error?: string }).error ?? res.statusText}`);
    }

    return res.json() as Promise<ExecutionResult>;
  }

  /**
   * Execute code on the remote server and stream output chunks.
   * Attempts WebSocket first, falls back to SSE if WebSocket is unavailable.
   * Yields {@link StreamEvent} objects as they arrive from the server.
   */
  async *executeStream(req: ExecutionRequest): AsyncIterable<StreamEvent> {
    // Try WebSocket if we haven't determined it's unavailable
    if (this.wsAvailable !== false) {
      try {
        yield* this.executeStreamWs(req);
        return;
      } catch (err) {
        // If WebSocket fails on first attempt, fall back to SSE
        if (this.wsAvailable === null) {
          this.wsAvailable = false;
        } else {
          throw err;
        }
      }
    }

    // Fall back to SSE
    yield* this.executeStreamSse(req);
  }

  /**
   * Execute code on the remote server and stream output chunks via WebSocket.
   * @internal
   */
  private async *executeStreamWs(req: ExecutionRequest): AsyncIterable<StreamEvent> {
    const wsUrl = `${this.host.replace(/^http/, "ws")}/execute/ws`;

    const events: StreamEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;
    let wsError: Error | null = null;

    // Bun's WebSocket supports custom headers via a second options argument.
    // The standard WebSocket type doesn't include this, so we cast through unknown.
    const ws = new WebSocket(wsUrl, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    } as never);

    const waitForEvent = (): Promise<void> =>
      new Promise<void>((r) => {
        if (events.length > 0 || done) {
          r();
        } else {
          resolve = r;
        }
      });

    ws.onopen = () => {
      this.wsAvailable = true;
      const msg: WsClientMessage = {
        type: "execute",
        request: req,
        ...(this.isol8Options ? { options: this.isol8Options } : {}),
      };
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(
          typeof evt.data === "string" ? evt.data : String(evt.data)
        ) as StreamEvent;
        events.push(event);
        if (resolve) {
          const r = resolve;
          resolve = null;
          r();
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onerror = () => {
      if (!done) {
        wsError = new Error("WebSocket connection failed");
        done = true;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r();
        }
      }
    };

    ws.onclose = () => {
      done = true;
      if (resolve) {
        const r = resolve;
        resolve = null;
        r();
      }
    };

    try {
      while (true) {
        await waitForEvent();

        if (wsError) {
          throw wsError;
        }

        while (events.length > 0) {
          yield events.shift()!;
        }

        if (done) {
          break;
        }
      }
    } finally {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
  }

  /**
   * Execute code on the remote server and stream output chunks via SSE.
   * @internal
   */
  private async *executeStreamSse(req: ExecutionRequest): AsyncIterable<StreamEvent> {
    const res = await this.fetch("/execute/stream", {
      method: "POST",
      body: JSON.stringify({
        request: req,
        options: this.isol8Options,
        sessionId: this.sessionId,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`Stream failed: ${(body as { error?: string }).error ?? res.statusText}`);
    }

    if (!res.body) {
      throw new Error("No response body for streaming");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const json = line.slice(6).trim();
            if (json) {
              yield JSON.parse(json) as StreamEvent;
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.startsWith("data: ")) {
        const json = buffer.slice(6).trim();
        if (json) {
          yield JSON.parse(json) as StreamEvent;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Upload a file to the remote container (persistent mode only).
   * Content is Base64-encoded for transport.
   */
  async putFile(path: string, content: Buffer | string): Promise<void> {
    if (!this.sessionId) {
      throw new Error("File operations require a sessionId (persistent mode)");
    }

    const base64 =
      typeof content === "string"
        ? Buffer.from(content).toString("base64")
        : content.toString("base64");

    const res = await this.fetch("/file", {
      method: "POST",
      body: JSON.stringify({
        sessionId: this.sessionId,
        path,
        content: base64,
      }),
    });

    if (!res.ok) {
      throw new Error(`File upload failed: ${res.statusText}`);
    }
  }

  /** Download a file from the remote container (persistent mode only). */
  async getFile(path: string): Promise<Buffer> {
    if (!this.sessionId) {
      throw new Error("File operations require a sessionId (persistent mode)");
    }

    const params = new URLSearchParams({ sessionId: this.sessionId, path });
    const res = await this.fetch(`/file?${params}`);

    if (!res.ok) {
      throw new Error(`File download failed: ${res.statusText}`);
    }

    const body = (await res.json()) as { content: string };
    return Buffer.from(body.content, "base64");
  }

  /**
   * List all active sessions on the remote server.
   * Requires authentication but no session ID.
   */
  async listSessions(): Promise<SessionInfo[]> {
    const res = await this.fetch("/sessions");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `Failed to list sessions: ${(body as { error?: string }).error ?? res.statusText}`
      );
    }
    const body = (await res.json()) as { sessions: SessionInfo[] };
    return body.sessions;
  }

  /**
   * Delete a specific session on the remote server by ID.
   * The session's container is stopped and removed.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const res = await this.fetch(`/session/${sessionId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `Failed to delete session: ${(body as { error?: string }).error ?? res.statusText}`
      );
    }
  }

  /** Internal fetch wrapper that attaches auth and content-type headers. */
  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(`${this.host}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(init?.headers ?? {}),
      },
    });
  }
}
