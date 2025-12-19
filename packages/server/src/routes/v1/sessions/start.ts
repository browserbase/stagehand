import type { RouteHandler, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import Browserbase from "@browserbasehq/sdk";

import { authMiddleware } from "../../../lib/auth.js";
import { withErrorHandling } from "../../../lib/errorHandler.js";
import { getOptionalHeader } from "../../../lib/header.js";
import { error, success } from "../../../lib/response.js";
import { getSessionStore } from "../../../lib/sessionStoreManager.js";
import { AISDK_PROVIDERS } from "../../../types/model.js";

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
    sessionCreateParams?: Record<string, unknown>;
    sessionId?: string;
  };
  browserbaseSessionCreateParams?: Omit<
    Browserbase.Sessions.SessionCreateParams,
    "projectId"
  > & { projectId?: string };
  selfHeal?: boolean;
  waitForCaptchaSolves?: boolean;
  browserbaseSessionID?: string;
  experimental?: boolean;
}

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

    if (browserType === "browserbase") {
      bbApiKey = getOptionalHeader(request, "x-bb-api-key");
      bbProjectId = getOptionalHeader(request, "x-bb-project-id");

      if (!bbApiKey || !bbProjectId) {
        return error(
          reply,
          "Missing required headers for browserbase sessions",
        );
      }
    }

    const sessionStore = getSessionStore();
    const session = await sessionStore.startSession({
      browserType,
      browserbaseSessionID,
      browserbaseApiKey: bbApiKey,
      browserbaseProjectId: bbProjectId,
      modelName,
      domSettleTimeoutMs,
      verbose,
      systemPrompt,
      browserbaseSessionCreateParams:
        browser?.sessionCreateParams ?? browserbaseSessionCreateParams,
      selfHeal,
      waitForCaptchaSolves,
      clientLanguage,
      sdkVersion,
      experimental,
      localBrowserLaunchOptions:
        browserType === "local" && (browser?.cdpUrl || browser?.launchOptions)
          ? {
              cdpUrl: browser?.cdpUrl,
              ...(browser?.launchOptions ?? {}),
            }
          : undefined,
    });

    return success(reply, {
      sessionId: session.sessionId,
      available: session.available,
    });
  },
);

const startRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/start",
  schema: {
    body: {
      type: "object",
      properties: {
        modelName: {
          type: "string",
        },
        domSettleTimeoutMs: {
          type: "number",
        },
        verbose: {
          type: "number",
          enum: [0, 1, 2],
        },
        debugDom: {
          type: "boolean",
        },
        systemPrompt: {
          type: "string",
        },
        browserbaseSessionCreateParams: {
          type: "object",
        },
        browser: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["local", "browserbase"],
            },
            cdpUrl: {
              type: "string",
            },
            launchOptions: {
              type: "object",
            },
            sessionCreateParams: {
              type: "object",
            },
            sessionId: {
              type: "string",
            },
          },
          additionalProperties: false,
        },
        selfHeal: {
          type: "boolean",
        },
        waitForCaptchaSolves: {
          type: "boolean",
        },
        actTimeoutMs: {
          type: "number",
        },
        browserbaseSessionID: {
          type: "string",
        },
        experimental: {
          type: "boolean",
        },
      },
      required: ["modelName"],
      additionalProperties: false,
    },
  },
  handler: startRouteHandler,
};

export default startRoute;
