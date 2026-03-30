import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { llmSessionsTable } from "./llmSessions.js";
import type { DatabaseJsonValue } from "./types.js";

export const llmCallsTable = pgTable("llm_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  llmSessionId: uuid("llm_session_id")
    .notNull()
    .references(() => llmSessionsTable.id, {
      onDelete: "cascade",
    }),
  sentAt: timestamp("sent_at", {
    withTimezone: true,
    mode: "string",
  })
    .notNull()
    .defaultNow(),
  receivedAt: timestamp("received_at", {
    withTimezone: true,
    mode: "string",
  }),
  prompt: text("prompt").notNull(),
  expectedResponseSchema: jsonb(
    "expected_response_schema",
  ).$type<DatabaseJsonValue | null>(),
  response: jsonb("response").$type<DatabaseJsonValue | null>(),
  error: jsonb("error").$type<DatabaseJsonValue | null>(),
  usage: jsonb("usage").$type<DatabaseJsonValue | null>(),
  model: text("model").notNull(),
});
