import { BaseEvent } from "../../bubus";
import { z } from "zod/v4";

export interface USLocalBrowserLaunchOptions {
  ChromePath?: string;
  ChromeFlags?: string[];
  Port?: number;
  Headless?: boolean;
  UserDataDir?: string;
  ConnectTimeoutMs?: number;
  HandleSIGINT?: boolean;
  UnrefProcess?: boolean;
}

export interface USBrowserbaseConnectOptions {
  ApiKey: string;
  ProjectId: string;
  SessionId?: string;
  SessionCreateParams?: Record<string, unknown>;
}

export interface BrowserLaunchOrConnectPayload {
  CdpUrl?: string;
  LaunchOptions?: USLocalBrowserLaunchOptions;
  BrowserbaseOptions?: USBrowserbaseConnectOptions;
}

export interface BrowserLaunchOrConnectResult {
  Ws: string;
  Launched: boolean;
  Pid: number | null;
  SessionId?: string;
}

export type USLaunchOrConnectBrowserPayload = BrowserLaunchOrConnectPayload;
export type USLaunchOrConnectBrowserResult = BrowserLaunchOrConnectResult;

export interface USSelectorTargetPayload {
  TargetId: string;
  FrameId?: string;
  Selector: string;
  DomSettleTimeoutMs?: number;
}

export interface USClickEventPayload extends USSelectorTargetPayload {
  Button?: "left" | "right" | "middle";
  ClickCount?: number;
}

export interface USFillEventPayload extends USSelectorTargetPayload {
  Value: string;
}

export interface USTypeEventPayload extends USSelectorTargetPayload {
  Text: string;
  DelayMs?: number;
}

export interface USPressEventPayload extends USSelectorTargetPayload {
  Key: string;
}

export interface USScrollEventPayload extends USSelectorTargetPayload {
  Percent: string | number;
}

export interface USScrollByPixelOffsetEventPayload
  extends USSelectorTargetPayload {
  DeltaX: number;
  DeltaY: number;
}

export interface USMouseWheelEventPayload extends USSelectorTargetPayload {
  DeltaY?: number;
}

export interface USSelectOptionFromDropdownEventPayload
  extends USSelectorTargetPayload {
  OptionText: string;
  OptionTexts?: string[];
}

export interface USDragAndDropEventPayload extends USSelectorTargetPayload {
  ToSelector: string;
}

const localBrowserLaunchOptionsSchema = z.object({
  ChromePath: z.string().optional(),
  ChromeFlags: z.array(z.string()).optional(),
  Port: z.number().optional(),
  Headless: z.boolean().optional(),
  UserDataDir: z.string().optional(),
  ConnectTimeoutMs: z.number().optional(),
  HandleSIGINT: z.boolean().optional(),
  UnrefProcess: z.boolean().optional(),
});

const browserbaseConnectOptionsSchema = z.object({
  ApiKey: z.string(),
  ProjectId: z.string(),
  SessionId: z.string().optional(),
  SessionCreateParams: z.record(z.string(), z.unknown()).optional(),
});

export const usLaunchOrConnectBrowserResultSchema = z.object({
  Ws: z.string(),
  Launched: z.boolean(),
  Pid: z.number().nullable(),
  SessionId: z.string().optional(),
});

export const BrowserLaunchOrConnect = BaseEvent.extend(
  "BrowserLaunchOrConnect",
  {
    CdpUrl: z.string().optional(),
    LaunchOptions: localBrowserLaunchOptionsSchema.optional(),
    BrowserbaseOptions: browserbaseConnectOptionsSchema.optional(),
    event_result_type: usLaunchOrConnectBrowserResultSchema,
  },
);

export const BrowserDisconnectOrClose = BaseEvent.extend(
  "BrowserDisconnectOrClose",
  {
    event_result_type: z.void(),
  },
);

// Backward-compatible aliases.
export const USLaunchOrConnectBrowserEvent = BrowserLaunchOrConnect;
export const USDisconnectOrCloseBrowserEvent = BrowserDisconnectOrClose;

const selectorTargetSchema = z.object({
  TargetId: z.string(),
  FrameId: z.string().optional(),
  Selector: z.string(),
  DomSettleTimeoutMs: z.number().optional(),
});

export const USClickEvent = BaseEvent.extend("USClickEvent", {
  ...selectorTargetSchema.shape,
  Button: z.enum(["left", "right", "middle"]).optional(),
  ClickCount: z.number().int().positive().optional(),
  event_result_type: z.void(),
});

