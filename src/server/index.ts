/**
 * @module server
 *
 * HTTP server for remote isol8 execution. Built with Hono, designed to run
 * on Bun. Provides endpoints for code execution, file I/O, session management,
 * and health checks. All endpoints (except `/health`) require Bearer token auth.
 */

import { Hono } from "hono";
import { loadConfig } from "../config";
import { Semaphore } from "../engine/concurrency";
import type { DockerIsol8 } from "../engine/docker";
import type { ExecutionRequest, Isol8Options } from "../types";
import { logger } from "../utils/logger";
import { VERSION } from "../version";
import { authMiddleware } from "./auth";

/** Configuration for the isol8 HTTP server. */
export interface ServerOptions {
  /** Port to listen on. */
  port: number;
  /** API key required for Bearer token authentication. */
  apiKey: string;
  /** Enable debug logging for internal server operations. */
  debug?: boolean;
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
 * Lazy-imports DockerIsol8 and runtime adapters to avoid eagerly loading
 * dockerode and its transitive dependencies (ssh2/protobufjs/long) at
 * module initialization time. This is critical for the compiled binary
 * which crashes on Linux if these modules are loaded during bytecode init.
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
export async function createServer(options: ServerOptions) {
  // Lazy-import DockerIsol8 and runtime adapters to avoid eager dockerode loading.
  // The import chain dockerode → ssh2 → protobufjs → long crashes on Linux
  // when compiled with `bun build --compile --minify`.
  const { DockerIsol8 } = await import("../engine/docker");
  await import("../runtime");

  if (options.debug) {
    logger.setDebug(true);
  }

  const config = loadConfig();
  logger.debug("[Server] Config loaded");
  logger.debug(`[Server] Max concurrent: ${config.maxConcurrent}`);
  logger.debug(`[Server] Auto-prune: ${config.cleanup.autoPrune}`);

  const app = new Hono();
  const globalSemaphore = new Semaphore(config.maxConcurrent);

  // Auth middleware
  app.use("*", authMiddleware(options.apiKey));

  // ─── Health ───
  app.get("/health", (c) => c.json({ status: "ok", version: VERSION }));

  // ─── Execute ───
  app.post("/execute", async (c) => {
    const body = await c.req.json<{
      request: ExecutionRequest;
      options?: Isol8Options;
      sessionId?: string;
    }>();

    logger.debug(
      `[Server] POST /execute runtime=${body.request.runtime} sessionId=${body.sessionId ?? "ephemeral"}`
    );
    logger.debug(`[Server] Code length: ${body.request.code.length} chars`);

    const engineOptions: Isol8Options = {
      network: config.defaults.network,
      memoryLimit: config.defaults.memoryLimit,
      cpuLimit: config.defaults.cpuLimit,
      timeoutMs: config.defaults.timeoutMs,
      sandboxSize: config.defaults.sandboxSize,
      tmpSize: config.defaults.tmpSize,
      ...body.options,
      mode: body.sessionId ? "persistent" : "ephemeral",
    };

    let engine: DockerIsol8;

    if (body.sessionId) {
      // Reuse or create persistent session
      const session = sessions.get(body.sessionId);
      if (session) {
        logger.debug(`[Server] Reusing existing session: ${body.sessionId}`);
        engine = session.engine;
        session.lastAccessedAt = Date.now();
      } else {
        logger.debug(`[Server] Creating new session: ${body.sessionId}`);
        engine = new DockerIsol8(engineOptions, config.maxConcurrent);
        await engine.start();
        sessions.set(body.sessionId, { engine, lastAccessedAt: Date.now() });
      }
    } else {
      logger.debug("[Server] Creating ephemeral engine");
      engine = new DockerIsol8(engineOptions, config.maxConcurrent);
      await engine.start();
    }

    try {
      logger.debug("[Server] Acquiring semaphore for /execute");
      await globalSemaphore.acquire();
      try {
        const result = await engine.execute(body.request);
        logger.debug(
          `[Server] Execution completed: exitCode=${result.exitCode} duration=${result.durationMs}ms`
        );
        return c.json(result);
      } finally {
        globalSemaphore.release();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.debug(`[Server] Execution error: ${message}`);
      return c.json({ error: message }, 500);
    } finally {
      // Cleanup ephemeral engine
      if (!body.sessionId) {
        logger.debug("[Server] Cleaning up ephemeral engine");
        await engine.stop();
      }
    }
  });

  // ─── Execute Stream (SSE) ───
  app.post("/execute/stream", async (c) => {
    const body = await c.req.json<{
      request: ExecutionRequest;
      options?: Isol8Options;
      sessionId?: string;
    }>();

    logger.debug(`[Server] POST /execute/stream runtime=${body.request.runtime}`);
    logger.debug(`[Server] Code length: ${body.request.code.length} chars`);

    const engineOptions: Isol8Options = {
      network: config.defaults.network,
      memoryLimit: config.defaults.memoryLimit,
      cpuLimit: config.defaults.cpuLimit,
      timeoutMs: config.defaults.timeoutMs,
      sandboxSize: config.defaults.sandboxSize,
      tmpSize: config.defaults.tmpSize,
      ...body.options,
      mode: "ephemeral",
    };

    const engine = new DockerIsol8(engineOptions, config.maxConcurrent);
    await engine.start();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          logger.debug("[Server] Acquiring semaphore for /execute/stream");
          await globalSemaphore.acquire();
          try {
            for await (const event of engine.executeStream(body.request)) {
              const line = `data: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(line));
            }
            logger.debug("[Server] Stream completed");
          } finally {
            globalSemaphore.release();
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.debug(`[Server] Stream error: ${message}`);
          const errorEvent = `data: ${JSON.stringify({ type: "error", data: message })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
        } finally {
          logger.debug("[Server] Cleaning up stream engine");
          await engine.stop();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  // ─── File Upload ───
  app.post("/file", async (c) => {
    const body = await c.req.json<{
      sessionId: string;
      path: string;
      content: string; // base64 encoded
    }>();

    logger.debug(`[Server] POST /file sessionId=${body.sessionId} path=${body.path}`);

    const session = sessions.get(body.sessionId);
    if (!session) {
      logger.debug(`[Server] Session not found: ${body.sessionId}`);
      return c.json({ error: "Session not found" }, 404);
    }

    session.lastAccessedAt = Date.now();
    const content = Buffer.from(body.content, "base64");
    await session.engine.putFile(body.path, content);
    logger.debug(`[Server] File uploaded: ${body.path} (${content.length} bytes)`);
    return c.json({ ok: true });
  });

  // ─── File Download ───
  app.get("/file", async (c) => {
    const sessionId = c.req.query("sessionId");
    const path = c.req.query("path");

    logger.debug(`[Server] GET /file sessionId=${sessionId} path=${path}`);

    if (!(sessionId && path)) {
      return c.json({ error: "Missing sessionId or path" }, 400);
    }

    const session = sessions.get(sessionId);
    if (!session) {
      logger.debug(`[Server] Session not found: ${sessionId}`);
      return c.json({ error: "Session not found" }, 404);
    }

    session.lastAccessedAt = Date.now();
    const content = await session.engine.getFile(path);
    logger.debug(`[Server] File downloaded: ${path} (${content.length} bytes)`);
    return c.json({ content: content.toString("base64") });
  });

  // ─── Session Cleanup ───
  app.delete("/session/:id", async (c) => {
    const id = c.req.param("id");
    logger.debug(`[Server] DELETE /session/${id}`);
    const session = sessions.get(id);
    if (session) {
      await session.engine.stop();
      sessions.delete(id);
      logger.debug(`[Server] Session destroyed: ${id}`);
    } else {
      logger.debug(`[Server] Session not found (already cleaned up): ${id}`);
    }
    return c.json({ ok: true });
  });

  // Periodic cleanup of stale sessions
  if (config.cleanup.autoPrune) {
    setInterval(async () => {
      const maxAge = config.cleanup.maxContainerAgeMs;
      const now = Date.now();

      for (const [id, session] of sessions) {
        if (now - session.lastAccessedAt > maxAge) {
          logger.debug(`[Server] Auto-pruning stale session: ${id}`);
          await session.engine.stop();
          sessions.delete(id);
        }
      }
    }, 60_000);
  }

  return {
    app,
    fetch: app.fetch,
    port: options.port,
  };
}
