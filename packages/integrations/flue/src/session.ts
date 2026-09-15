import {
  browserbase,
  localBrowser,
  Stagehand,
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

export async function getFacadeTools(): Promise<StagehandFacadeTools> {
  if (resources && !resources.browser.closed) return resources.tools;
  if (resources) discardFacadeTools(resources.tools);

  resourcesPromise ??= cleanupPromise.then(createResources);
  const pending = resourcesPromise;
  try {
    const created = await pending;
    if (resourcesPromise === pending) resources = created;
    return created.tools;
  } catch (error) {
    if (resourcesPromise === pending) resourcesPromise = undefined;
    throw error;
  } finally {
    if (resourcesPromise === pending) resourcesPromise = undefined;
  }
}

export async function discardFacadeToolsIfUnhealthy(expected: StagehandFacadeTools): Promise<void> {
  if (resources?.tools !== expected) return;

  try {
    if (!resources.browser.closed) await resources.browser.context.pages();
    else discardFacadeTools(expected);
  } catch {
    discardFacadeTools(expected);
  }
}

export async function closeFacadeSession(): Promise<void> {
  const pending = resourcesPromise;
  if (pending) await pending.catch(() => undefined);

  const current = resources;
  resources = undefined;
  resourcesPromise = undefined;

  const errors: unknown[] = [];
  await cleanupPromise.catch((error: unknown) => errors.push(error));
  if (current) {
    await current.stagehand.close().catch((error: unknown) => errors.push(error));
    await current.browser.close().catch((error: unknown) => errors.push(error));
  }
  if (errors.length > 0)
    throw new AggregateError(errors, "Failed to close the Flue facade session");
}

function discardFacadeTools(expected: StagehandFacadeTools): void {
  if (resources?.tools !== expected) return;
  const stale = resources;
  resources = undefined;
  cleanupPromise = cleanupPromise.then(() => closeResources(stale));
}

async function createResources(): Promise<FacadeResources> {
  const config = stagehandFacadeConfigFromEnv();
  const browser =
    config.browser.type === "browserbase"
      ? await browserbase.launch(config.browser.launchOptions)
      : await localBrowser.launch(config.browser.launchOptions);
  try {
    const stagehand = await Stagehand.create({ browser, ...config.stagehand });
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
