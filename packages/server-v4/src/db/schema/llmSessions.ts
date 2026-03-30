import { sql } from "drizzle-orm";
import {
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { DatabaseJsonValue, ExtraHttpHeaders } from "./types.js";

export const llmSessionStatusEnum = pgEnum("llm_session_status", [
  "disconnected",
  "idle",
  "thinking",
  "permanent-error",
  "ratelimited",
]);

export const llmSessionsTable = pgTable(
  "llm_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    copiedTemplateId: uuid("copied_template_id"),
    forkedSessionId: uuid("forked_session_id"),
    projectId: uuid("project_id").notNull(),
    // Nullable on the table so template sessions can exist independently of a browser session.
    browserSessionId: uuid("browser_session_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
    connectedAt: timestamp("connected_at", {
      withTimezone: true,
      mode: "string",
    }),
    disconnectedAt: timestamp("disconnected_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastRequestAt: timestamp("last_request_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastResponseAt: timestamp("last_response_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastErrorAt: timestamp("last_error_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastErrorMessage: text("last_error_message"),
    status: llmSessionStatusEnum("status").notNull(),
    model: text("model").notNull(),
    baseUrl: text("base_url"),
    options: jsonb("options").$type<DatabaseJsonValue | null>(),
    extraHttpHeaders: jsonb(
      "extra_http_headers",
    ).$type<ExtraHttpHeaders | null>(),
    systemPrompt: text("system_prompt"),
    tokensInput: integer("tokens_input").notNull().default(0),
    tokensOutput: integer("tokens_output").notNull().default(0),
    tokensReasoning: integer("tokens_reasoning").notNull().default(0),
    tokensCachedInput: integer("tokens_cached_input").notNull().default(0),
    tokensTotal: integer("tokens_total").notNull().default(0),
  },
  (table) => [
    foreignKey({
      columns: [table.copiedTemplateId],
      foreignColumns: [table.id],
      name: "llm_sessions_copied_template_id_fkey",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.forkedSessionId],
      foreignColumns: [table.id],
      name: "llm_sessions_forked_session_id_fkey",
    }).onDelete("set null"),
  ],
);
