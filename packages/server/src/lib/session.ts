import { LaunchDarklyClient } from "@browserbasehq/launchdarkly";
import Browserbase from "@browserbasehq/sdk";
import type {
  ConstructorParams,
  LogLine,
  Page,
} from "@browserbasehq/stagehand";
import { Stagehand } from "@browserbasehq/stagehand";
import type { FastifyBaseLogger } from "fastify";
import { StatusCodes } from "http-status-codes";
import { V3Options, Stagehand as V3Stagehand } from "stagehand-v3";

import type { sessions } from "../lib/db/schema.js";
import { createSession, getSession } from "../lib/db/sessions.js";
import { logger } from "../server.js";
import {
  AttemptedCloseOnNonActiveSessionError,
  BrowserbaseSDKError,
} from "../types/error.js";
import { env } from "./env.js";
import { AppError } from "./errorHandler.js";
import { CachedStagehandEntry, SessionCache } from "./sessionCache.js";

const DEFAULT_CACHE_MAX_SIZE = 100;
const DEFAULT_CACHE_TTL_MS = 30_000; // 30 seconds
const onEvictCallback = async (
  _sessionId: string,
  entry: CachedStagehandEntry,
) => {
  try {
    await entry.stagehand.close();
  } catch (err) {
    if (
      err instanceof TypeError &&
      //TODO: revisit this since the new change to sdk
      err.message.includes("Cannot create proxy with a non-object")
    ) {
      throw new AttemptedCloseOnNonActiveSessionError();
    } else {
      throw new AppError(
        `Failed to close stagehand: ${err instanceof Error ? err.message : String(err)}`,
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }
  }
};

const getCacheConfig = async (launchdarkly?: LaunchDarklyClient) => {
  if (!launchdarkly) {
    return {
      maxSize: DEFAULT_CACHE_MAX_SIZE,
      ttlMs: DEFAULT_CACHE_TTL_MS,
    };
  }

  // Temporarily setting the context to the environment
  const context = { key: env.LAUNCHDARKLY_ENVIRONMENT_KEY };

  const [maxSize, ttlMs] = await Promise.all([
    launchdarkly.getFlagValue(
      "stagehand-api-session-cache-size",
      context,
      DEFAULT_CACHE_MAX_SIZE,
    ),
    launchdarkly.getFlagValue(
      "stagehand-api-session-cache-ttl",
      context,
      DEFAULT_CACHE_TTL_MS,
    ),
  ]);

  return {
    maxSize,
    ttlMs,
  };
};

let sessionCache: SessionCache;

export const initializeSessionCache = async (
  logger: FastifyBaseLogger,
  launchdarkly?: LaunchDarklyClient,
) => {
  try {
    const cacheConfig = await getCacheConfig(launchdarkly);
    sessionCache = new SessionCache(
      logger,
      onEvictCallback,
      cacheConfig.maxSize,
      cacheConfig.ttlMs,
    );

    // LaunchDarkly flag change listeners for dynamic cache configuration
    if (launchdarkly) {
      const context = { key: env.LAUNCHDARKLY_ENVIRONMENT_KEY };

      launchdarkly.onFlagChange(
        "stagehand-api-session-cache-size",
        async () => {
          try {
            const newMaxSize = await launchdarkly.getFlagValue(
              "stagehand-api-session-cache-size",
              context,
              DEFAULT_CACHE_MAX_SIZE,
            );

            // Validate the new value
            if (newMaxSize <= 0) {
              logger.warn(
                `Invalid cache size from LaunchDarkly: ${String(newMaxSize)}. Must be greater than 0. Keeping current value.`,
              );
              return;
            }

            const currentConfig = sessionCache.getConfig();
            if (currentConfig.maxCapacity !== newMaxSize) {
              logger.info(
                `LaunchDarkly flag change detected: updating cache size from ${String(currentConfig.maxCapacity)} to ${String(newMaxSize)}`,
              );
              sessionCache.updateConfig({ maxCapacity: newMaxSize });
            }
          } catch (err) {
            logger.error("Failed to update cache size from LaunchDarkly:", err);
          }
        },
      );

      launchdarkly.onFlagChange("stagehand-api-session-cache-ttl", async () => {
        try {
          const newTtl = await launchdarkly.getFlagValue(
            "stagehand-api-session-cache-ttl",
            context,
            DEFAULT_CACHE_TTL_MS,
          );

          // Validate the new value (ttlMs can be 0 for no expiry, but negative values are invalid)
          if (newTtl < 0) {
            logger.warn(
              `Invalid cache ttlMs from LaunchDarkly: ${String(newTtl)}. Must be non-negative. Keeping current value.`,
            );
            return;
          }

          const currentConfig = sessionCache.getConfig();
          if (currentConfig.ttlMs !== newTtl) {
            logger.info(
              `LaunchDarkly flag change detected: updating cache ttlMs from ${String(currentConfig.ttlMs)}ms to ${String(newTtl)}ms`,
            );
            sessionCache.updateConfig({ ttlMs: newTtl });
          }
        } catch (err) {
          logger.error("Failed to update cache ttlMs from LaunchDarkly:", err);
        }
      });
    }

    return sessionCache;
  } catch (err) {
    throw new AppError(
      `Failed to create session cache: ${err instanceof Error ? err.message : String(err)}`,
      StatusCodes.INTERNAL_SERVER_ERROR,
    );
  }
};

type Session = Partial<typeof sessions.$inferSelect> & {
  browserbaseSessionCreateParams?: Omit<
    Browserbase.SessionCreateParams,
    "projectId"
  > & { projectId?: string | undefined };
  browserbaseSessionID?: string;
  clientLanguage?: string;
};

export const startSession = async ({
  browserbaseApiKey,
  browserbaseProjectId,
  modelName = "openai/gpt-4.1",
  domSettleTimeoutMs,
  verbose,
  debugDom,
  systemPrompt,
  browserbaseSessionCreateParams,
  selfHeal,
  waitForCaptchaSolves,
  browserbaseSessionID,
  actTimeoutMs,
  clientLanguage,
  sdkVersion,
  experimental,
}: Session) => {
  if (!browserbaseApiKey || !browserbaseProjectId) {
    throw new AppError(
      "Browserbase API key and project ID are required",
      StatusCodes.BAD_REQUEST,
    );
  }

  const bb = new Browserbase({
    apiKey: browserbaseApiKey,
    baseURL: env.BB_API_BASE_URL,
  });

  if (browserbaseSessionID) {
    const existingSession = await getSession(browserbaseSessionID);

    if (existingSession) {
      if (existingSession.browserbaseApiKey !== browserbaseApiKey) {
        throw new AppError("Unauthorized", StatusCodes.UNAUTHORIZED);
      }
      try {
        const session = await bb.sessions.retrieve(browserbaseSessionID);

        if (session.status !== "RUNNING") {
          throw new AppError(
            "Requested session is not running",
            StatusCodes.BAD_REQUEST,
          );
        }

        return session;
      } catch (err: unknown) {
        throw new BrowserbaseSDKError(
          err,
          "Failed to retrieve session details",
        );
      }
    }

    const dbSession: typeof sessions.$inferInsert = {
      id: browserbaseSessionID,
      browserbaseApiKey,
      browserbaseProjectId,
      modelName,
      domSettleTimeoutMs: domSettleTimeoutMs ?? null,
      verbose: verbose ?? null,
      debugDom: debugDom ?? null,
      systemPrompt: systemPrompt ?? null,
      selfHeal: selfHeal ?? null,
      waitForCaptchaSolves: waitForCaptchaSolves ?? null,
      actTimeoutMs: actTimeoutMs ?? null,
      clientLanguage: clientLanguage ?? null,
      sdkVersion: sdkVersion ?? null,
      experimental: experimental ?? null,
    };

    const newSession = await createSession(dbSession);

    if (newSession.length === 0) {
      throw new AppError(
        "Failed to create session",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    const session = await bb.sessions.retrieve(browserbaseSessionID);

    if (session.status !== "RUNNING") {
      throw new AppError(
        "Requested session is not running",
        StatusCodes.BAD_REQUEST,
      );
    }

    return session;
  }

  try {
    const session = await bb.sessions.create({
      ...browserbaseSessionCreateParams,
      userMetadata: {
        ...(browserbaseSessionCreateParams?.userMetadata ?? {}),
        stagehand: "true",
      },
      projectId: browserbaseProjectId,
      keepAlive: true,
    });

    const dbSession: typeof sessions.$inferInsert = {
      id: session.id,
      browserbaseApiKey,
      browserbaseProjectId,
      modelName,
      domSettleTimeoutMs: domSettleTimeoutMs ?? null,
      verbose: verbose ?? null,
      debugDom: debugDom ?? null,
      systemPrompt: systemPrompt ?? null,
      selfHeal: selfHeal ?? null,
      waitForCaptchaSolves: waitForCaptchaSolves ?? null,
      actTimeoutMs: actTimeoutMs ?? null,
      clientLanguage: clientLanguage ?? null,
      sdkVersion: sdkVersion ?? null,
      experimental: experimental ?? null,
    };

    const newSession = await createSession(dbSession);

    if (newSession.length === 0) {
      throw new AppError(
        "Failed to create session",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }

    return session;
  } catch (err: unknown) {
    throw new BrowserbaseSDKError(err, "Failed to create Browserbase session");
  }
};

export const endSession = async (
  sessionId: string,
  browserbaseApiKey: string,
) => {
  const session = await getSession(sessionId);

  if (!session) {
    throw new AppError("Session not found", StatusCodes.NOT_FOUND);
  }

  if (session.browserbaseApiKey !== browserbaseApiKey) {
    throw new AppError("Unauthorized", StatusCodes.UNAUTHORIZED);
  }

  const stagehand = await resumeStagehandSession({
    sessionId,
    browserbaseApiKey: session.browserbaseApiKey,
    useV3: false,
  });

  try {
    try {
      const [page] = stagehand.context.pages();

      if (page) {
        await (page as Page).unrouteAll({ behavior: "ignoreErrors" });
      }

      await stagehand.close();
    } catch (err) {
      logger.error("Failed to properly close stagehand", err);
    }

    const bb = new Browserbase({
      apiKey: session.browserbaseApiKey,
      baseURL: env.BB_API_BASE_URL,
    });

    try {
      const bbSession = await bb.sessions.retrieve(sessionId);

      if (bbSession.status !== "RUNNING") {
        throw new AttemptedCloseOnNonActiveSessionError();
      }

      await bb.sessions.update(sessionId, {
        projectId: session.browserbaseProjectId,
        status: "REQUEST_RELEASE",
      });
    } catch (err: unknown) {
      throw new BrowserbaseSDKError(err, "Failed to close Browserbase session");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("is not running")) {
      throw new AttemptedCloseOnNonActiveSessionError();
    }

    throw new AppError(
      `Failed to close session: ${err instanceof Error ? err.message : String(err)}`,
      StatusCodes.INTERNAL_SERVER_ERROR,
    );
  }
};

interface ResumeStagehandSessionParams {
  sessionId: string;
  logger?: (data: LogLine) => void;
  requestLogger?: FastifyBaseLogger;
  modelApiKey?: string;
  browserbaseApiKey: string;
}

export async function resumeStagehandSession({
  sessionId,
  logger: currentRequestStreamLogger,
  browserbaseApiKey,
  modelApiKey,
  requestLogger,
  useV3,
}: ResumeStagehandSessionParams & { useV3?: boolean }): Promise<
  InstanceType<typeof Stagehand> | InstanceType<typeof V3Stagehand>
> {
  const sessionIdKey = `${sessionId}-${browserbaseApiKey}`;
  const cachedEntry = sessionCache.get(sessionIdKey);

  if (cachedEntry) {
    // Cache Hit: Update the loggerRef to point to the new request's logger
    if (currentRequestStreamLogger) {
      cachedEntry.loggerRef.current = currentRequestStreamLogger;
    } else {
      // If no logger is provided for this request, clear the ref
      cachedEntry.loggerRef.current = undefined;
    }
    if (useV3) {
      return cachedEntry.stagehand;
    }
    return cachedEntry.stagehand;
  }

  // Cache Miss: Create new Stagehand instance and its loggerRef
  const session = await getSession(sessionId);

  if (!session) {
    throw new AppError(
      "Session not found. Ensure the session ID is correct and was created using the Stagehand API.",
      StatusCodes.NOT_FOUND,
    );
  }
  const bb = new Browserbase({
    apiKey: session.browserbaseApiKey,
    baseURL: env.BB_API_BASE_URL,
  });

  // Get session details including the signing key
  try {
    const browserbaseSession = await bb.sessions.retrieve(sessionId);
    const { signingKey, status } = browserbaseSession;
    if (status === "COMPLETED" || status === "TIMED_OUT") {
      throw new AppError(
        "Cannot connect to session: session has completed or timed out",
        StatusCodes.GONE,
      );
    } else if (status === "ERROR") {
      throw new AppError(
        "Cannot connect to session: session status is ERROR",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }
    if (!signingKey) {
      throw new AppError(
        "Cannot connect to session: missing signing key",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }
    const cdpUrl = `${env.BB_CONNECT_BASE_URL}?signingKey=${signingKey}`;

    const loggerRef: { current?: (data: LogLine) => void } = {
      current: currentRequestStreamLogger,
    };

    let options: ConstructorParams | V3Options;
    if (useV3) {
      options = {
        env: "LOCAL",
        localBrowserLaunchOptions: {
          cdpUrl: cdpUrl,
          downloadsPath: "downloads",
        },
        model: {
          modelName: session.modelName,
          apiKey: modelApiKey,
        },
        logger: (message: LogLine) => {
          if (loggerRef.current) {
            loggerRef.current(message);
          }
        },
        verbose: session.verbose ?? 1,
        // TODO: pipe this properly and remove redundant disableAPI
        experimental: true,
      };
    } else {
      options = {
        env: "LOCAL",
        enableCaching: false,
        modelName: session.modelName,
        modelClientOptions: {
          apiKey: modelApiKey,
        },
        logger: (message: LogLine) => {
          if (loggerRef.current) {
            loggerRef.current(message);
          }
        },
        localBrowserLaunchOptions: {
          cdpUrl: cdpUrl,
          downloadsPath: "downloads",
        },
      };
      if (session.verbose) {
        options.verbose = session.verbose;
      }

      if (session.domSettleTimeoutMs) {
        options.domSettleTimeoutMs = session.domSettleTimeoutMs;
      }

      if (session.selfHeal) {
        options.selfHeal = session.selfHeal;
      }

      if (session.waitForCaptchaSolves) {
        options.waitForCaptchaSolves = session.waitForCaptchaSolves;
      }

      if (session.experimental) {
        options.experimental = session.experimental;
      }
    }
    const stagehand = useV3
      ? new V3Stagehand(options as V3Options)
      : new Stagehand(options as ConstructorParams);

    try {
      await stagehand.init();
    } catch (err) {
      requestLogger?.error(
        "Failed to resume or initialize stagehand session",
        err,
      );
    }

    sessionCache.set(sessionIdKey, { stagehand, loggerRef });

    return stagehand;
  } catch (err: unknown) {
    throw new BrowserbaseSDKError(err, "Failed to retrieve session details");
  }
}
