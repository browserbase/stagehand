import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  browserbase,
  localBrowser,
  Stagehand,
  type StagehandClientCreateConfig,
  type StagehandBrowser,
} from "@browserbasehq/stagehand";
import {
  releaseBrowserbaseSession,
  StagehandFacadeTools,
  stagehandFacadeConfigFromEnv,
} from "@browserbasehq/stagehand-integrations/facade";

type FacadeResources = {
  browser: StagehandBrowser;
  stagehand: Stagehand;
  tools: StagehandFacadeTools;
  session?: {
    apiKey: string;
    baseUrl: string | undefined;
    id: string;
  };
};

let resources: FacadeResources | undefined;
let resourcesPromise: Promise<FacadeResources> | undefined;
let cleanupPromise: Promise<void> = Promise.resolve();
let browserbaseSessionId: string | undefined;
let persistedSessionIdLoaded = false;
// Session flagged as wedged (connectable but broken). Reconnecting to it would
// loop forever, so the next createResources releases it and launches fresh.
let suspectSessionId: string | undefined;

export async function getFacadeTools(): Promise<StagehandFacadeTools> {
  const current = await ensureResources();
  if (!current.browser.closed) return current.tools;

  discardFacadeTools(current.tools);
  return (await ensureResources()).tools;
}

export function discardFacadeTools(expected: StagehandFacadeTools): void {
  if (resources?.tools !== expected) return;

  const stale = resources;
  resources = undefined;
  resourcesPromise = undefined;
  cleanupPromise = cleanupPromise.then(() => closeResources(stale));
}

async function closeRequestedFacadeTools(expected: StagehandFacadeTools): Promise<void> {
  if (resources?.tools !== expected) return;

  const stale = resources;
  resources = undefined;
  resourcesPromise = undefined;
  const closeResult = cleanupPromise.then(() => closeResources(stale, true));
  cleanupPromise = closeResult.catch(() => undefined);
  await closeResult;
}

export async function discardFacadeToolsIfUnhealthy(expected: StagehandFacadeTools): Promise<void> {
  if (resources?.tools !== expected) return;

  try {
    if (resources.browser.closed) {
      discardFacadeTools(expected);
      return;
    }
    await resources.browser.context.pages();
  } catch {
    // The remote session itself is unhealthy (connectable but broken), so
    // reattaching by id would loop forever. Flag it as suspect so the next
    // createResources releases it and launches fresh. Do NOT clear the
    // persisted id here: keeping it lets the recovery path release the
    // keep-alive session instead of stranding it on billing.
    suspectSessionId = browserbaseSessionId;
    discardFacadeTools(expected);
  }
}

async function ensureResources(): Promise<FacadeResources> {
  if (resources && !resources.browser.closed) return resources;

  resourcesPromise ??= cleanupPromise.then(createResources);
  const pending = resourcesPromise;
  try {
    const created = await pending;
    if (resourcesPromise === pending) resources = created;
    return created;
  } catch (error) {
    if (resourcesPromise === pending) resourcesPromise = undefined;
    throw error;
  }
}

async function createResources(): Promise<FacadeResources> {
  const config = stagehandFacadeConfigFromEnv();
  if (config.browser.type === "local") {
    const browser = await localBrowser.launch(config.browser.launchOptions);
    return attach(browser, config.stagehand);
  }

  loadPersistedSessionId();
  const { apiKey, baseUrl, ...sessionOptions } = config.browser.launchOptions;
  if (browserbaseSessionId) {
    // Skip reconnecting to a session flagged as wedged — it is connectable but
    // broken, so reattaching would loop forever (the "no brick" invariant).
    if (browserbaseSessionId !== suspectSessionId) {
      const browser = await connectToSession(apiKey, browserbaseSessionId, baseUrl);
      if (browser) {
        return attach(browser, config.stagehand, {
          apiKey,
          baseUrl,
          id: browserbaseSessionId,
        });
      }
    }

    // Recovery is bounded: release the old keep-alive session best-effort so
    // it doesn't strand on billing (the "no strand" invariant), then launch
    // fresh. The persisted id is never cleared on failure paths — the fresh
    // launch overwrites it via persistSessionId only after it succeeds.
    await releaseSession(apiKey, browserbaseSessionId, baseUrl);
    suspectSessionId = undefined;
  }

  // Create through browserbase.launch — NOT the raw Browserbase SDK — so the
  // Stagehand extension is provisioned into the session. A raw
  // sessions.create + browserbase.connect pair hangs for the full init
  // timeout because connect expects the extension to be preloaded.
  const browser = await browserbase.launch({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...sessionOptions,
    keepAlive: true,
  });
  if (browser.sessionId) {
    browserbaseSessionId = browser.sessionId;
    persistSessionId(browser.sessionId);
  }
  return attach(
    browser,
    config.stagehand,
    browser.sessionId ? { apiKey, baseUrl, id: browser.sessionId } : undefined,
  );
}

