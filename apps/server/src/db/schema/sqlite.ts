/**
 * @module server/db/schema/sqlite
 *
 * Drizzle ORM schema definition for SQLite (better-sqlite3).
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    keyHash: text("keyHash").notNull().unique(),
    keyPrefix: text("keyPrefix").notNull(),
    tenantId: text("tenantId").notNull(),
    createdAt: text("createdAt").notNull(),
    expiresAt: text("expiresAt").notNull(),
    lastUsedAt: text("lastUsedAt"),
    revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [index("idx_api_keys_keyHash").on(table.keyHash)]
);
