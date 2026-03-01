/**
 * @module server/db/utils
 *
 * Shared cryptographic helpers for the auth store.
 * Uses `node:crypto` for portability across Bun and Node.js.
 */

import { createHash, randomUUID } from "node:crypto";

/**
 * SHA-256 hash a plaintext API key for storage.
 * Keys are never stored in plaintext — only their hashes.
 */
export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Generate a random API key with `isol8_` prefix.
 * Uses `crypto.getRandomValues` for cryptographically secure randomness.
 */
export function generateKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `isol8_${hex}`;
}

/** Generate a new UUID v4. */
export function generateId(): string {
  return randomUUID();
}
