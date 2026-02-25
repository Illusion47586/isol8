/**
 * @module server/auth
 *
 * Bearer token authentication middleware for the Hono server.
 * Supports two modes:
 * - **Static**: Single API key via `--key` flag (backward compatible)
 * - **DB-backed**: Validates tokens against an SQLite database with expiry
 *
 * Skips auth for the `/health` endpoint.
 */

import type { Context, Next } from "hono";
import type { AuthDB } from "./db.js";

/** Options for configuring auth middleware. */
export interface AuthMiddlewareOptions {
  /** Static API key (master key). Always checked first. */
  staticKey?: string;
  /** Database-backed auth. Checked when static key doesn't match. */
  authDb?: AuthDB;
}

/**
 * Creates a Hono middleware that validates `Authorization: Bearer <token>` headers.
 *
 * Authentication order:
 * 1. Skip `/health` endpoint
 * 2. Check static key (if configured) — sets `authType = "master"`
 * 3. Check DB key (if configured) — sets `authType = "apikey"` and `tenantId`
 * 4. Reject with 401/403
 *
 * @param options - Auth configuration (static key and/or DB).
 */
export function authMiddleware(options: AuthMiddlewareOptions | string) {
  // Backward compatibility: accept a plain string as static key
  const opts: AuthMiddlewareOptions =
    typeof options === "string" ? { staticKey: options } : options;

  return async (c: Context, next: Next) => {
    // Skip auth for health check
    if (c.req.path === "/health") {
      return next();
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "Missing Authorization header" }, 401);
    }

    const token = authHeader.replace(/^Bearer\s+/i, "");

    // Try static key first (master key)
    if (opts.staticKey && token === opts.staticKey) {
      c.set("authType", "master");
      return next();
    }

    // Try DB key
    if (opts.authDb) {
      const apiKey = opts.authDb.validateKey(token);
      if (apiKey) {
        c.set("authType", "apikey");
        c.set("tenantId", apiKey.tenantId);
        return next();
      }
    }

    return c.json({ error: "Invalid API key" }, 403);
  };
}

/**
 * Creates middleware that restricts access to master key holders only.
 * Used for admin endpoints like key management.
 */
export function requireMasterKey() {
  return async (c: Context, next: Next) => {
    const authType = c.get("authType");
    if (authType !== "master") {
      return c.json({ error: "Master key required for this operation" }, 403);
    }
    return next();
  };
}