export const USFillEvent = BaseEvent.extend("USFillEvent", {
  ...selectorTargetSchema.shape,
  Value: z.string(),
  event_result_type: z.void(),
});

export const USTypeEvent = BaseEvent.extend("USTypeEvent", {
  ...selectorTargetSchema.shape,
  Text: z.string(),
  DelayMs: z.number().optional(),
  event_result_type: z.void(),
});

export const USPressEvent = BaseEvent.extend("USPressEvent", {
  ...selectorTargetSchema.shape,
  Key: z.string(),
  event_result_type: z.void(),
});

export const USScrollEvent = BaseEvent.extend("USScrollEvent", {
  ...selectorTargetSchema.shape,
  Percent: z.union([z.number(), z.string()]),
  event_result_type: z.void(),
});

export const USScrollIntoViewEvent = BaseEvent.extend("USScrollIntoViewEvent", {
  ...selectorTargetSchema.shape,
  event_result_type: z.void(),
});

export const USScrollByPixelOffsetEvent = BaseEvent.extend(
  "USScrollByPixelOffsetEvent",
  {
    ...selectorTargetSchema.shape,
    DeltaX: z.number(),
    DeltaY: z.number(),
    event_result_type: z.string(),
  },
);

export const USMouseWheelEvent = BaseEvent.extend("USMouseWheelEvent", {
  ...selectorTargetSchema.shape,
  DeltaY: z.number().optional(),
  event_result_type: z.void(),
});

export const USNextChunkEvent = BaseEvent.extend("USNextChunkEvent", {
  ...selectorTargetSchema.shape,
  event_result_type: z.void(),
});

export const USPrevChunkEvent = BaseEvent.extend("USPrevChunkEvent", {
  ...selectorTargetSchema.shape,
  event_result_type: z.void(),
});

export const USSelectOptionFromDropdownEvent = BaseEvent.extend(
  "USSelectOptionFromDropdownEvent",
  {
    ...selectorTargetSchema.shape,
    OptionText: z.string(),
    OptionTexts: z.array(z.string()).optional(),
    event_result_type: z.array(z.string()),
  },
);

export const USHoverEvent = BaseEvent.extend("USHoverEvent", {
  ...selectorTargetSchema.shape,
  event_result_type: z.void(),
});

export const USDoubleClickEvent = BaseEvent.extend("USDoubleClickEvent", {
  ...selectorTargetSchema.shape,
  event_result_type: z.void(),
});

export const USDragAndDropEvent = BaseEvent.extend("USDragAndDropEvent", {
  ...selectorTargetSchema.shape,
  ToSelector: z.string(),
  event_result_type: z.tuple([z.string(), z.string()]),
});


// Unified server/runtime event surface

const unknownRecordSchema = z.record(z.string(), z.unknown());

const browserLaunchPayloadSchema = z.object({
  browserType: z.enum(["local", "remote", "browserbase"]).default("local"),
  browserId: z.string().optional(),
  apiSessionId: z.string().optional(),
  modelName: z.string().default("openai/gpt-4o-mini"),
  llmId: z.string().optional(),
  modelApiKey: z.string().optional(),
  cdpUrl: z.string().optional(),
  region: z.string().default("local"),
  browserLaunchOptions: z.record(z.string(), z.unknown()).optional(),
  browserbaseSessionId: z.string().optional(),
  browserbaseSessionCreateParams: unknownRecordSchema.optional(),
  browserbaseApiKey: z.string().optional(),
  browserbaseProjectId: z.string().optional(),
});

const browserActionPayloadSchema = z.object({
  browserId: z.string().optional(),
  sessionId: z.string().optional(),
  modelApiKey: z.string().optional(),
});

export const SessionCreateEvent = BaseEvent.extend("SessionCreateEvent", {
  sessionId: z.string().optional(),
  llmId: z.string().optional(),
  browserId: z.string().optional(),
  modelName: z.string().optional(),
  modelApiKey: z.string().optional(),
  browserType: z.enum(["local", "remote", "browserbase"]).default("local"),
  cdpUrl: z.string().optional(),
  region: z.string().default("local"),
  browserLaunchOptions: z.record(z.string(), z.unknown()).optional(),
  browserbaseSessionId: z.string().optional(),
  browserbaseSessionCreateParams: unknownRecordSchema.optional(),
  browserbaseApiKey: z.string().optional(),
  browserbaseProjectId: z.string().optional(),
  event_result_type: z.object({
    session: z.record(z.string(), z.unknown()),
    browser: z.record(z.string(), z.unknown()),
  }),
});

