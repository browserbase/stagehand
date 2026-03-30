import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { llmSessionsTable } from "./llmSessions.js";

export const stagehandBrowserSessionStatusEnum = pgEnum(
  "stagehand_browser_session_status",
  ["running", "terminated"],
);

export const stagehandBrowserSessionsTable = pgTable(
  "stagehand_browser_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    browserbaseSessionId: uuid("browserbase_session_id"),
    cdpUrl: text("cdp_url").notNull(),
    status: stagehandBrowserSessionStatusEnum("status").notNull(),
    defaultLLMSessionId: uuid("default_llm_session_id")
      .notNull()
      .references(() => llmSessionsTable.id, {
        onDelete: "restrict",
      }),
  },
);
