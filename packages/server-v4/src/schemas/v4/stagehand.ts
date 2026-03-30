import { z } from "zod/v4";
import { Api } from "@browserbasehq/stagehand";

import {
  ActionIdSchema,
  FrameIdSchema,
  RequestIdSchema,
  SessionIdSchema,
} from "./page.js";

function wrapStagehandResponse<T extends z.ZodTypeAny>(
  resultSchema: T,
  id: string,
) {
  return z
    .object({
      success: z.literal(true),
      data: resultSchema,
    })
    .strict()
    .meta({ id });
}

const StagehandBodySchema = z
  .object({
    id: RequestIdSchema.optional(),
    sessionId: SessionIdSchema,
  })
  .strict();

function createStagehandRequestSchema<T extends z.ZodObject<any>>(
  id: string,
  params: T,
) {
  return StagehandBodySchema.extend(params.shape).meta({ id });
}

export const StagehandErrorResponseSchema = z
  .object({
    success: z.literal(false),
    message: z.string(),
  })
  .strict()
  .meta({ id: "StagehandErrorResponse" });

export const StagehandJsonSchemaSchema = z
  .record(z.string(), z.unknown())
  .meta({ id: "StagehandJsonSchema" });

export const StagehandActOptionsSchema = z
  .object({
    model: z.union([Api.ModelConfigSchema, z.string()]).optional().meta({
      description:
        "Model configuration object or model name string (e.g. 'openai/gpt-5-nano')",
    }),
    variables: z
      .record(z.string(), z.string())
      .optional()
      .meta({
        description: "Variables to substitute in the action instruction",
        example: { username: "john_doe" },
      }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the action",
      example: 30000,
    }),
  })
  .strict()
  .optional()
  .meta({ id: "StagehandActOptions" });

export const StagehandActParamsSchema = z
  .object({
    input: z.union([z.string(), Api.ActionSchema]).meta({
      description: "Natural language instruction or Action object",
      example: "Click the login button",
    }),
    options: StagehandActOptionsSchema,
    frameId: FrameIdSchema.nullish().meta({
      description: "Target frame ID for the action",
    }),
  })
  .strict()
  .meta({ id: "StagehandActParams" });

export const StagehandActRequestSchema = createStagehandRequestSchema(
  "StagehandActRequest",
  StagehandActParamsSchema,
);

export const StagehandActResultDataSchema = z
  .object({
    success: z.boolean().meta({
      description: "Whether the action completed successfully",
      example: true,
    }),
    message: z.string().meta({
      description: "Human-readable result message",
      example: "Successfully clicked the login button",
    }),
    actionDescription: z.string().meta({
      description: "Description of the action that was performed",
      example: "Clicked button with text 'Login'",
    }),
    actions: z.array(Api.ActionSchema).meta({
      description: "List of actions that were executed",
    }),
  })
  .strict()
  .meta({ id: "StagehandActResultData" });

export const StagehandActResultSchema = z
  .object({
    result: StagehandActResultDataSchema,
    eventId: ActionIdSchema.optional(),
  })
  .strict()
  .meta({ id: "StagehandActResult" });

export const StagehandActResponseSchema = wrapStagehandResponse(
  StagehandActResultSchema,
  "StagehandActResponse",
);

export const StagehandExtractOptionsSchema = z
  .object({
    model: z.union([Api.ModelConfigSchema, z.string()]).optional().meta({
      description:
        "Model configuration object or model name string (e.g. 'openai/gpt-5-nano')",
    }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the extraction",
      example: 30000,
    }),
    selector: z.string().optional().meta({
      description: "CSS selector to scope extraction to a specific element",
      example: "#main-content",
    }),
  })
  .strict()
  .optional()
  .meta({ id: "StagehandExtractOptions" });

export const StagehandExtractParamsSchema = z
  .object({
    instruction: z.string().optional().meta({
      description: "Natural language instruction for what to extract",
      example: "Extract all product names and prices from the page",
    }),
    schema: StagehandJsonSchemaSchema.optional().meta({
      description: "JSON Schema defining the structure of data to extract",
    }),
    options: StagehandExtractOptionsSchema,
    frameId: FrameIdSchema.nullish().meta({
      description: "Target frame ID for the extraction",
    }),
  })
  .strict()
  .meta({ id: "StagehandExtractParams" });

export const StagehandExtractRequestSchema = createStagehandRequestSchema(
  "StagehandExtractRequest",
  StagehandExtractParamsSchema,
);

export const StagehandExtractResultSchema = z
  .object({
    result: z.unknown().meta({
      description: "Extracted data matching the requested schema",
      override: ({ jsonSchema }: { jsonSchema: Record<string, unknown> }) => {
        jsonSchema["x-stainless-any"] = true;
      },
    }),
    eventId: ActionIdSchema.optional(),
  })
  .strict()
  .meta({ id: "StagehandExtractResult" });

export const StagehandExtractResponseSchema = wrapStagehandResponse(
  StagehandExtractResultSchema,
  "StagehandExtractResponse",
);

export const StagehandObserveOptionsSchema = z
  .object({
    model: z.union([Api.ModelConfigSchema, z.string()]).optional().meta({
      description:
        "Model configuration object or model name string (e.g. 'openai/gpt-5-nano')",
    }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the observation",
      example: 30000,
    }),
    selector: z.string().optional().meta({
      description: "CSS selector to scope observation to a specific element",
      example: "nav",
    }),
  })
  .strict()
  .optional()
  .meta({ id: "StagehandObserveOptions" });

export const StagehandObserveParamsSchema = z
  .object({
    instruction: z.string().optional().meta({
      description: "Natural language instruction for what actions to find",
      example: "Find all clickable navigation links",
    }),
    options: StagehandObserveOptionsSchema,
    frameId: FrameIdSchema.nullish().meta({
      description: "Target frame ID for the observation",
    }),
  })
  .strict()
  .meta({ id: "StagehandObserveParams" });

