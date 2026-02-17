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

export interface USLaunchOrConnectBrowserPayload {
  CdpUrl?: string;
  LaunchOptions?: USLocalBrowserLaunchOptions;
}

export interface USLaunchOrConnectBrowserResult {
  Ws: string;
  Launched: boolean;
  Pid: number | null;
}

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

export const usLaunchOrConnectBrowserResultSchema = z.object({
  Ws: z.string(),
  Launched: z.boolean(),
  Pid: z.number().nullable(),
});

export const USLaunchOrConnectBrowserEvent = BaseEvent.extend(
  "USLaunchOrConnectBrowserEvent",
  {
    CdpUrl: z.string().optional(),
    LaunchOptions: localBrowserLaunchOptionsSchema.optional(),
    event_result_type: usLaunchOrConnectBrowserResultSchema,
  },
);

export const USDisconnectOrCloseBrowserEvent = BaseEvent.extend(
  "USDisconnectOrCloseBrowserEvent",
  {
    event_result_type: z.void(),
  },
);

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
