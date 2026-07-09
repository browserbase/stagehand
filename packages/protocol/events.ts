import { z } from "zod/v4";

export const StagehandProtocolCommandSchema = z.enum(["ping", "page.goto", "page.click"]);

export const StagehandPingParamsSchema = z.object({}).strict();

export const StagehandPingResultSchema = z
  .object({
    ok: z.literal(true),
    runtime: z.literal("service_worker"),
  })
  .strict();

export const StagehandPageGotoParamsSchema = z
  .object({
    url: z.string().url(),
    wait_until: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    timeout_ms: z.number().int().positive().optional(),
  })
  .strict();

export const StagehandPageGotoResultSchema = z
  .object({
    url: z.string(),
    title: z.string().nullable().optional(),
  })
  .strict();

export const StagehandLocatorCoordinatesSchema = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .strict();

export const StagehandLocatorSchema = z
  .object({
    css: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    coordinates: StagehandLocatorCoordinatesSchema.optional(),
  })
  .strict()
  .refine(
    (locator) => locator.css ?? locator.text ?? locator.coordinates,
    "locator must include css, text, or coordinates",
  );

export const StagehandPageClickParamsSchema = z
  .object({
    locator: StagehandLocatorSchema,
    timeout_ms: z.number().int().positive().optional(),
  })
  .strict();

export const StagehandPageClickResultSchema = z
  .object({
    clicked: z.literal(true),
    tag_name: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
  })
  .strict();

export const stagehandProtocolOperations = {
  ping: {
    command: "ping",
    params: StagehandPingParamsSchema,
    result: StagehandPingResultSchema,
  },
  "page.goto": {
    command: "page.goto",
    params: StagehandPageGotoParamsSchema,
    result: StagehandPageGotoResultSchema,
  },
  "page.click": {
    command: "page.click",
    params: StagehandPageClickParamsSchema,
    result: StagehandPageClickResultSchema,
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

export type StagehandRPCResponse = z.output<typeof StagehandRPCResponseSchema>;

export class StagehandProtocolError extends Error {
  constructor(
    message: string,
    readonly code = "stagehand.protocol_error",
  ) {
    super(message);
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
