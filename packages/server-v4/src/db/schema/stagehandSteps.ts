import { jsonb, pgEnum, pgTable, uuid } from "drizzle-orm/pg-core";
import { llmSessionsTable } from "./llmSessions.js";
import { stagehandBrowserSessionsTable } from "./stagehandBrowserSessions.js";
import type { DatabaseJsonValue } from "./types.js";

export const stagehandStepOperationEnum = pgEnum("stagehand_step_operation", [
  "act",
  "extract",
  "observe",
  "agent",
]);

export const stagehandStepsTable = pgTable("stagehand_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  stagehandBrowserSessionId: uuid("stagehand_browser_session_id")
    .notNull()
    .references(() => stagehandBrowserSessionsTable.id, {
      onDelete: "cascade",
    }),
  operation: stagehandStepOperationEnum("operation").notNull(),
  llmTemplateId: uuid("llm_template_id")
    .notNull()
    .references(() => llmSessionsTable.id, {
      onDelete: "restrict",
    }),
  llmSessionId: uuid("llm_session_id").references(() => llmSessionsTable.id, {
    onDelete: "set null",
  }),
  params: jsonb("params").$type<DatabaseJsonValue>().notNull(),
  result: jsonb("result").$type<DatabaseJsonValue | null>(),
});
