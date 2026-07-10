import { z } from "zod/v4";

export const STAGEHAND_PROTOCOL_VERSION = "stagehand.v4" as const;

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const StagehandProtocolCommandSchema = z.enum([
  "ping",
  "stagehand.init",
  "stagehand.close",
  "stagehand.act",
  "stagehand.observe",
  "stagehand.extract",
  "stagehand.metrics",
  "context.pages",
  "context.newPage",
  "page.goto",
  "page.url",
  "page.title",
  "page.close",
  "locator.click",
  "locator.fill",
  "locator.isVisible",
  "locator.textContent",
]);

export const EmptyParamsSchema = z.object({}).strict();

export const PageRefSchema = z
  .object({
    objectId: z.string(),
    type: z.literal("page"),
    targetId: z.string(),
    mainFrameId: z.string(),
    url: z.string(),
  })
  .strict();

export const LocatorDescriptorSchema = z
  .object({
    pageId: z.string(),
    selector: z.string().min(1),
  })
  .strict();

export const StagehandInitParamsSchema = z
  .object({
    cdpUrl: z.string().min(1),
    model: JsonObjectSchema.optional(),
    cdpHeaders: z.record(z.string(), z.string()).optional(),
    sessionId: z.string().optional(),
    systemPrompt: z.string().optional(),
    logInferenceToFile: z.boolean().optional(),
    experimental: z.boolean().optional(),
    selfHeal: z.boolean().optional(),
    domSettleTimeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export const StagehandInitResultSchema = z
  .object({
    initialized: z.literal(true),
    pages: z.array(PageRefSchema),
  })
  .strict();

export const StagehandCloseResultSchema = z
  .object({
    closed: z.literal(true),
  })
  .strict();

export const StagehandActParamsSchema = z
  .object({
    input: z.string().min(1),
    options: JsonObjectSchema.optional(),
  })
  .strict();

export const StagehandObserveParamsSchema = z
  .object({
    instruction: z.string().optional(),
    options: JsonObjectSchema.optional(),
  })
  .strict();

export const StagehandExtractParamsSchema = z
  .object({
    instruction: z.string().optional(),
    options: JsonObjectSchema.optional(),
  })
  .strict();

export const UnknownResultSchema = z.unknown();

export const StagehandMetricsResultSchema = z.record(z.string(), JsonValueSchema);

export const ContextPagesResultSchema = z.array(PageRefSchema);

export const ContextNewPageParamsSchema = z
  .object({
    url: z.string().optional(),
  })
  .strict();

export const PageGotoParamsSchema = z
  .object({
    pageId: z.string(),
    url: z.string().min(1),
    options: z
      .object({
        waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PageIdParamsSchema = z
  .object({
    pageId: z.string(),
  })
  .strict();

export const PageUrlResultSchema = z
  .object({
    url: z.string(),
  })
  .strict();

export const PageTitleResultSchema = z
  .object({
    title: z.string(),
  })
  .strict();

export const PageCloseResultSchema = z
  .object({
    closed: z.literal(true),
  })
  .strict();

export const LocatorClickParamsSchema = LocatorDescriptorSchema.extend({
  options: z
    .object({
      button: z.enum(["left", "right", "middle"]).optional(),
      clickCount: z.number().int().positive().optional(),
      delay: z.number().nonnegative().optional(),
      timeoutMs: z.number().int().positive().optional(),
    })
    .strict()
    .optional(),
}).strict();

export const LocatorClickResultSchema = z
  .object({
    clicked: z.literal(true),
  })
  .strict();

export const LocatorFillParamsSchema = LocatorDescriptorSchema.extend({
  value: z.string(),
}).strict();

export const LocatorFillResultSchema = z
  .object({
    filled: z.literal(true),
  })
  .strict();

export const LocatorIsVisibleResultSchema = z
  .object({
    visible: z.boolean(),
  })
  .strict();

export const LocatorTextContentResultSchema = z
  .object({
    textContent: z.string(),
  })
  .strict();

export const StagehandPingParamsSchema = EmptyParamsSchema;

export const StagehandPingResultSchema = z
  .object({
    ok: z.literal(true),
    runtime: z.literal("service_worker"),
  })
  .strict();

export const stagehandProtocolOperations = {
  ping: {
    command: "ping",
    params: StagehandPingParamsSchema,
    result: StagehandPingResultSchema,
  },
  "stagehand.init": {
    command: "stagehand.init",
    params: StagehandInitParamsSchema,
    result: StagehandInitResultSchema,
  },
  "stagehand.close": {
    command: "stagehand.close",
    params: EmptyParamsSchema,
    result: StagehandCloseResultSchema,
  },
  "stagehand.act": {
    command: "stagehand.act",
    params: StagehandActParamsSchema,
    result: UnknownResultSchema,
  },
  "stagehand.observe": {
    command: "stagehand.observe",
    params: StagehandObserveParamsSchema,
    result: UnknownResultSchema,
  },
  "stagehand.extract": {
    command: "stagehand.extract",
    params: StagehandExtractParamsSchema,
    result: UnknownResultSchema,
  },
  "stagehand.metrics": {
    command: "stagehand.metrics",
    params: EmptyParamsSchema,
    result: StagehandMetricsResultSchema,
  },
  "context.pages": {
    command: "context.pages",
    params: EmptyParamsSchema,
    result: ContextPagesResultSchema,
  },
  "context.newPage": {
    command: "context.newPage",
    params: ContextNewPageParamsSchema,
    result: PageRefSchema,
  },
  "page.goto": {
    command: "page.goto",
    params: PageGotoParamsSchema,
    result: PageRefSchema,
  },
  "page.url": {
    command: "page.url",
    params: PageIdParamsSchema,
    result: PageUrlResultSchema,
  },
  "page.title": {
    command: "page.title",
    params: PageIdParamsSchema,
    result: PageTitleResultSchema,
  },
  "page.close": {
    command: "page.close",
    params: PageIdParamsSchema,
    result: PageCloseResultSchema,
  },
  "locator.click": {
    command: "locator.click",
    params: LocatorClickParamsSchema,
    result: LocatorClickResultSchema,
  },
  "locator.fill": {
    command: "locator.fill",
    params: LocatorFillParamsSchema,
    result: LocatorFillResultSchema,
  },
  "locator.isVisible": {
    command: "locator.isVisible",
    params: LocatorDescriptorSchema,
    result: LocatorIsVisibleResultSchema,
  },
  "locator.textContent": {
    command: "locator.textContent",
    params: LocatorDescriptorSchema,
    result: LocatorTextContentResultSchema,
  },
} as const;

export type StagehandProtocolCommand = keyof typeof stagehandProtocolOperations;

export type StagehandProtocolParams<Command extends StagehandProtocolCommand> = z.input<
  (typeof stagehandProtocolOperations)[Command]["params"]
>;

export type StagehandProtocolResult<Command extends StagehandProtocolCommand> = z.output<
  (typeof stagehandProtocolOperations)[Command]["result"]
>;

export type StagehandProtocolRequest<
  Command extends StagehandProtocolCommand = StagehandProtocolCommand,
> = {
  id: string;
  command: Command;
  params: StagehandProtocolParams<Command>;
};

export const StagehandRPCErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  })
  .strict();

export const StagehandRPCResponseSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      id: z.string().optional(),
      command: StagehandProtocolCommandSchema,
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      id: z.string().optional(),
      command: z.string().optional(),
      error: StagehandRPCErrorSchema,
    })
    .strict(),
]);

