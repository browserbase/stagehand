import Browserbase from "@browserbasehq/sdk";
import {
  BrowserbaseSessionNotFoundError,
  StagehandInitError,
} from "../types/public/sdkErrors.js";
import type { BrowserbaseSessionCreateParams } from "../types/public/api.js";
import { getEnvTimeoutMs, withTimeout } from "../timeoutConfig.js";

export async function createBrowserbaseSession(
  apiKey: string,
  projectId: string,
  params?: BrowserbaseSessionCreateParams,
  resumeSessionId?: string,
): Promise<{ ws: string; sessionId: string; bb: Browserbase }> {
  const bb = new Browserbase({ apiKey });
  const sessionCreateTimeoutMs = getEnvTimeoutMs(
    "BROWSERBASE_SESSION_CREATE_MAX_MS",
  );

  // Resume an existing session if provided
  if (resumeSessionId) {
    const retrievePromise = bb.sessions.retrieve(resumeSessionId);
    const existing = (sessionCreateTimeoutMs
      ? await withTimeout(
          retrievePromise,
          sessionCreateTimeoutMs,
          "Browserbase session retrieve",
        )
      : await retrievePromise) as unknown as {
      id: string;
      connectUrl?: string;
      status?: string;
    };
    if (!existing?.id) {
      throw new BrowserbaseSessionNotFoundError();
    }

    const ws = existing.connectUrl;
    if (!ws) {
      throw new StagehandInitError(
        `Browserbase session resume missing connectUrl for ${resumeSessionId}`,
      );
    }
    return { ws, sessionId: resumeSessionId, bb };
  }

  // Create a new session with optional overrides and a default viewport
  const {
    projectId: overrideProjectId,
    browserSettings,
    userMetadata,
    ...rest
  } = params ?? {};

  // satisfies check ensures our BrowserbaseSessionCreateParamsSchema stays in sync with SDK
  const createPayload = {
    projectId: overrideProjectId ?? projectId,
    ...rest,
    browserSettings: {
      ...(browserSettings ?? {}),
      viewport: browserSettings?.viewport ?? { width: 1288, height: 711 },
    },
    userMetadata: {
      ...(userMetadata ?? {}),
      stagehand: "true",
    },
  } satisfies Browserbase.Sessions.SessionCreateParams;

  const createPromise = bb.sessions.create(createPayload);
  const created = (sessionCreateTimeoutMs
    ? await withTimeout(
        createPromise,
        sessionCreateTimeoutMs,
        "Browserbase session create",
      )
    : await createPromise) as unknown as { id: string; connectUrl: string };

  if (!created?.connectUrl || !created?.id) {
    throw new StagehandInitError(
      "Browserbase session creation returned an unexpected shape.",
    );
  }

  return { ws: created.connectUrl, sessionId: created.id, bb };
}
