import type { RouteHandler, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import Browserbase from "@browserbasehq/sdk";
import type { SessionRetrieveResponse } from "@browserbasehq/sdk/resources/sessions/sessions";
import { type FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { z } from "zod/v4";

import { authMiddleware } from "../../../lib/auth.js";
import { withErrorHandling } from "../../../lib/errorHandler.js";
import { getOptionalHeader } from "../../../lib/header.js";
import { error, success } from "../../../lib/response.js";
import { getSessionStore } from "../../../lib/sessionStoreManager.js";
import { AISDK_PROVIDERS } from "../../../types/model.js";

/**
 * Parameters for creating a new session (request body shape)
 */
const startBodySchema = z
  .object({
    modelName: z.string().meta({
      description: "Model name",
      example: "gpt-4o",
    }),
    domSettleTimeoutMs: z.number().optional(),
    verbose: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    debugDom: z.boolean().optional(),
    systemPrompt: z.string().optional(),
    browserbaseSessionCreateParams: z
      .record(z.string(), z.unknown())
      .optional(),
    browser: z
      .object({
        type: z.enum(["local", "browserbase"]).optional(),
        cdpUrl: z.string().optional(),
        launchOptions: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    selfHeal: z.boolean().optional(),
    waitForCaptchaSolves: z.boolean().optional(),
    actTimeoutMs: z.number().optional(),
    browserbaseSessionID: z.string().optional(),
    experimental: z.boolean().optional(),
  })
  .strict();

/**
 * Parameters for creating a new session (request body shape)
 */
interface ConstructorParams {
  modelName: string;
  domSettleTimeoutMs?: number;
  verbose?: 0 | 1 | 2;
  systemPrompt?: string;
  browser?: {
    type?: "local" | "browserbase";
    cdpUrl?: string;
    launchOptions?: Record<string, unknown>;
  };
  browserbaseSessionCreateParams?: Omit<
    Browserbase.Sessions.SessionCreateParams,
    "projectId"
  > & { projectId?: string };
  selfHeal?: boolean;
  waitForCaptchaSolves?: boolean;
  browserbaseSessionID?: string;
  experimental?: boolean;
  actTimeoutMs?: number;
}

const startResponseSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        sessionId: z.string().meta({
          description: "Session ID",
          example: "c4dbf3a9-9a58-4b22-8a1c-9f20f9f9e123",
        }),
        available: z.boolean(),
        cdpUrl: z
          .string()
          .meta({ description: "CDP URL", example: "ws://localhost:3000" }),
      })
      .strict(),
  })
  .strict();

