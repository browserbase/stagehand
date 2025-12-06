import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Define constants for verbose levels to avoid magic numbers
export const VERBOSE_NONE = 0;
export const VERBOSE_BASIC = 1;
export const VERBOSE_DETAILED = 2;

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  browserbaseApiKey: text("browserbase_api_key").notNull(),
  browserbaseProjectId: text("browserbase_project_id").notNull(),
  modelName: text("model_name").notNull(),
  domSettleTimeoutMs: integer("dom_settle_timeout_ms"),
  verbose: integer("verbose").$type<
    typeof VERBOSE_NONE | typeof VERBOSE_BASIC | typeof VERBOSE_DETAILED
  >(),
  debugDom: boolean("debug_dom"),
  systemPrompt: text("system_prompt"),
  selfHeal: boolean("self_heal"),
  waitForCaptchaSolves: boolean("wait_for_captcha_solves"),
  actTimeoutMs: integer("act_timeout_ms"),
  createdAt: timestamp("created_at").defaultNow(),
  clientLanguage: text("client_language"),
  sdkVersion: text("sdk_version"),
  experimental: boolean("experimental"),
});

export interface ActionRow {
  id?: string;
  method?: string;
  sessionId: string;
  timestamp?: Date;
  xpath?: string;
  options?: Record<string, unknown>;
  result?: Record<string, unknown>;
  url?: string;
}

export const actions = pgTable("actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  method: text("method"),
  sessionId: uuid("session_id")
    .references(() => sessions.id, { onDelete: "cascade" })
    .notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
  xpath: text("xpath").default(""),
  options: jsonb("options"),
  result: jsonb("result"),
  url: text("url"),
  endTime: timestamp("end_time"),
  startTime: timestamp("start_time"),
});

export const inference = pgTable("inference", {
  id: uuid("id").defaultRandom().primaryKey(),
  actionId: uuid("action_id")
    .references(() => actions.id, { onDelete: "cascade" })
    .notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  timeMs: doublePrecision("time_ms"),
});

export const schema = {
  actions,
  inference,
  sessions,
};
