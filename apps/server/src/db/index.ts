/**
 * @module server/db
 *
 * Multi-backend auth store for API key management.
 *
 * Supports SQLite (better-sqlite3), PostgreSQL (pg), and MySQL (mysql2),
 * all through Drizzle ORM. The backend is auto-detected from the connection
 * string:
 *
 * - Plain file path → SQLite (e.g. `./auth.db`, `~/.isol8/auth.db`)
 * - `postgres://` or `postgresql://` → PostgreSQL
 * - `mysql://` → MySQL
 *
 * @example
 * ```typescript
 * // SQLite (default)
 * const store = await createAuthStore("./auth.db");
 *
 * // PostgreSQL
 * const store = await createAuthStore("postgres://user:pass@localhost:5432/isol8");
 *
 * // MySQL
 * const store = await createAuthStore("mysql://user:pass@localhost:3306/isol8");
 * ```
 */

import { logger } from "@isol8/core";
import type { AuthStore } from "./types.js";

export type { ApiKeyInfo, AuthStore, CreateKeyOptions, CreateKeyResult } from "./types.js";

/**
 * Detect the database backend from a connection string.
 *
 * @returns `"postgres"`, `"mysql"`, or `"sqlite"`
 */
export function detectBackend(connectionString: string): "postgres" | "mysql" | "sqlite" {
  if (connectionString.startsWith("postgres://") || connectionString.startsWith("postgresql://")) {
    return "postgres";
  }
  if (connectionString.startsWith("mysql://")) {
    return "mysql";
  }
  return "sqlite";
}

/**
 * Create an auth store for the given connection string.
 *
 * Auto-detects the backend from the URL scheme and runs initial
 * migrations (CREATE TABLE IF NOT EXISTS) before returning.
 *
 * @param connectionString - File path (SQLite) or connection URL (PostgreSQL/MySQL).
 * @returns A fully initialized {@link AuthStore}.
 */
export async function createAuthStore(connectionString: string): Promise<AuthStore> {
  const backend = detectBackend(connectionString);
  logger.debug(`[AuthStore] Detected backend: ${backend} for "${connectionString}"`);

  switch (backend) {
    case "sqlite": {
      const { SQLiteAuthStore } = await import("./adapters/sqlite.js");
      // SQLiteAuthStore constructor runs migrations synchronously
      return new SQLiteAuthStore(connectionString);
    }

    case "postgres": {
      const { PostgresAuthStore } = await import("./adapters/pg.js");
      const store = new PostgresAuthStore(connectionString);
      await store.migrate();
      return store;
    }

    case "mysql": {
      const { MySQLAuthStore } = await import("./adapters/mysql.js");
      const store = new MySQLAuthStore(connectionString);
      await store.migrate();
      return store;
    }

    default: {
      const _exhaustive: never = backend;
      throw new Error(`Unknown backend: ${_exhaustive}`);
    }
  }
}
