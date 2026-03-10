import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import Browserbase from "@browserbasehq/sdk";
import type { SessionRetrieveResponse } from "@browserbasehq/sdk/resources/sessions/sessions";
import { type FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import { authMiddleware } from "../../../lib/auth.js";
import { withErrorHandling } from "../../../lib/errorHandler.js";
import { getModelApiKey, getOptionalHeader } from "../../../lib/header.js";
import { error, success } from "../../../lib/response.js";
import { getSessionStore } from "../../../lib/sessionStoreManager.js";
import { AISDK_PROVIDERS } from "../../../types/model.js";
import {
  BrowserSessionCreateRequestSchema,
  BrowserSessionErrorResponseSchema,
  BrowserSessionHeadersSchema,
  BrowserSessionResponseSchema,
  type BrowserSessionCreateRequest,
} from "../../../schemas/v4/browserSession.js";
import { buildBrowserSession } from "./shared.js";

const createBrowserSessionHandler: RouteHandlerMethod = withErrorHandling(
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

    const body = request.body as BrowserSessionCreateRequest;
    const {
      modelName,
      domSettleTimeoutMs,
      verbose,
      systemPrompt,
      selfHeal,
      waitForCaptchaSolves,
      experimental,
      actTimeoutMs,
    } = body;

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

    const browserType = body.env === "LOCAL" ? "local" : "browserbase";

    let bbApiKey: string | undefined;
    let bbProjectId: string | undefined;
    let browserbaseSessionId: string | undefined;
    let connectUrl: string | undefined;

    if (body.env === "BROWSERBASE") {
      bbApiKey = getOptionalHeader(request, "x-bb-api-key");
      bbProjectId = getOptionalHeader(request, "x-bb-project-id");

      if (!bbApiKey || !bbProjectId) {
        return error(
          reply,
          "Missing required headers for Browserbase sessions",
          StatusCodes.BAD_REQUEST,
        );
      }

      const bb = new Browserbase({ apiKey: bbApiKey });

      if (body.browserbaseSessionId) {
        const existing = await bb.sessions.retrieve(body.browserbaseSessionId);
        browserbaseSessionId = existing?.id;
        connectUrl = existing?.connectUrl;

        if (!browserbaseSessionId) {
          return error(reply, "Failed to retrieve Browserbase session");
        }
        if (!connectUrl) {
          return error(reply, "Browserbase session missing connectUrl");
        }
      } else {
        const createPayload = {
          projectId:
            body.browserbaseSessionCreateParams?.projectId ?? bbProjectId,
          ...body.browserbaseSessionCreateParams,
          browserSettings: {
            ...(body.browserbaseSessionCreateParams?.browserSettings ?? {}),
            viewport: body.browserbaseSessionCreateParams?.browserSettings
              ?.viewport ?? {
              width: 1288,
              height: 711,
            },
          },
          userMetadata: {
            ...(body.browserbaseSessionCreateParams?.userMetadata ?? {}),
            stagehand: "true",
          },
        } satisfies Browserbase.Sessions.SessionCreateParams;

        const created = (await bb.sessions.create(
          createPayload,
        )) as SessionRetrieveResponse;

        browserbaseSessionId = created?.id;
        connectUrl = created?.connectUrl;

        if (!browserbaseSessionId) {
          return error(reply, "Failed to create Browserbase session");
        }
        if (!connectUrl) {
          return error(reply, "Browserbase session missing connectUrl");
        }
      }
    }

    const sessionStore = getSessionStore();

    if (body.env === "LOCAL") {
      connectUrl = body.cdpUrl;
    }

    const session = await sessionStore.startSession({
      browserType,
      connectUrl,
      browserbaseSessionID:
        body.env === "BROWSERBASE"
          ? (browserbaseSessionId ?? body.browserbaseSessionId)
          : undefined,
      browserbaseApiKey: bbApiKey,
      browserbaseProjectId: bbProjectId,
      modelName,
      domSettleTimeoutMs,
      verbose,
      systemPrompt,
      browserbaseSessionCreateParams:
        body.env === "BROWSERBASE"
          ? body.browserbaseSessionCreateParams
          : undefined,
      selfHeal,
      waitForCaptchaSolves,
      clientLanguage,
      sdkVersion,
      experimental,
      actTimeoutMs,
      localBrowserLaunchOptions:
        body.env === "LOCAL" && (body.localBrowserLaunchOptions || body.cdpUrl)
          ? {
              cdpUrl: body.cdpUrl,
              ...(body.localBrowserLaunchOptions ?? {}),
            }
          : undefined,
    });

    let finalCdpUrl = connectUrl ?? session.cdpUrl ?? "";
    if (body.env === "LOCAL" && body.localBrowserLaunchOptions && !body.cdpUrl) {
      const modelApiKey = getModelApiKey(request);
      try {
        const stagehand = await sessionStore.getOrCreateStagehand(
          session.sessionId,
          { modelApiKey },
        );
        finalCdpUrl = stagehand.connectURL();
      } catch (err) {
        request.log.error(
          {
            err,
            sessionId: session.sessionId,
            browserType,
            chromePathEnv: process.env.CHROME_PATH,
            launchOptions: {
              executablePath: body.localBrowserLaunchOptions.executablePath,
              argsCount: body.localBrowserLaunchOptions.args?.length ?? 0,
              headless: body.localBrowserLaunchOptions.headless,
              hasUserDataDir: Boolean(
                body.localBrowserLaunchOptions.userDataDir,
              ),
              port: body.localBrowserLaunchOptions.port,
              connectTimeoutMs:
                body.localBrowserLaunchOptions.connectTimeoutMs,
            },
          },
          "Failed to initialize local browser session in /v4/browsersession",
        );
        throw err;
      }
    }

    const stored = await sessionStore.getSessionConfig(session.sessionId);
    stored.connectUrl = finalCdpUrl;

    return success(reply, {
      browserSession: buildBrowserSession({
        id: session.sessionId,
        params: stored,
        status: "running",
        available: session.available,
        cdpUrl: finalCdpUrl,
      }),
    });
  },
);

const createBrowserSessionRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession",
  schema: {
    operationId: "BrowserSessionCreate",
    summary: "Create a browser session",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionCreateRequestSchema,
    response: {
      200: BrowserSessionResponseSchema,
      400: BrowserSessionErrorResponseSchema,
      401: BrowserSessionErrorResponseSchema,
      500: BrowserSessionErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionHandler,
};

export default createBrowserSessionRoute;
