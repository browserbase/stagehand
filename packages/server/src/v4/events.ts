import { BaseEvent } from "../lib/bubus.js";
import { z } from "zod";

export {
  AgentCreateEvent,
  AgentGetEvent,
  AgentListEvent,
  AgentTaskCreateEvent,
  AgentTaskModifyEvent,
  BrowserGetEvent,
  BrowserKillEvent,
  BrowserLaunchEvent,
  BrowserLaunchOrConnectEvent,
  BrowserListEvent,
  BrowserSetViewportEvent,
  BrowserSetWindowSizeEvent,
  BrowserTriggerExtensionActionEvent,
  LLMConnectCheckEvent,
  LLMConnectEvent,
  LLMGetEvent,
  LLMListEvent,
  LLMRequestEvent,
  SessionCreateEvent,
  SessionGetEvent,
  SessionListEvent,
  StagehandActEvent,
  StagehandExtractEvent,
  StagehandObserveEvent,
  StagehandStepCancelEvent,
  StagehandStepGetEvent,
  UnderstudyActEvent,
  UnderstudyClickEvent,
  UnderstudyDoubleClickEvent,
  UnderstudyDragAndDropEvent,
  UnderstudyFillEvent,
  UnderstudyHoverEvent,
  UnderstudyMouseWheelEvent,
  UnderstudyNextChunkEvent,
  UnderstudyPressEvent,
  UnderstudyPrevChunkEvent,
  UnderstudyScreenshotEvent,
  UnderstudyScrollByPixelOffsetEvent,
  UnderstudyScrollEvent,
  UnderstudyScrollIntoViewEvent,
  UnderstudySelectOptionFromDropdownEvent,
  UnderstudyStepGetEvent,
  UnderstudyTypeEvent,
} from "@browserbasehq/stagehand";

export const SessionUpdateBrowserEvent = BaseEvent.extend(
  "SessionUpdateBrowserEvent",
  {
    sessionId: z.string(),
    browserId: z.string(),
    modelName: z.string().optional(),
    llmId: z.string().optional(),
    status: z.enum(["initializing", "running", "failed"]).optional(),
    event_result_type: z.object({
      session: z.record(z.string(), z.unknown()),
    }),
  },
);

export const SessionUpdateLLMClientsEvent = BaseEvent.extend(
  "SessionUpdateLLMClientsEvent",
  {
    sessionId: z.string(),
    llmId: z.string(),
    modelName: z.string().optional(),
    mode: z.enum(["dom", "hybrid", "cua"]).optional(),
    clientType: z.enum(["aisdk", "custom"]).optional(),
    status: z.enum(["initializing", "running", "failed"]).optional(),
    event_result_type: z.object({
      session: z.record(z.string(), z.unknown()),
    }),
  },
);
