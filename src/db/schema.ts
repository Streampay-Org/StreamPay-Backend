import { pgTable, uuid, varchar, timestamp, decimal, pgEnum } from "drizzle-orm/pg-core";

export const streamStatusEnum = pgEnum("stream_status", ["active", "paused", "cancelled", "completed"]);

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

export type Stream = typeof streams.$inferSelect;
export type NewStream = typeof streams.$inferInsert;