async function connectToSession(
  apiKey: string,
  sessionId: string,
  baseUrl: string | undefined,
): Promise<StagehandBrowser | undefined> {
  const connect = () =>
    browserbase.connect({
      apiKey,
      sessionId,
      ...(baseUrl ? { baseUrl } : {}),
    });

  try {
    return await connect();
  } catch {
    // One bounded retry covers transient network/5xx blips. If it also fails,
    // the caller releases the old session and launches fresh — never rethrow,
    // so a flaky reconnect can neither brick recovery nor strand the session.
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      return await connect();
    } catch {
      return undefined;
    }
  }
}

async function releaseSession(
  apiKey: string,
  sessionId: string,
  baseUrl: string | undefined,
): Promise<boolean> {
  try {
    await releaseBrowserbaseSession({ apiKey, baseUrl, sessionId });
    return true;
  } catch {
    // Recovery paths are best-effort; explicit close turns false into a stable
    // lifecycle error so the model cannot falsely report successful cleanup.
    return false;
  }
}

function loadPersistedSessionId(): void {
  if (persistedSessionIdLoaded || browserbaseSessionId) return;
  persistedSessionIdLoaded = true;

  try {
    const stored = JSON.parse(readFileSync(sessionFilePath(), "utf8")) as unknown;
    if (
      typeof stored === "object" &&
      stored !== null &&
      "sessionId" in stored &&
      typeof stored.sessionId === "string" &&
      stored.sessionId
    ) {
      browserbaseSessionId = stored.sessionId;
    }
  } catch {
    // A missing or malformed file is equivalent to having no persisted session.
  }
}

function persistSessionId(sessionId: string | undefined): void {
  try {
    if (sessionId) {
      writeFileSync(sessionFilePath(), JSON.stringify({ sessionId }));
    } else {
      rmSync(sessionFilePath(), { force: true });
    }
  } catch {
    // Persistence failures must not prevent the browser session from being used.
  }
}

function sessionFilePath(): string {
  if (process.env.STAGEHAND_EVE_SESSION_FILE) return process.env.STAGEHAND_EVE_SESSION_FILE;
  // Scope the default file by API key so concurrent processes (or different
  // keys) on one machine don't attach to or clobber each other's session.
  const key = process.env.BROWSERBASE_API_KEY ?? "";
  const scope = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return path.join(os.tmpdir(), `stagehand-eve-facade-session-${scope}.json`);
}

async function attach(
  browser: StagehandBrowser,
  config: StagehandClientCreateConfig,
  session?: FacadeResources["session"],
): Promise<FacadeResources> {
  try {
    const stagehand = await Stagehand.create({ browser, ...config });
    let tools: StagehandFacadeTools;
    tools = new StagehandFacadeTools(stagehand, {
      close: () => closeRequestedFacadeTools(tools),
    });
    return { browser, stagehand, tools, ...(session ? { session } : {}) };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

async function closeResources(stale: FacadeResources, explicit = false): Promise<void> {
  const cleanupErrors: unknown[] = [];
  await stale.stagehand.close().catch((error) => cleanupErrors.push(error));
  await stale.browser.close().catch((error) => cleanupErrors.push(error));

  if (explicit && stale.session) {
    const released = await releaseSession(
      stale.session.apiKey,
      stale.session.id,
      stale.session.baseUrl,
    );
    if (!released) {
      suspectSessionId = stale.session.id;
      cleanupErrors.push(new Error("Failed to release the Browserbase session."));
    } else if (browserbaseSessionId === stale.session.id) {
      browserbaseSessionId = undefined;
      suspectSessionId = undefined;
      persistSessionId(undefined);
    }
  }

  if (!explicit || cleanupErrors.length === 0) return;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  throw new AggregateError(cleanupErrors, "Failed to close the browser session cleanly.");
}
