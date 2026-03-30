import { pgTable, uuid, varchar, timestamp, decimal, pgEnum, jsonb } from "drizzle-orm/pg-core";

export const streamStatusEnum = pgEnum("stream_status", ["active", "paused", "cancelled", "completed"]);
export const auditActionEnum = pgEnum("audit_action", ["stream_create", "stream_update", "stream_admin_action"]);

export const streams = pgTable("streams", {
  id: uuid("id").primaryKey().defaultRandom(),
  payer: varchar("payer", { length: 255 }).notNull(),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  status: streamStatusEnum("status").notNull().default("active"),
  ratePerSecond: decimal("rate_per_second", { precision: 20, scale: 9 }).notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  totalAmount: decimal("total_amount", { precision: 20, scale: 9 }).notNull(),
  lastSettledAt: timestamp("last_settled_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: varchar("actor", { length: 255 }).notNull(),
  action: auditActionEnum("action").notNull(),
  streamId: uuid("stream_id"),
  ipAddress: varchar("ip_address", { length: 64 }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Stream = typeof streams.$inferSelect;
export type NewStream = typeof streams.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
