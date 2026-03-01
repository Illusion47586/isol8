/**
 * @module server/db/adapters/sqlite
 *
 * SQLite-backed auth store using bun:sqlite + Drizzle ORM.
 * All operations are synchronous under the hood (bun:sqlite is sync),
 * but wrapped in Promises to satisfy the async AuthStore interface.
 */

import { Database } from "bun:sqlite";
import { logger } from "@isol8/core";
import { eq, lt, or } from "drizzle-orm";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { apiKeys } from "../schema/sqlite.js";
import type { ApiKeyInfo, AuthStore, CreateKeyOptions, CreateKeyResult } from "../types.js";
import { generateId, generateKey, hashKey } from "../utils.js";

/** Return type of bun:sqlite .run() — typed as void in drizzle but actually returns this. */
interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/**
 * SQLite auth store backed by bun:sqlite and Drizzle ORM.
 *
 * Keys are stored hashed with SHA-256. The plaintext key is returned only
 * once at creation time and is prefixed with `isol8_` for easy identification.
 */
export class SQLiteAuthStore implements AuthStore {
  private readonly raw: Database;
  private readonly db: BunSQLiteDatabase;

  constructor(dbPath: string) {
    this.raw = new Database(dbPath);
    this.raw.exec("PRAGMA journal_mode = WAL");
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.db = drizzle(this.raw);
    this.migrate();
  }

  /** Create the api_keys table if it doesn't exist. */
  private migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        keyHash     TEXT NOT NULL UNIQUE,
        keyPrefix   TEXT NOT NULL,
        tenantId    TEXT NOT NULL,
        createdAt   TEXT NOT NULL,
        expiresAt   TEXT NOT NULL,
        lastUsedAt  TEXT,
        revoked     INTEGER NOT NULL DEFAULT 0
      )
    `);

    this.raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_api_keys_keyHash ON api_keys(keyHash)
    `);

    logger.debug("[SQLiteAuthStore] Migration complete");
  }

  async createKey(opts: CreateKeyOptions): Promise<CreateKeyResult> {
    const id = generateId();
    const rawKey = generateKey();
    const keyHashValue = hashKey(rawKey);
    const keyPrefix = `${rawKey.slice(0, 10)}...`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + opts.ttlMs).toISOString();

    this.db
      .insert(apiKeys)
      .values({
        id,
        name: opts.name,
        keyHash: keyHashValue,
        keyPrefix,
        tenantId: opts.tenantId,
        createdAt: now,
        expiresAt,
        revoked: false,
      })
      .run();

    logger.debug(
      `[SQLiteAuthStore] Created key id=${id} name=${opts.name} tenant=${opts.tenantId}`
    );

    return { id, key: rawKey, name: opts.name, keyPrefix, tenantId: opts.tenantId, expiresAt };
  }

  async validateKey(key: string): Promise<ApiKeyInfo | null> {
    const keyHashValue = hashKey(key);

    const row = this.db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHashValue)).get();

    if (!row) {
      return null;
    }

    if (row.revoked) {
      logger.debug(`[SQLiteAuthStore] Key ${row.id} is revoked`);
      return null;
    }

    if (new Date(row.expiresAt) < new Date()) {
      logger.debug(`[SQLiteAuthStore] Key ${row.id} is expired`);
      return null;
    }

    // Update lastUsedAt
    this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiKeys.id, row.id))
      .run();

    return this.rowToInfo(row);
  }

  async revokeKey(id: string): Promise<boolean> {
    const result = this.db
      .update(apiKeys)
      .set({ revoked: true })
      .where(eq(apiKeys.id, id))
      .run() as unknown as RunResult;

    const changed = result.changes > 0;
    if (changed) {
      logger.debug(`[SQLiteAuthStore] Revoked key id=${id}`);
    }
    return changed;
  }

  async listKeys(tenantId?: string): Promise<ApiKeyInfo[]> {
    const rows = tenantId
      ? this.db.select().from(apiKeys).where(eq(apiKeys.tenantId, tenantId)).all()
      : this.db.select().from(apiKeys).all();
    return rows.map((r) => this.rowToInfo(r));
  }

  async cleanup(): Promise<number> {
    const now = new Date().toISOString();
    const result = this.db
      .delete(apiKeys)
      .where(or(eq(apiKeys.revoked, true), lt(apiKeys.expiresAt, now)))
      .run() as unknown as RunResult;

    if (result.changes > 0) {
      logger.debug(`[SQLiteAuthStore] Cleaned up ${result.changes} expired/revoked keys`);
    }
    return result.changes;
  }

  async close(): Promise<void> {
    this.raw.close();
    logger.debug("[SQLiteAuthStore] Database closed");
  }

  private rowToInfo(row: typeof apiKeys.$inferSelect): ApiKeyInfo {
    return {
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      tenantId: row.tenantId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      revoked: row.revoked,
    };
  }
}
