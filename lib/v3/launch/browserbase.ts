import Browserbase from "@browserbasehq/sdk";

export async function createBrowserbaseSession(
  apiKey: string,
  projectId: string,
): Promise<{ ws: string; sessionId: string; bb: Browserbase }> {
  const bb = new Browserbase({ apiKey });
  const session = (await bb.sessions.create({
    projectId,
  })) as { id: string; connectUrl: string };

  if (!session?.connectUrl || !session?.id) {
    throw new Error(
      "Browserbase session creation returned an unexpected shape.",
    );
  }

  return { ws: session.connectUrl, sessionId: session.id, bb };
}
