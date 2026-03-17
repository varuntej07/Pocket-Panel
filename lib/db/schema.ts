import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  prompt: text("prompt").notNull(),
  topicBreadcrumb: varchar("topic_breadcrumb", { length: 120 }).notNull(),
  modeId: varchar("mode_id", { length: 64 }).notNull(),
  modeTitle: varchar("mode_title", { length: 128 }).notNull(),
  modeCategory: varchar("mode_category", { length: 32 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("created"),
  totalTurns: integer("total_turns").notNull().default(0),
  endedReason: varchar("ended_reason", { length: 64 }),
  lastError: text("last_error"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  endedAt: timestamptz("ended_at")
});

export const turns = pgTable("turns", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  speaker: varchar("speaker", { length: 16 }).notNull(),
  text: text("text").notNull(),
  turnIndex: integer("turn_index").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: timestamptz("created_at").notNull().defaultNow()
});

export const usageEvents = pgTable("usage_events", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  metadata: jsonb("metadata"),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: timestamptz("created_at").notNull().defaultNow()
});

export const transcripts = pgTable("transcripts", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  fullText: jsonb("full_text").notNull(),
  synthesisText: text("synthesis_text"),
  wordCount: integer("word_count").notNull().default(0),
  createdAt: timestamptz("created_at").notNull().defaultNow()
});