export const SessionGetEvent = BaseEvent.extend("SessionGetEvent", {
  sessionId: z.string(),
  event_result_type: z.object({
    session: z.record(z.string(), z.unknown()),
  }),
});

export const SessionListEvent = BaseEvent.extend("SessionListEvent", {
  event_result_type: z.object({
    sessions: z.array(z.record(z.string(), z.unknown())),
  }),
});

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

const llmMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.union([
    z.string(),
    z.array(
      z.object({
        type: z.string(),
        text: z.string().optional(),
        image_url: z.object({ url: z.string() }).optional(),
      }),
    ),
  ]),
});

export const LLMListEvent = BaseEvent.extend("LLMListEvent", {
  event_result_type: z.object({
    llms: z.array(z.record(z.string(), z.unknown())),
  }),
});

export const LLMGetEvent = BaseEvent.extend("LLMGetEvent", {
  llmId: z.string(),
  event_result_type: z.object({
    llm: z.record(z.string(), z.unknown()),
  }),
});

export const LLMConnectEvent = BaseEvent.extend("LLMConnectEvent", {
  llmId: z.string().optional(),
  sessionId: z.string().optional(),
  browserId: z.string().optional(),
  clientType: z.enum(["aisdk", "custom"]).optional(),
  mode: z.enum(["dom", "hybrid", "cua"]).optional(),
  modelName: z.string().optional(),
  modelApiKey: z.string().optional(),
  provider: z.string().optional(),
  baseURL: z.string().optional(),
  clientOptions: z.record(z.string(), z.unknown()).optional(),
  event_result_type: z.object({
    ok: z.boolean(),
    llm: z.record(z.string(), z.unknown()),
  }),
});

export const LLMRequestEvent = BaseEvent.extend("LLMRequestEvent", {
  llmId: z.string().optional(),
  sessionId: z.string().optional(),
  browserId: z.string().optional(),
  modelApiKey: z.string().optional(),
  mode: z.enum(["dom", "hybrid", "cua"]).optional(),
  prompt: z.string().optional(),
  messages: z.array(llmMessageSchema).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  event_result_type: z.object({
    llmId: z.string(),
    mode: z.enum(["dom", "hybrid", "cua"]),
    modelName: z.string(),
    result: z.unknown(),
  }),
});

// Backward-compatible alias while transitioning handlers/routes.
export const LLMConnectCheckEvent = BaseEvent.extend("LLMConnectCheckEvent", {
  sessionId: z.string(),
  browserId: z.string().optional(),
  modelApiKey: z.string().optional(),
  event_result_type: z.object({
    ok: z.boolean(),
    modelName: z.string(),
  }),
});

export const BrowserListEvent = BaseEvent.extend("BrowserListEvent", {
  event_result_type: z.object({
    browsers: z.array(z.record(z.string(), z.unknown())),
  }),
});

export const BrowserLaunchOrConnectEvent = BaseEvent.extend(
  "BrowserLaunchOrConnectEvent",
  {
  ...browserLaunchPayloadSchema.shape,
  event_result_type: z.object({
    browser: z.record(z.string(), z.unknown()),
  }),
  },
);

// Backward-compatible alias while transitioning handlers/routes.
export const BrowserLaunchEvent = BrowserLaunchOrConnectEvent;

export const BrowserGetEvent = BaseEvent.extend("BrowserGetEvent", {
  browserId: z.string(),
  event_result_type: z.object({
    browser: z.record(z.string(), z.unknown()),
  }),
});

export const BrowserKillEvent = BaseEvent.extend("BrowserKillEvent", {
  browserId: z.string(),
  event_result_type: z.object({
    browser: z.record(z.string(), z.unknown()),
  }),
});

export const BrowserSetViewportEvent = BaseEvent.extend(
  "BrowserSetViewportEvent",
  {
    ...browserActionPayloadSchema.shape,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deviceScaleFactor: z.number().positive().optional(),
    event_result_type: z.object({
      browser: z.record(z.string(), z.unknown()),
      applied: z.boolean(),
    }),
  },
);

