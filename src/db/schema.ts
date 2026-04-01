import { pgTable, uuid, varchar, timestamp, decimal, pgEnum, json, text } from "drizzle-orm/pg-core";

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
  labels: json("labels").$type<string[]>().default([]),
  offChainMemo: text("off_chain_memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  chainId: varchar("chain_id", { length: 50 }).notNull().default("stellar-testnet"),
  contractAddress: varchar("contract_address", { length: 255 }),
  transactionHash: varchar("transaction_hash", { length: 66 }),
  metadata: text("metadata"),
}, (table) => ({
  payerIdx: index("streams_payer_idx").on(table.payer),
  recipientIdx: index("streams_recipient_idx").on(table.recipient),
  statusIdx: index("streams_status_idx").on(table.status),
  chainIdIdx: index("streams_chain_id_idx").on(table.chainId),
  createdAtIdx: index("streams_created_at_idx").on(table.createdAt),
}));

export type Stream = typeof streams.$inferSelect;
export type NewStream = typeof streams.$inferInsert;
