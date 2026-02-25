/**
 * @module server/db
 *
 * SQLite-backed API key storage using bun:sqlite.
 * Keys are stored as SHA-256 hashes — plaintext keys are returned only on creation.
 */

import { Database } from "bun:sqlite";
import { logger } from "@isol8/core";

/** Row shape returned by SELECT queries on the api_keys table. */
export interface ApiKeyRow {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  tenantId: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revoked: number; // SQLite stores booleans as 0/1
}

/** Public API key info (never includes hash). */
export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  tenantId: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

/** Result of creating a new API key. Contains the plaintext key (shown once). */
export interface CreateKeyResult {
  id: string;
  key: string;
  name: string;
  keyPrefix: string;
  tenantId: string;
  expiresAt: string;
}

/** Options for creating a new API key. */
export interface CreateKeyOptions {
  name: string;
  tenantId: string;
  ttlMs: number;
}

/**
 * Database-backed API key manager using bun:sqlite.
 *
 * Keys are stored hashed with SHA-256. The plaintext key is returned only
 * once at creation time and is prefixed with `isol8_` for easy identification.
 */
export class AuthDB {
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  /** Create the api_keys table if it doesn't exist. */
  private migrate(): void {
    this.db.exec(`
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

    // Index for fast hash lookups during validation
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_api_keys_keyHash ON api_keys(keyHash)
    `);

    logger.debug("[AuthDB] Migration complete");
  }

  /**
   * Create a new API key.
   * Returns the plaintext key — this is the ONLY time the key is available.
   */
  createKey(opts: CreateKeyOptions): CreateKeyResult {
    const id = crypto.randomUUID();
    const rawKey = this.generateKey();
    const keyHash = this.hashKey(rawKey);
    const keyPrefix = `${rawKey.slice(0, 10)}...`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + opts.ttlMs).toISOString();

    this.db
      .prepare(
        `INSERT INTO api_keys (id, name, keyHash, keyPrefix, tenantId, createdAt, expiresAt, revoked)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(id, opts.name, keyHash, keyPrefix, opts.tenantId, now, expiresAt);

    logger.debug(`[AuthDB] Created key id=${id} name=${opts.name} tenant=${opts.tenantId}`);

    return {
      id,
      key: rawKey,
      name: opts.name,
      keyPrefix,
      tenantId: opts.tenantId,
      expiresAt,
    };
  }

  /**
   * Validate a plaintext key. Returns the key info if valid, null otherwise.
   * Updates lastUsedAt on successful validation.
   */
  validateKey(key: string): ApiKeyInfo | null {
    const keyHash = this.hashKey(key);

    const row = this.db
      .prepare("SELECT * FROM api_keys WHERE keyHash = ?")
      .get(keyHash) as ApiKeyRow | null;

    if (!row) {
      return null;
    }

    // Check if revoked
    if (row.revoked) {
      logger.debug(`[AuthDB] Key ${row.id} is revoked`);
      return null;
    }

    // Check if expired
    if (new Date(row.expiresAt) < new Date()) {
      logger.debug(`[AuthDB] Key ${row.id} is expired`);
      return null;
    }

    // Update lastUsedAt
    this.db
      .prepare("UPDATE api_keys SET lastUsedAt = ? WHERE id = ?")
      .run(new Date().toISOString(), row.id);

    return this.rowToInfo(row);
  }

  /** Revoke a key by ID. */
  revokeKey(id: string): boolean {
    const result = this.db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(id);
    const changed = result.changes > 0;
    if (changed) {
      logger.debug(`[AuthDB] Revoked key id=${id}`);
    }
    return changed;
  }

  /** List all keys, optionally filtered by tenant. */
  listKeys(tenantId?: string): ApiKeyInfo[] {
    let rows: ApiKeyRow[];
    if (tenantId) {
      rows = this.db
        .prepare("SELECT * FROM api_keys WHERE tenantId = ? ORDER BY createdAt DESC")
        .all(tenantId) as ApiKeyRow[];
    } else {
      rows = this.db.prepare("SELECT * FROM api_keys ORDER BY createdAt DESC").all() as ApiKeyRow[];
    }
    return rows.map((r) => this.rowToInfo(r));
  }

  /** Remove expired and revoked keys from the database. */
  cleanup(): number {
    const result = this.db
      .prepare("DELETE FROM api_keys WHERE revoked = 1 OR expiresAt < ?")
      .run(new Date().toISOString());
    if (result.changes > 0) {
      logger.debug(`[AuthDB] Cleaned up ${result.changes} expired/revoked keys`);
    }
    return result.changes;
  }

  /** Close the database connection. */
  close(): void {
    this.db.close();
    logger.debug("[AuthDB] Database closed");
  }

  /** Generate a random API key with `isol8_` prefix. */
  private generateKey(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `isol8_${hex}`;
  }

  /** SHA-256 hash a key for storage. */
  private hashKey(key: string): string {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(key);
    return hasher.digest("hex");
  }

  /** Convert a database row to public ApiKeyInfo (no hash). */
  private rowToInfo(row: ApiKeyRow): ApiKeyInfo {
    return {
      id: row.id,
      name: row.name,
      keyPrefix: row.keyPrefix,
      tenantId: row.tenantId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      revoked: row.revoked === 1,
    };
  }
}
