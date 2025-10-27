import Browserbase from "@browserbasehq/sdk";

export async function createBrowserbaseSession(
  apiKey: string,
  projectId: string,
  params?: Omit<Browserbase.Sessions.SessionCreateParams, "projectId"> & {
    projectId?: string;
  },
  resumeSessionId?: string,
): Promise<{ ws: string; sessionId: string; bb: Browserbase }> {
  const bb = new Browserbase({ apiKey });

  // Resume an existing session if provided
  if (resumeSessionId) {
    const existing = (await bb.sessions.retrieve(
      resumeSessionId,
    )) as unknown as { id: string; connectUrl?: string; status?: string };
    if (!existing?.id) {
      throw new Error(`Browserbase session not found: ${resumeSessionId}`);
    }

    const ws = existing.connectUrl;
    if (!ws) {
      throw new Error(
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
    throw new Error(
      "Browserbase session creation returned an unexpected shape.",
    );
  }

  return { ws: created.connectUrl, sessionId: created.id, bb };
}
