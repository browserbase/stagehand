import type { RouteHandler, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import Browserbase from "@browserbasehq/sdk";
import { Api } from "@browserbasehq/stagehand";
import type { SessionRetrieveResponse } from "@browserbasehq/sdk/resources/sessions/sessions";
import { type FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { z } from "zod/v4";

import { authMiddleware } from "../../../lib/auth.js";
import { withErrorHandling } from "../../../lib/errorHandler.js";
import { getOptionalHeader } from "../../../lib/header.js";
import { error, success } from "../../../lib/response.js";
import { getSessionStore } from "../../../lib/sessionStoreManager.js";
import { AISDK_PROVIDERS } from "../../../types/model.js";

// Extended schema with custom refinement for local browser validation
const startBodySchema = Api.SessionStartRequestSchema.superRefine(
  (value, ctx) => {
    if (value.browser?.type === "local") {
      const hasConnect = Boolean(value.browser.cdpUrl);
      const hasLaunch = Boolean(value.browser.launchOptions);
      if (!hasConnect && !hasLaunch) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["browser"],
          message:
            "When browser.type is 'local', provide either browser.cdpUrl or browser.launchOptions.",
        });
      }
    }
  },
);

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

    // Use the validated request body directly - fields come from Api.SessionStartRequestSchema
    const body = request.body as Api.SessionStartRequest;
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
    } = body;
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

    const browserType = browser?.type ?? "browserbase";

    let bbApiKey: string | undefined;
    let bbProjectId: string | undefined;
    let browserbaseSessionId: string | undefined;
    let connectUrl: string | undefined;

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
        connectUrl = existing?.connectUrl;
        if (!browserbaseSessionId) {
          return error(reply, "Failed to retrieve browserbase session");
        }
        if (!connectUrl) {
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
        connectUrl = created?.connectUrl;
        if (!browserbaseSessionId) {
          return error(reply, "Failed to create browserbase session");
        }
        if (!connectUrl) {
          return error(reply, "Browserbase session missing connectUrl");
        }
      }
    }

    const sessionStore = getSessionStore();

    // For local browsers without a connectUrl, get it from browser.connectUrl
    if (browserType === "local") {
      connectUrl = browser?.cdpUrl;
    }

    const session = await sessionStore.startSession({
      browserType,
      connectUrl,
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
        browserType === "local" && browser?.launchOptions
          ? {
              cdpUrl: browser?.cdpUrl,
              ...(browser?.launchOptions ?? {}),
            }
          : undefined,
    });

    return success(reply, {
      sessionId: session.sessionId,
      available: session.available,
      cdpUrl: connectUrl ?? session.cdpUrl ?? "",
    });
  },
);

const startRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/start",
  schema: {
    ...Api.Operations.SessionStart,
    headers: Api.SessionHeadersSchema,
    body: startBodySchema,
    response: {
      200: Api.SessionStartResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: startRouteHandler,
};

export default startRoute;