export const BrowserSetWindowSizeEvent = BaseEvent.extend(
  "BrowserSetWindowSizeEvent",
  {
    ...browserActionPayloadSchema.shape,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    event_result_type: z.object({
      browser: z.record(z.string(), z.unknown()),
      applied: z.boolean(),
    }),
  },
);

export const BrowserTriggerExtensionActionEvent = BaseEvent.extend(
  "BrowserTriggerExtensionActionEvent",
  {
    ...browserActionPayloadSchema.shape,
    action: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
    event_result_type: z.object({
      browser: z.record(z.string(), z.unknown()),
      applied: z.boolean(),
      note: z.string().optional(),
    }),
  },
);

const agentExecutionPayloadSchema = z.object({
  agentId: z.string().optional(),
  taskId: z.string().optional(),
  instruction: z.string(),
  sessionId: z.string().optional(),
  agentConfig: z.record(z.string(), z.unknown()).optional(),
  llmId: z.string().optional(),
  browserId: z.string().optional(),
  pageId: z.string().optional(),
  modelApiKey: z.string().optional(),
});

export const AgentListEvent = BaseEvent.extend("AgentListEvent", {
  event_result_type: z.object({
    agents: z.array(z.record(z.string(), z.unknown())),
  }),
});

export const AgentCreateEvent = BaseEvent.extend("AgentCreateEvent", {
  ...agentExecutionPayloadSchema.shape,
  event_result_type: z.object({
    agent: z.record(z.string(), z.unknown()),
    task: z.record(z.string(), z.unknown()),
    output: z.string().optional(),
    actions: z.array(z.unknown()).optional(),
    rawResult: z.unknown().optional(),
  }),
});

export const AgentGetEvent = BaseEvent.extend("AgentGetEvent", {
  agentId: z.string(),
  event_result_type: z.object({
    agent: z.record(z.string(), z.unknown()),
  }),
});

export const AgentTaskCreateEvent = BaseEvent.extend("AgentTaskCreateEvent", {
  ...agentExecutionPayloadSchema.shape,
  agentId: z.string(),
  event_result_type: z.object({
    agent: z.record(z.string(), z.unknown()),
    task: z.record(z.string(), z.unknown()),
    output: z.string().optional(),
    actions: z.array(z.unknown()).optional(),
    rawResult: z.unknown().optional(),
  }),
});

export const AgentTaskModifyEvent = BaseEvent.extend("AgentTaskModifyEvent", {
  agentId: z.string(),
  taskId: z.string(),
  method: z.enum(["pause", "resume", "cancel"]),
  resumeAt: z.string().optional(),
  event_result_type: z.object({
    agent: z.record(z.string(), z.unknown()),
    task: z.record(z.string(), z.unknown()),
  }),
});

const stagehandActionPayloadSchema = z.object({
  stepId: z.string().optional(),
  sessionId: z.string().optional(),
  browserId: z.string().optional(),
  pageId: z.string().optional(),
  frameId: z.string().optional(),
  modelApiKey: z.string().optional(),
  instruction: z.string().optional(),
  action: z.record(z.string(), z.unknown()).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  extractSchema: z.record(z.string(), z.unknown()).optional(),
});

const stagehandStepResultSchema = z.object({
  step: z.record(z.string(), z.unknown()),
});

export const StagehandActEvent = BaseEvent.extend("StagehandActEvent", {
  ...stagehandActionPayloadSchema.shape,
  event_result_type: stagehandStepResultSchema,
});

export const StagehandObserveEvent = BaseEvent.extend("StagehandObserveEvent", {
  ...stagehandActionPayloadSchema.shape,
  event_result_type: stagehandStepResultSchema,
});

export const StagehandExtractEvent = BaseEvent.extend("StagehandExtractEvent", {
  ...stagehandActionPayloadSchema.shape,
  event_result_type: stagehandStepResultSchema,
});

export const StagehandStepGetEvent = BaseEvent.extend("StagehandStepGetEvent", {
  stepId: z.string(),
  event_result_type: stagehandStepResultSchema,
});

export const StagehandStepCancelEvent = BaseEvent.extend(
  "StagehandStepCancelEvent",
  {
    stepId: z.string(),
    method: z.enum(["cancel"]),
    resumeAt: z.string().optional(),
    event_result_type: stagehandStepResultSchema,
  },
);

