import { StatusCodes } from "http-status-codes";
import type { V3 } from "@browserbasehq/stagehand";

import { AppError } from "../../lib/errorHandler.js";
import type { EventBus } from "../../lib/bubus.js";
import type { SessionStore } from "../../lib/SessionStore.js";
import type { V4State } from "../state.js";
import type { V4BrowserRecord } from "../types.js";

const PROVIDER_ENV_KEY: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  microsoft: "AZURE_OPENAI_API_KEY",
};

export interface ServiceDeps {
  bus: EventBus;
  state: V4State;
  sessionStore: SessionStore;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function resolveBrowserOrThrow(
  state: V4State,
  browserId?: string,
  apiSessionId?: string,
): V4BrowserRecord {
  if (browserId) {
    const browser = state.getBrowser(browserId);
    if (!browser) {
      throw new AppError(`Browser not found: ${browserId}`, StatusCodes.NOT_FOUND);
    }
    return browser;
  }

  if (apiSessionId) {
    const browser = state.getBrowserByApiSessionId(apiSessionId);
    if (!browser) {
      throw new AppError(
        `No browser found for session: ${apiSessionId}`,
        StatusCodes.NOT_FOUND,
      );
    }
    return browser;
  }

  const browser = state.getFirstRunningBrowser();
  if (!browser) {
    throw new AppError(
      "No running browser found. Launch one with POST /v4/browser.",
      StatusCodes.BAD_REQUEST,
    );
  }

  return browser;
}

export function canInitializeWithoutRequestApiKey(modelName: string): boolean {
  const provider = modelName.split("/", 1)[0] ?? "openai";
  const envKeyName = PROVIDER_ENV_KEY[provider];
  if (!envKeyName) {
    return false;
  }

  return Boolean(process.env[envKeyName]);
}

export async function getStagehandForBrowser(
  deps: ServiceDeps,
  browser: V4BrowserRecord,
  modelApiKey?: string,
): Promise<V3> {
  return deps.sessionStore.getOrCreateStagehand(browser.sessionId, {
    modelApiKey,
  });
}

export async function resolvePageForAction(
  stagehand: V3,
  options: {
    pageId?: string;
    frameId?: string;
  },
) {
  const { pageId, frameId } = options;

  if (pageId) {
    const page = stagehand.context.resolvePageByTargetId(pageId);
    if (!page) {
      throw new AppError(`Page not found: ${pageId}`, StatusCodes.NOT_FOUND);
    }
    return page;
  }

  if (frameId) {
    const page = stagehand.context.resolvePageByMainFrameId(frameId);
    if (!page) {
      throw new AppError(`Frame owner page not found: ${frameId}`, StatusCodes.NOT_FOUND);
    }
    return page;
  }

  return stagehand.context.awaitActivePage();
}