const stagehandProtocolRequestSchemas = Object.values(stagehandProtocolOperations).map(
  (operation) =>
    z
      .object({
        id: z.string(),
        command: z.literal(operation.command),
        params: operation.params,
      })
      .strict(),
);

export const StagehandProtocolRequestSchema = z.union(
  stagehandProtocolRequestSchemas as unknown as [
    z.ZodType<StagehandProtocolRequest>,
    z.ZodType<StagehandProtocolRequest>,
    ...z.ZodType<StagehandProtocolRequest>[],
  ],
);

export const StagehandProtocolSchema = z
  .object({
    version: z.literal(STAGEHAND_PROTOCOL_VERSION),
    request: StagehandProtocolRequestSchema,
    response: StagehandRPCResponseSchema,
  })
  .strict();

export type StagehandRPCError = z.output<typeof StagehandRPCErrorSchema>;
export type StagehandRPCResponse = z.output<typeof StagehandRPCResponseSchema>;
export type PageRef = z.output<typeof PageRefSchema>;
export type LocatorDescriptor = z.output<typeof LocatorDescriptorSchema>;
export type StagehandInitParams = z.output<typeof StagehandInitParamsSchema>;

export class StagehandProtocolError extends Error {
  readonly code: string;

  constructor(message: string, code = "stagehand.protocol_error") {
    super(message);
    this.code = code;
    this.name = "StagehandProtocolError";
  }
}

export function parseStagehandProtocolParams<Command extends StagehandProtocolCommand>(
  command: Command,
  params: unknown,
): StagehandProtocolParams<Command> {
  const operation = stagehandProtocolOperations[command];

  if (!operation) {
    throw new StagehandProtocolError(
      `Unknown Stagehand protocol command: ${String(command)}`,
      "stagehand.unknown_command",
    );
  }

  return operation.params.parse(params ?? {}) as StagehandProtocolParams<Command>;
}

export function parseStagehandProtocolResult<Command extends StagehandProtocolCommand>(
  command: Command,
  result: unknown,
): StagehandProtocolResult<Command> {
  const operation = stagehandProtocolOperations[command];

  if (!operation) {
    throw new StagehandProtocolError(
      `Unknown Stagehand protocol command: ${String(command)}`,
      "stagehand.unknown_command",
    );
  }

  return operation.result.parse(result) as StagehandProtocolResult<Command>;
}

export function createStagehandProtocolRequest<Command extends StagehandProtocolCommand>(
  id: string,
  command: Command,
  params: unknown,
): StagehandProtocolRequest<Command> {
  return {
    id,
    command,
    params: parseStagehandProtocolParams(command, params),
  };
}