const understudyPayloadSchema = z.object({
  stepId: z.string().optional(),
  sessionId: z.string().optional(),
  browserId: z.string().optional(),
  pageId: z.string().optional(),
  frameId: z.string().optional(),
  locatorId: z.string().optional(),
  xpath: z.string().optional(),
  selector: z.string().optional(),
  modelApiKey: z.string().optional(),
  instruction: z.string().optional(),
  extractSchema: z.record(z.string(), z.unknown()).optional(),
  fullPage: z.boolean().optional(),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  percent: z.union([z.number(), z.string()]).optional(),
  clickCount: z.number().int().positive().optional(),
  button: z.enum(["left", "right", "middle"]).optional(),
  outputPath: z.string().optional(),
  value: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  optionText: z.string().optional(),
  toSelector: z.string().optional(),
});

const understudyStepResultSchema = z.object({
  step: z.record(z.string(), z.unknown()),
});

export const UnderstudyClickEvent = BaseEvent.extend("UnderstudyClickEvent", {
  ...understudyPayloadSchema.shape,
  event_result_type: understudyStepResultSchema,
});

export const UnderstudyScrollEvent = BaseEvent.extend(
  "UnderstudyScrollEvent",
  {
    ...understudyPayloadSchema.shape,
    event_result_type: understudyStepResultSchema,
  },
);

export const UnderstudyFillEvent = BaseEvent.extend("UnderstudyFillEvent", {
  ...understudyPayloadSchema.shape,
  event_result_type: understudyStepResultSchema,
});

export const UnderstudyTypeEvent = BaseEvent.extend("UnderstudyTypeEvent", {
  ...understudyPayloadSchema.shape,
  event_result_type: understudyStepResultSchema,
});

export const UnderstudyPressEvent = BaseEvent.extend("UnderstudyPressEvent", {
  ...understudyPayloadSchema.shape,
  event_result_type: understudyStepResultSchema,
});

export const UnderstudyScrollIntoViewEvent = BaseEvent.extend(
  "UnderstudyScrollIntoViewEvent",
  {
    ...understudyPayloadSchema.shape,
    event_result_type: understudyStepResultSchema,
  },
);

export const UnderstudyScrollByPixelOffsetEvent = BaseEvent.extend(
  "UnderstudyScrollByPixelOffsetEvent",
  {
    ...understudyPayloadSchema.shape,
    event_result_type: understudyStepResultSchema,
  },
);

export const UnderstudyMouseWheelEvent = BaseEvent.extend(
  "UnderstudyMouseWheelEvent",
  {
    ...understudyPayloadSchema.shape,
    event_result_type: understudyStepResultSchema,
  },
);

export const UnderstudyNextChunkEvent = BaseEvent.extend(
  "UnderstudyNextChunkEvent",
  {
    ...understudyPayloadSchema.shape,
    event_result_type: understudyStepResultSchema,
  },
);

export const UnderstudyPrevChunkEvent = BaseEvent.extend(
  "UnderstudyPrevChunkEvent",
  {
    ...understudyPayloadSchema.shape,
    event_result_type: understudyStepResultSchema,
  },
);

export const UnderstudySelectOptionFromDropdownEvent = BaseEvent.extend(
  "UnderstudySelectOptionFromDropdownEvent",
  {
    ...understudyPayloadSchema.shape,
    event_result_type: understudyStepResultSchema,
  },
);

export const UnderstudyHoverEvent = BaseEvent.extend("UnderstudyHoverEvent", {
  ...understudyPayloadSchema.shape,
  event_result_type: understudyStepResultSchema,
});

export const UnderstudyDoubleClickEvent = BaseEvent.extend(
  "UnderstudyDoubleClickEvent",
  {
    ...understudyPayloadSchema.shape,
    event_result_type: understudyStepResultSchema,
  },
);

export const UnderstudyDragAndDropEvent = BaseEvent.extend(
  "UnderstudyDragAndDropEvent",
  {
    ...understudyPayloadSchema.shape,
    event_result_type: understudyStepResultSchema,
  },
);

export const UnderstudyScreenshotEvent = BaseEvent.extend(
  "UnderstudyScreenshotEvent",
  {
    ...understudyPayloadSchema.shape,
    event_result_type: understudyStepResultSchema,
  },
);

export const UnderstudyActEvent = BaseEvent.extend("UnderstudyActEvent", {
  ...understudyPayloadSchema.shape,
  event_result_type: understudyStepResultSchema,
});

export const UnderstudyStepGetEvent = BaseEvent.extend("UnderstudyStepGetEvent", {
  stepId: z.string(),
  event_result_type: understudyStepResultSchema,
});
