import type { RouteHandler, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import Browserbase from "@browserbasehq/sdk";

import { authMiddleware } from "../../../lib/auth.js";
import { withErrorHandling } from "../../../lib/errorHandler.js";
import {
  dangerouslyGetHeader,
  getOptionalHeader,
} from "../../../lib/header.js";
import { error, success } from "../../../lib/response.js";
import { getSessionStore } from "../../../lib/sessionStoreManager.js";
import {
  InvalidModelError,
  InvalidProviderError,
} from "../../../types/error.js";
import { AISDK_PROVIDERS } from "../../../types/model.js";

/**
 * Parameters for creating a new session (request body shape)
 */
interface ConstructorParams {
  modelName: string;
  domSettleTimeoutMs?: number;
  verbose?: 0 | 1 | 2;
  systemPrompt?: string;
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

    const bbApiKey = dangerouslyGetHeader(request, "x-bb-api-key");
    const bbProjectId = dangerouslyGetHeader(request, "x-bb-project-id");
    const modelApiKey = dangerouslyGetHeader(request, "x-model-api-key");
    const sdkVersion = getOptionalHeader(request, "x-sdk-version");

    if (!bbApiKey || !bbProjectId || !modelApiKey) {
      return error(reply, "Missing required headers");
    }

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
    } = request.body as ConstructorParams;

    if (!modelName) {
      return error(reply, "Missing required model name");
    }

    // TODO: Remove this after complete AISDK migration. Validation should be done stagehand-side
    if (modelName.includes("/")) {
      const [providerName] = modelName.split("/", 1);
      if (!providerName) {
        return new InvalidModelError(modelName);
      }
      if (!(AISDK_PROVIDERS as readonly string[]).includes(providerName)) {
        return new InvalidProviderError(providerName);
      }
    }

    const sessionStore = getSessionStore();
    const session = await sessionStore.startSession({
      browserbaseSessionID,
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
          type: "string",
          enum: ["0", "1", "2"],
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
