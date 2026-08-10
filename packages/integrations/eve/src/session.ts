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
  StagehandFacadeTools,
  stagehandFacadeConfigFromEnv,
} from "@browserbasehq/stagehand-integrations/facade";

type FacadeResources = {
  browser: StagehandBrowser;
  stagehand: Stagehand;
  tools: StagehandFacadeTools;
};

let resources: FacadeResources | undefined;
let resourcesPromise: Promise<FacadeResources> | undefined;
let cleanupPromise: Promise<void> = Promise.resolve();
let browserbaseSessionId: string | undefined;
let persistedSessionIdLoaded = false;

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

export async function discardFacadeToolsIfUnhealthy(expected: StagehandFacadeTools): Promise<void> {
  if (resources?.tools !== expected) return;

  try {
    if (resources.browser.closed) {
      discardFacadeTools(expected);
      return;
    }
    await resources.browser.context.pages();
  } catch {
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
    const browser = await connectToSession(apiKey, browserbaseSessionId, baseUrl);
    if (browser) return attach(browser, config.stagehand);

    browserbaseSessionId = undefined;
    persistSessionId(undefined);
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
  return attach(browser, config.stagehand);
}

async function connectToSession(
  apiKey: string,
  sessionId: string,
  baseUrl: string | undefined,
): Promise<StagehandBrowser | undefined> {
  try {
    return await browserbase.connect({
      apiKey,
      sessionId,
      ...(baseUrl ? { baseUrl } : {}),
    });
  } catch {
    return undefined;
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
  return (
    process.env.STAGEHAND_EVE_SESSION_FILE ??
    path.join(os.tmpdir(), "stagehand-eve-facade-session.json")
  );
}

async function attach(
  browser: StagehandBrowser,
  config: StagehandClientCreateConfig,
): Promise<FacadeResources> {
  try {
    const stagehand = await Stagehand.create({ browser, ...config });
    return { browser, stagehand, tools: new StagehandFacadeTools(stagehand) };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

async function closeResources(stale: FacadeResources): Promise<void> {
  await stale.stagehand.close().catch(() => undefined);
  await stale.browser.close().catch(() => undefined);
}
