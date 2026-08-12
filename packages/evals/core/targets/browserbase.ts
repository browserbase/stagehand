import { createReadStream } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { registerActiveRunCleanup } from "../../framework/activeRunCleanup.js";
import { loadBrowserbaseSdk, resolveStagehandExtensionArchivePath } from "../runtime/coreDeps.js";

const DEFAULT_VIEWPORT = { width: 1288, height: 711 };
const EXTENSION_SCOPE_DRAIN_TIMEOUT_MS = 5_000;

type BrowserbaseClient = InstanceType<ReturnType<typeof loadBrowserbaseSdk>>;

type ExtensionScope = {
  provision?: Promise<{ extensionId: string; deleteUpload: () => Promise<void> }>;
  cleanupPromise?: Promise<void>;
  unregisterCleanup?: () => void;
  activeSessions: number;
  drained?: Promise<void>;
  resolveDrained?: () => void;
};

const extensionScopeStorage = new AsyncLocalStorage<ExtensionScope>();

async function uploadStagehandExtension(
  bb: BrowserbaseClient,
): Promise<{ extensionId: string; deleteUpload: () => Promise<void> }> {
  const uploaded = await bb.extensions.create({
    file: createReadStream(resolveStagehandExtensionArchivePath()),
  });
  const extensionId = uploaded.id.trim();
  if (!extensionId) {
    throw new Error("Browserbase extension upload returned an empty extension ID");
  }

  let deletePromise: Promise<void> | undefined;
  return {
    extensionId,
    deleteUpload: () => {
      deletePromise ??= bb.extensions
        .delete(extensionId, { headers: { "Content-Type": null } })
        .then((): undefined => undefined)
        .catch((): undefined => undefined);
      return deletePromise;
    },
  };
}

async function cleanupExtensionScope(scope: ExtensionScope): Promise<void> {
  scope.cleanupPromise ??= (async () => {
    if (scope.activeSessions > 0) {
      scope.drained ??= new Promise<void>((resolve) => {
        scope.resolveDrained = resolve;
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        scope.drained,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, EXTENSION_SCOPE_DRAIN_TIMEOUT_MS);
        }),
      ]);
      if (timeout) clearTimeout(timeout);
    }
    const provisioned = await scope.provision?.catch((): undefined => undefined);
    await provisioned?.deleteUpload();
    scope.unregisterCleanup?.();
  })();
  await scope.cleanupPromise;
}

/** Reuses one uploaded extension across every Browserbase session in a run. */
export async function withBrowserbaseExtensionScope<T>(fn: () => Promise<T>): Promise<T> {
  if (extensionScopeStorage.getStore()) return fn();

  const scope: ExtensionScope = { activeSessions: 0 };
  try {
    return await extensionScopeStorage.run(scope, fn);
  } finally {
    await cleanupExtensionScope(scope);
  }
}

async function acquireStagehandExtension(
  bb: BrowserbaseClient,
): Promise<{ extensionId: string; release: () => Promise<void> }> {
  const scope = extensionScopeStorage.getStore();
  if (!scope) {
    const provisioned = await uploadStagehandExtension(bb);
    return { extensionId: provisioned.extensionId, release: provisioned.deleteUpload };
  }

  if (!scope.provision) {
    const provision = uploadStagehandExtension(bb);
    scope.provision = provision;
    scope.unregisterCleanup ??= registerActiveRunCleanup(() => cleanupExtensionScope(scope));
    provision.catch(() => {
      if (scope.provision === provision) scope.provision = undefined;
    });
  }
  const provisioned = await scope.provision;
  scope.activeSessions += 1;
  let released = false;
  return {
    extensionId: provisioned.extensionId,
    release: async () => {
      if (released) return;
      released = true;
      scope.activeSessions = Math.max(0, scope.activeSessions - 1);
      if (scope.activeSessions === 0) scope.resolveDrained?.();
    },
  };
}

function loadBrowserbaseCredentials(): { apiKey: string; projectId?: string } {
  const apiKey = process.env.BROWSERBASE_API_KEY || process.env.BB_API_KEY || "";
  const projectId = process.env.BROWSERBASE_PROJECT_ID || process.env.BB_PROJECT_ID;

  if (!apiKey) {
    throw new Error("BROWSERBASE_API_KEY is required for runner_provided_browserbase_cdp");
  }

  return { apiKey, projectId };
}

export async function launchRunnerProvidedBrowserbaseChrome(): Promise<{
  wsUrl: string;
  sessionId: string;
  sessionUrl: string;
  debugUrl?: string;
  extensionId: string;
  cleanup: () => Promise<void>;
}> {
  const { apiKey, projectId } = loadBrowserbaseCredentials();
  const Browserbase = loadBrowserbaseSdk();
  const bb = new Browserbase({ apiKey });

  const extension = await acquireStagehandExtension(bb);
  const { extensionId } = extension;

  const createPayload: Record<string, unknown> = {
    ...(projectId ? { projectId } : {}),
    extensionId,
    browserSettings: {
      viewport: DEFAULT_VIEWPORT,
    },
    userMetadata: {
      stagehand: "true",
      evals: "true",
    },
  };

  if (process.env.BROWSERBASE_REGION) {
    createPayload.region = process.env.BROWSERBASE_REGION;
  }

  const sessionPromise = bb.sessions.create(createPayload) as Promise<{
    id?: string;
    connectUrl?: string;
  }>;
  let created: { id?: string; connectUrl?: string } | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanupOwnedResources = (): Promise<void> => {
    cleanupPromise ??= (async () => {
      const session = created ?? (await sessionPromise.catch((): undefined => undefined));
      if (session?.id) {
        await bb.sessions
          .update(session.id, {
            status: "REQUEST_RELEASE",
            ...(projectId ? { projectId } : {}),
          })
          .catch(() => {});
      }
      await extension.release();
    })();
    return cleanupPromise;
  };
  const unregisterCleanup = registerActiveRunCleanup(cleanupOwnedResources);
  const cleanup = async (): Promise<void> => {
    await cleanupOwnedResources();
    unregisterCleanup();
  };

  try {
    created = await sessionPromise;
  } catch {
    await cleanup();
    throw new Error("Browserbase session creation failed.");
  }

  if (!created.id || !created.connectUrl) {
    await cleanup();
    throw new Error("Browserbase session creation returned an unexpected shape.");
  }

  let debugUrl: string | undefined;
  try {
    const debugResponse = (await bb.sessions.debug?.(created.id)) as
      | {
          debuggerUrl?: string;
        }
      | undefined;
    debugUrl = debugResponse?.debuggerUrl;
  } catch {
    // best-effort only
  }

  return {
    wsUrl: created.connectUrl,
    sessionId: created.id,
    sessionUrl: `https://www.browserbase.com/sessions/${created.id}`,
    debugUrl,
    extensionId,
    cleanup,
  };
}
