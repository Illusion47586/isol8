/**
 * @module server/db/schema/mysql
 *
 * Drizzle ORM schema definition for MySQL.
 */

import { boolean, index, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";

export const apiKeys = mysqlTable(
  "api_keys",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    name: text("name").notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
    keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
    tenantId: varchar("tenant_id", { length: 255 }).notNull(),
    createdAt: varchar("created_at", { length: 30 }).notNull(),
    expiresAt: varchar("expires_at", { length: 30 }).notNull(),
    lastUsedAt: varchar("last_used_at", { length: 30 }),
    revoked: boolean("revoked").notNull().default(false),
  },
  (table) => [index("idx_api_keys_key_hash").on(table.keyHash)]
);
