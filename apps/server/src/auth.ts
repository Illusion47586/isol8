/**
 * @module server/auth
 *
 * Bearer token authentication middleware for the Hono server.
 * Skips auth for the `/health` endpoint.
 */

import type { Context, Next } from "hono";

/**
 * Creates a Hono middleware that validates `Authorization: Bearer <token>` headers.
 * Returns 401 if the header is missing, 403 if the token is invalid.
 * The `/health` endpoint is excluded from auth checks.
 *
 * @param apiKey - The expected API key.
 */
export function authMiddleware(apiKey: string) {
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
    if (token !== apiKey) {
      return c.json({ error: "Invalid API key" }, 403);
    }

    return next();
  };
}
