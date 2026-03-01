/**
 * @module server/db/schema/pg
 *
 * Drizzle ORM schema definition for PostgreSQL.
 */

import { boolean, index, pgTable, text } from "drizzle-orm/pg-core";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    keyPrefix: text("key_prefix").notNull(),
    tenantId: text("tenant_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastUsedAt: text("last_used_at"),
    revoked: boolean("revoked").notNull().default(false),
  },
  (table) => [index("idx_api_keys_key_hash").on(table.keyHash)]
);
