/**
 * @module client/remote
 *
 * HTTP client for communicating with a remote isol8 server. Implements the
 * {@link Isol8Engine} interface, so it can be used interchangeably with
 * {@link DockerIsol8} for local-vs-remote execution.
 */

import type { ExecutionRequest, ExecutionResult, Isol8Engine, Isol8Options } from "../types";

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
  async start(): Promise<void> {
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
