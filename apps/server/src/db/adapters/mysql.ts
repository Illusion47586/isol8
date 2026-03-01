/**
 * @module server/db/adapters/mysql
 *
 * MySQL-backed auth store using mysql2 + Drizzle ORM.
 * All operations are truly async.
 */

import { logger } from "@isol8/core";
import { eq, lt, or } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { apiKeys } from "../schema/mysql.js";
import type { ApiKeyInfo, AuthStore, CreateKeyOptions, CreateKeyResult } from "../types.js";
import { generateId, generateKey, hashKey } from "../utils.js";

/**
 * MySQL auth store backed by mysql2 and Drizzle ORM.
 *
 * Uses a connection pool for efficient connection management.
 * The `api_keys` table is created automatically on first use.
 */
export class MySQLAuthStore implements AuthStore {
  private readonly pool: mysql.Pool;
  private readonly db: MySql2Database;

  constructor(connectionString: string) {
    this.pool = mysql.createPool(connectionString);
    this.db = drizzle(this.pool);
  }

  /** Run initial migration to create the api_keys table. */
  async migrate(): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id          VARCHAR(36) PRIMARY KEY,
          name        TEXT NOT NULL,
          key_hash    VARCHAR(64) NOT NULL UNIQUE,
          key_prefix  VARCHAR(20) NOT NULL,
          tenant_id   VARCHAR(255) NOT NULL,
          created_at  VARCHAR(30) NOT NULL,
          expires_at  VARCHAR(30) NOT NULL,
          last_used_at VARCHAR(30),
          revoked     BOOLEAN NOT NULL DEFAULT FALSE
        )
      `);

      // MySQL uses IF NOT EXISTS differently for indexes depending on version.
      // Use a stored procedure pattern or just catch the error.
      await conn
        .query(`
        CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash)
      `)
        .catch(() => {
          // Index already exists — ignore
        });

      logger.debug("[MySQLAuthStore] Migration complete");
    } finally {
      conn.release();
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

    logger.debug(`[MySQLAuthStore] Created key id=${id} name=${opts.name} tenant=${opts.tenantId}`);

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
      logger.debug(`[MySQLAuthStore] Key ${row.id} is revoked`);
      return null;
    }

    if (new Date(row.expiresAt) < new Date()) {
      logger.debug(`[MySQLAuthStore] Key ${row.id} is expired`);
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

    // mysql2 returns [ResultSetHeader, ...] from drizzle
    const header = (result as unknown as [{ affectedRows: number }])[0];
    const changed = header.affectedRows > 0;
    if (changed) {
      logger.debug(`[MySQLAuthStore] Revoked key id=${id}`);
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

    const header = (result as unknown as [{ affectedRows: number }])[0];
    const count = header.affectedRows;
    if (count > 0) {
      logger.debug(`[MySQLAuthStore] Cleaned up ${count} expired/revoked keys`);
    }
    return count;
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.debug("[MySQLAuthStore] Pool closed");
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