export const StagehandObserveRequestSchema = createStagehandRequestSchema(
  "StagehandObserveRequest",
  StagehandObserveParamsSchema,
);

export const StagehandObserveResultSchema = z
  .object({
    result: z.array(Api.ActionSchema),
    eventId: ActionIdSchema.optional(),
  })
  .strict()
  .meta({ id: "StagehandObserveResult" });

export const StagehandObserveResponseSchema = wrapStagehandResponse(
  StagehandObserveResultSchema,
  "StagehandObserveResponse",
);

export const StagehandNavigateOptionsSchema = z
  .object({
    referer: z.string().optional().meta({
      description: "Referer header to send with the request",
    }),
    timeout: z.number().optional().meta({
      description: "Timeout in ms for the navigation",
      example: 30000,
    }),
    waitUntil: z
      .enum(["load", "domcontentloaded", "networkidle"])
      .optional()
      .meta({
        description: "When to consider navigation complete",
        example: "networkidle",
      }),
  })
  .strict()
  .optional()
  .meta({ id: "StagehandNavigateOptions" });

export const StagehandNavigateParamsSchema = z
  .object({
    url: z.string().meta({
      description: "URL to navigate to",
      example: "https://example.com",
    }),
    options: StagehandNavigateOptionsSchema,
    frameId: FrameIdSchema.nullish().meta({
      description: "Target frame ID for the navigation",
    }),
  })
  .strict()
  .meta({ id: "StagehandNavigateParams" });

export const StagehandNavigateRequestSchema = createStagehandRequestSchema(
  "StagehandNavigateRequest",
  StagehandNavigateParamsSchema,
);

export const StagehandNavigateResultSchema = z
  .object({
    result: z
      .unknown()
      .nullable()
      .meta({
        description: "Navigation response (Playwright Response object or null)",
        override: ({ jsonSchema }: { jsonSchema: Record<string, unknown> }) => {
          jsonSchema["x-stainless-any"] = true;
        },
      }),
    eventId: ActionIdSchema.optional(),
  })
  .strict()
  .meta({ id: "StagehandNavigateResult" });

export const StagehandNavigateResponseSchema = wrapStagehandResponse(
  StagehandNavigateResultSchema,
  "StagehandNavigateResponse",
);

export const stagehandOpenApiLinks = {
  StagehandAct: {
    operationId: "StagehandAct",
    description: "Perform an action on the browser session",
  },
  StagehandExtract: {
    operationId: "StagehandExtract",
    description: "Extract data from the browser session",
  },
  StagehandObserve: {
    operationId: "StagehandObserve",
    description: "Observe available actions in the browser session",
  },
  StagehandNavigate: {
    operationId: "StagehandNavigate",
    description: "Navigate the active page in the browser session",
  },
} as const;

export const stagehandOpenApiComponents = {
  schemas: {
    Action: Api.ActionSchema,
    ModelConfig: Api.ModelConfigSchema,
    StagehandErrorResponse: StagehandErrorResponseSchema,
    StagehandJsonSchema: StagehandJsonSchemaSchema,
    StagehandActOptions: StagehandActOptionsSchema,
    StagehandActParams: StagehandActParamsSchema,
    StagehandActRequest: StagehandActRequestSchema,
    StagehandActResultData: StagehandActResultDataSchema,
    StagehandActResult: StagehandActResultSchema,
    StagehandActResponse: StagehandActResponseSchema,
    StagehandExtractOptions: StagehandExtractOptionsSchema,
    StagehandExtractParams: StagehandExtractParamsSchema,
    StagehandExtractRequest: StagehandExtractRequestSchema,
    StagehandExtractResult: StagehandExtractResultSchema,
    StagehandExtractResponse: StagehandExtractResponseSchema,
    StagehandObserveOptions: StagehandObserveOptionsSchema,
    StagehandObserveParams: StagehandObserveParamsSchema,
    StagehandObserveRequest: StagehandObserveRequestSchema,
    StagehandObserveResult: StagehandObserveResultSchema,
    StagehandObserveResponse: StagehandObserveResponseSchema,
    StagehandNavigateOptions: StagehandNavigateOptionsSchema,
    StagehandNavigateParams: StagehandNavigateParamsSchema,
    StagehandNavigateRequest: StagehandNavigateRequestSchema,
    StagehandNavigateResult: StagehandNavigateResultSchema,
    StagehandNavigateResponse: StagehandNavigateResponseSchema,
  },
};

export type StagehandActParams = z.infer<typeof StagehandActParamsSchema>;
export type StagehandActRequest = z.infer<typeof StagehandActRequestSchema>;
export type StagehandActResponse = z.infer<typeof StagehandActResponseSchema>;
export type StagehandExtractParams = z.infer<
  typeof StagehandExtractParamsSchema
>;
export type StagehandExtractRequest = z.infer<
  typeof StagehandExtractRequestSchema
>;
export type StagehandExtractResponse = z.infer<
  typeof StagehandExtractResponseSchema
>;
export type StagehandObserveParams = z.infer<
  typeof StagehandObserveParamsSchema
>;
export type StagehandObserveRequest = z.infer<
  typeof StagehandObserveRequestSchema
>;
export type StagehandObserveResponse = z.infer<
  typeof StagehandObserveResponseSchema
>;
export type StagehandNavigateParams = z.infer<
  typeof StagehandNavigateParamsSchema
>;
export type StagehandNavigateRequest = z.infer<
  typeof StagehandNavigateRequestSchema
>;
export type StagehandNavigateResponse = z.infer<
  typeof StagehandNavigateResponseSchema
>;
