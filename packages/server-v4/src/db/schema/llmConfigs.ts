import { sql } from "drizzle-orm";
import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { LLMProviderOptions } from "./types.js";

export const llmSourceEnum = pgEnum("llm_source", ["user", "system-default"]);

export const llmConfigsTable = pgTable("llm_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: llmSourceEnum("source").notNull().default("user"),
  displayName: text("display_name"),
  modelName: text("model_name").notNull(),
  baseUrl: text("base_url"),
  systemPrompt: text("system_prompt"),
  providerOptions: jsonb("provider_options").$type<LLMProviderOptions | null>(),
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
});
