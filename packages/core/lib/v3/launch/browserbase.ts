import Browserbase from "@browserbasehq/sdk";
import {
  BrowserbaseSessionNotFoundError,
  StagehandInitError,
} from "../types/public/sdkErrors";
import type { BrowserbaseSessionCreateParams } from "../types/public/api";

export async function createBrowserbaseSession(
  apiKey: string,
  projectId: string,
  params?: BrowserbaseSessionCreateParams,
  resumeSessionId?: string,
): Promise<{ ws: string; sessionId: string; bb: Browserbase }> {
  const bb = new Browserbase({ apiKey });

  // Resume an existing session if provided
  if (resumeSessionId) {
    const existing = (await bb.sessions.retrieve(
      resumeSessionId,
    )) as unknown as { id: string; connectUrl?: string; status?: string };
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

  const created = (await bb.sessions.create(createPayload)) as unknown as {
    id: string;
    connectUrl: string;
  };

  if (!created?.connectUrl || !created?.id) {
    throw new StagehandInitError(
      "Browserbase session creation returned an unexpected shape.",
    );
  }

  return { ws: created.connectUrl, sessionId: created.id, bb };
}
