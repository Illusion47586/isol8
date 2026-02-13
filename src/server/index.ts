/**
 * @module server
 *
 * HTTP server for remote isol8 execution. Built with Hono, designed to run
 * on Bun. Provides endpoints for code execution, file I/O, session management,
 * and health checks. All endpoints (except `/health`) require Bearer token auth.
 */

import { Hono } from "hono";
import { loadConfig } from "../config";
import { DockerIsol8 } from "../engine/docker";
import type { ExecutionRequest, Isol8Options } from "../types";
import { authMiddleware } from "./auth";

// Import runtime adapters (registers them in the registry)
import "../runtime";

/** Configuration for the isol8 HTTP server. */
export interface ServerOptions {
  /** Port to listen on. */
  port: number;
  /** API key required for Bearer token authentication. */
  apiKey: string;
}

/** Internal state for a persistent isol8 session. */
interface SessionState {
  engine: DockerIsol8;
  /** Timestamp of last access (for stale session cleanup). */
  lastAccessedAt: number;
}

const sessions = new Map<string, SessionState>();

/**
 * Creates and configures the isol8 HTTP server.
 *
 * @param options - Server configuration (port, API key).
 * @returns Object containing the Hono `app`, `fetch` handler, and resolved `port`.
 *
 * @example
 * ```typescript
 * const server = createServer({ port: 3000, apiKey: "secret" });
 * Bun.serve({ fetch: server.app.fetch, port: server.port });
 * ```
 */
export function createServer(options: ServerOptions) {
  const config = loadConfig();
  const app = new Hono();

  // Auth middleware
  app.use("*", authMiddleware(options.apiKey));

  // ─── Health ───
  app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

  // ─── Execute ───
  app.post("/execute", async (c) => {
    const body = await c.req.json<{
      request: ExecutionRequest;
      options?: Isol8Options;
      sessionId?: string;
    }>();

    const engineOptions: Isol8Options = {
      ...body.options,
      mode: body.sessionId ? "persistent" : "ephemeral",
    };

    let engine: DockerIsol8;

    if (body.sessionId) {
      // Reuse or create persistent session
      const session = sessions.get(body.sessionId);
      if (session) {
        engine = session.engine;
        session.lastAccessedAt = Date.now();
      } else {
        engine = new DockerIsol8(engineOptions, config.maxConcurrent);
        await engine.start();
        sessions.set(body.sessionId, { engine, lastAccessedAt: Date.now() });
      }
    } else {
      engine = new DockerIsol8(engineOptions, config.maxConcurrent);
      await engine.start();
    }

    try {
      const result = await engine.execute(body.request);

      // Cleanup ephemeral engine
      if (!body.sessionId) {
        await engine.stop();
      }

      return c.json(result);
    } catch (err) {
      if (!body.sessionId) {
        await engine.stop();
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  // ─── File Upload ───
  app.post("/file", async (c) => {
    const body = await c.req.json<{
      sessionId: string;
      path: string;
      content: string; // base64 encoded
    }>();

    const session = sessions.get(body.sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    session.lastAccessedAt = Date.now();
    const content = Buffer.from(body.content, "base64");
    await session.engine.putFile(body.path, content);
    return c.json({ ok: true });
  });

  // ─── File Download ───
  app.get("/file", async (c) => {
    const sessionId = c.req.query("sessionId");
    const path = c.req.query("path");

    if (!(sessionId && path)) {
      return c.json({ error: "Missing sessionId or path" }, 400);
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    session.lastAccessedAt = Date.now();
    const content = await session.engine.getFile(path);
    return c.json({ content: content.toString("base64") });
  });

  // ─── Session Cleanup ───
  app.delete("/session/:id", async (c) => {
    const id = c.req.param("id");
    const session = sessions.get(id);
    if (session) {
      await session.engine.stop();
      sessions.delete(id);
    }
    return c.json({ ok: true });
  });

  // Periodic cleanup of stale sessions
  setInterval(async () => {
    const maxAge = config.cleanup.maxContainerAgeMs;
    const now = Date.now();

    for (const [id, session] of sessions) {
      if (now - session.lastAccessedAt > maxAge) {
        await session.engine.stop();
        sessions.delete(id);
      }
    }
  }, 60_000);

  return {
    app,
    fetch: app.fetch,
    port: options.port,
  };
}