const startRouteHandler: RouteHandler = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return error(reply, "Unauthorized", StatusCodes.UNAUTHORIZED);
    }

    const sdkVersion = getOptionalHeader(request, "x-sdk-version");

    const clientLanguage = request.headers["x-language"] as string | undefined;
    if (
      clientLanguage &&
      !["typescript", "python", "playground"].includes(clientLanguage)
    ) {
      return error(
        reply,
        "Invalid client language header",
        StatusCodes.BAD_REQUEST,
      );
    }

    const {
      modelName,
      domSettleTimeoutMs,
      verbose,
      systemPrompt,
      browserbaseSessionCreateParams,
      selfHeal,
      waitForCaptchaSolves,
      browserbaseSessionID,
      experimental,
      browser,
    } = request.body as ConstructorParams;
    const modelApiKey = getOptionalHeader(request, "x-model-api-key");

    if (!modelName) {
      return error(reply, "Missing required model name");
    }

    // TODO: Remove this after complete AISDK migration. Validation should be done stagehand-side
    if (modelName.includes("/")) {
      const [providerName] = modelName.split("/", 1);
      if (!providerName) {
        return error(
          reply,
          `Invalid model: ${modelName}`,
          StatusCodes.BAD_REQUEST,
        );
      }
      if (!(AISDK_PROVIDERS as readonly string[]).includes(providerName)) {
        return error(
          reply,
          `Invalid provider: ${providerName}`,
          StatusCodes.BAD_REQUEST,
        );
      }
    }

    const browserType = browser?.type ?? "local";

    let bbApiKey: string | undefined;
    let bbProjectId: string | undefined;
    let browserbaseSessionId: string | undefined;
    let cdpUrl: string | undefined;

    if (browserType === "browserbase") {
      bbApiKey = getOptionalHeader(request, "x-bb-api-key");
      bbProjectId = getOptionalHeader(request, "x-bb-project-id");

      if (!bbApiKey || !bbProjectId) {
        return error(
          reply,
          "Missing required headers for browserbase sessions",
        );
      }

      const bb = new Browserbase({ apiKey: bbApiKey });

      if (browserbaseSessionID) {
        const existing = await bb.sessions.retrieve(browserbaseSessionID);
        browserbaseSessionId = existing?.id;
        cdpUrl = existing?.connectUrl;
        if (!browserbaseSessionId) {
          return error(reply, "Failed to retrieve browserbase session");
        }
        if (!cdpUrl) {
          return error(reply, "Browserbase session missing connectUrl");
        }
      } else {
        const createPayload = {
          projectId: browserbaseSessionCreateParams?.projectId ?? bbProjectId,
          ...browserbaseSessionCreateParams,
          browserSettings: {
            ...(browserbaseSessionCreateParams?.browserSettings ?? {}),
            viewport: browserbaseSessionCreateParams?.browserSettings
              ?.viewport ?? {
              width: 1288,
              height: 711,
            },
          },
          userMetadata: {
            ...(browserbaseSessionCreateParams?.userMetadata ?? {}),
            stagehand: "true",
          },
        } satisfies Browserbase.Sessions.SessionCreateParams;

        const created = (await bb.sessions.create(
          createPayload,
        )) as SessionRetrieveResponse;

        browserbaseSessionId = created?.id;
        cdpUrl = created?.connectUrl;
        if (!browserbaseSessionId) {
          return error(reply, "Failed to create browserbase session");
        }
        if (!cdpUrl) {
          return error(reply, "Browserbase session missing connectUrl");
        }
      }
    }

    const sessionStore = getSessionStore();
    const session = await sessionStore.startSession({
      browserType,
      browserbaseSessionID:
        browserType === "browserbase"
          ? (browserbaseSessionId ?? browserbaseSessionID)
          : undefined,
      browserbaseApiKey: bbApiKey,
      browserbaseProjectId: bbProjectId,
      modelName,
      domSettleTimeoutMs,
      verbose,
      systemPrompt,
      browserbaseSessionCreateParams,
      selfHeal,
      waitForCaptchaSolves,
      clientLanguage,
      sdkVersion,
      experimental,
      localBrowserLaunchOptions:
        browserType === "local" &&
        (cdpUrl || browser?.cdpUrl || browser?.launchOptions)
          ? {
              cdpUrl: browser?.cdpUrl ?? cdpUrl,
              ...(browser?.launchOptions ?? {}),
            }
          : undefined,
    });

    if (browserType === "local" && !cdpUrl) {
      try {
        const stagehand = await sessionStore.getOrCreateStagehand(
          session.sessionId,
          {
            modelApiKey,
            logger: (line) => request.log.info(line),
          },
        );
        cdpUrl = stagehand.connectURL();
      } catch (err) {
        request.log.warn(
          { err },
          "failed to precreate local browser for /sessions/start",
        );
      }
    }

    const responseCdpUrl = cdpUrl ?? browser?.cdpUrl;
    if (!responseCdpUrl) {
      return error(
        reply,
        "Missing cdpUrl for requested browser type",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    return success(reply, {
      sessionId: session.sessionId,
      available: session.available,
      cdpUrl: responseCdpUrl,
    });
  },
);

const startRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/start",
  schema: {
    body: startBodySchema,
    response: {
      200: startResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: startRouteHandler,
};

export default startRoute;
