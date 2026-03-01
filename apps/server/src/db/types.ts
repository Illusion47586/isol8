/**
 * @module server/db/types
 *
 * Shared type definitions for the multi-backend auth store.
 * Both the public interface (AuthStore) and data types are defined here.
 */

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
 * Abstract auth store interface. All methods are async to support
 * both synchronous (SQLite via better-sqlite3) and asynchronous
 * (PostgreSQL, MySQL) database backends.
 *
 * Implementations:
 * - {@link SQLiteAuthStore} — better-sqlite3 + drizzle-orm
 * - {@link PostgresAuthStore} — pg + drizzle-orm
 * - {@link MySQLAuthStore} — mysql2 + drizzle-orm
 */
export interface AuthStore {
  /**
   * Create a new API key.
   * Returns the plaintext key — this is the ONLY time the key is available.
   */
  createKey(opts: CreateKeyOptions): Promise<CreateKeyResult>;

  /**
   * Validate a plaintext key. Returns the key info if valid, null otherwise.
   * Updates lastUsedAt on successful validation.
   */
  validateKey(key: string): Promise<ApiKeyInfo | null>;

  /** Revoke a key by ID. Returns true if a key was actually revoked. */
  revokeKey(id: string): Promise<boolean>;

  /** List all keys, optionally filtered by tenant. */
  listKeys(tenantId?: string): Promise<ApiKeyInfo[]>;

  /** Remove expired and revoked keys from the database. Returns count removed. */
  cleanup(): Promise<number>;

  /** Close the database connection. */
  close(): Promise<void>;
}
