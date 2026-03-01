/**
 * @module server/db/adapters/pg
 *
 * PostgreSQL-backed auth store using pg + Drizzle ORM.
 * All operations are truly async.
 */

import { logger } from "@isol8/core";
import { eq, lt, or } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { apiKeys } from "../schema/pg.js";
import type { ApiKeyInfo, AuthStore, CreateKeyOptions, CreateKeyResult } from "../types.js";
import { generateId, generateKey, hashKey } from "../utils.js";

/**
 * PostgreSQL auth store backed by pg (node-postgres) and Drizzle ORM.
 *
 * Uses a connection pool for efficient connection management.
 * The `api_keys` table is created automatically on first use.
 */
export class PostgresAuthStore implements AuthStore {
  private readonly pool: pg.Pool;
  private readonly db: NodePgDatabase;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
    this.db = drizzle(this.pool);
  }

  /** Run initial migration to create the api_keys table. */
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          key_hash    TEXT NOT NULL UNIQUE,
          key_prefix  TEXT NOT NULL,
          tenant_id   TEXT NOT NULL,
          created_at  TEXT NOT NULL,
          expires_at  TEXT NOT NULL,
          last_used_at TEXT,
          revoked     BOOLEAN NOT NULL DEFAULT FALSE
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)
      `);

      logger.debug("[PostgresAuthStore] Migration complete");
    } finally {
      client.release();
    }
  }

  async createKey(opts: CreateKeyOptions): Promise<CreateKeyResult> {
    const id = generateId();
    const rawKey = generateKey();
    const keyHashValue = hashKey(rawKey);
    const keyPrefix = `${rawKey.slice(0, 10)}...`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + opts.ttlMs).toISOString();

    await this.db.insert(apiKeys).values({
      id,
      name: opts.name,
      keyHash: keyHashValue,
      keyPrefix,
      tenantId: opts.tenantId,
      createdAt: now,
      expiresAt,
      revoked: false,
    });

    logger.debug(
      `[PostgresAuthStore] Created key id=${id} name=${opts.name} tenant=${opts.tenantId}`
    );

    return { id, key: rawKey, name: opts.name, keyPrefix, tenantId: opts.tenantId, expiresAt };
  }

  async validateKey(key: string): Promise<ApiKeyInfo | null> {
    const keyHashValue = hashKey(key);

    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHashValue))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return null;
    }

    if (row.revoked) {
      logger.debug(`[PostgresAuthStore] Key ${row.id} is revoked`);
      return null;
    }

    if (new Date(row.expiresAt) < new Date()) {
      logger.debug(`[PostgresAuthStore] Key ${row.id} is expired`);
      return null;
    }

    // Update lastUsedAt
    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiKeys.id, row.id));

    return this.rowToInfo(row);
  }

  async revokeKey(id: string): Promise<boolean> {
    const result = await this.db.update(apiKeys).set({ revoked: true }).where(eq(apiKeys.id, id));

    const changed = (result as unknown as { rowCount: number }).rowCount > 0;
    if (changed) {
      logger.debug(`[PostgresAuthStore] Revoked key id=${id}`);
    }
    return changed;
  }

  async listKeys(tenantId?: string): Promise<ApiKeyInfo[]> {
    const rows = tenantId
      ? await this.db.select().from(apiKeys).where(eq(apiKeys.tenantId, tenantId))
      : await this.db.select().from(apiKeys);
    return rows.map((r) => this.rowToInfo(r));
  }

  async cleanup(): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.db
      .delete(apiKeys)
      .where(or(eq(apiKeys.revoked, true), lt(apiKeys.expiresAt, now)));

    const count = (result as unknown as { rowCount: number }).rowCount;
    if (count > 0) {
      logger.debug(`[PostgresAuthStore] Cleaned up ${count} expired/revoked keys`);
    }
    return count;
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.debug("[PostgresAuthStore] Pool closed");
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
