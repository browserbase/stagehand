import { loadBrowserbaseSdk } from "../runtime/coreDeps.js";

const DEFAULT_VIEWPORT = { width: 1288, height: 711 };

function loadBrowserbaseCredentials(): { apiKey: string; projectId?: string } {
  const apiKey =
    process.env.BROWSERBASE_API_KEY || process.env.BB_API_KEY || "";
  const projectId =
    process.env.BROWSERBASE_PROJECT_ID || process.env.BB_PROJECT_ID;

  if (!apiKey) {
    throw new Error(
      "BROWSERBASE_API_KEY is required for runner_provided_browserbase_cdp",
    );
  }

  return { apiKey, projectId };
}

export async function launchRunnerProvidedBrowserbaseChrome(): Promise<{
  wsUrl: string;
  sessionId: string;
  sessionUrl: string;
  debugUrl?: string;
  cleanup: () => Promise<void>;
}> {
  const { apiKey, projectId } = loadBrowserbaseCredentials();
  const Browserbase = loadBrowserbaseSdk();
  const bb = new Browserbase({ apiKey });

  const createPayload: Record<string, unknown> = {
    ...(projectId ? { projectId } : {}),
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

  const created = (await bb.sessions.create(createPayload)) as {
    id?: string;
    connectUrl?: string;
  };

  if (!created.id || !created.connectUrl) {
    throw new Error(
      "Browserbase session creation returned an unexpected shape.",
    );
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
    cleanup: async () => {
      try {
        await bb.sessions.update(created.id!, {
          status: "REQUEST_RELEASE",
          ...(projectId ? { projectId } : {}),
        });
      } catch {
        // best-effort only
      }
    },
  };
}
