import Browserbase from "@browserbasehq/sdk";

export interface BrowserbaseSessionRelease {
  apiKey: string;
  baseUrl?: string;
  sessionId: string;
}

const BROWSERBASE_API_URL = "https://api.browserbase.com";
const SESSION_RELEASE_MAX_RETRIES = 2;
const SESSION_RELEASE_TIMEOUT_MS = 10_000;

export class BrowserbaseSessionReleaseError extends Error {
  override readonly name = "BrowserbaseSessionReleaseError";

  constructor() {
    super("Failed to release the Browserbase session.");
  }
}

export async function releaseBrowserbaseSession(session: BrowserbaseSessionRelease): Promise<void> {
  const trimmedSessionId = session.sessionId.trim();
  if (!trimmedSessionId || session.sessionId === "." || session.sessionId === "..") {
    throw new BrowserbaseSessionReleaseError();
  }
  const browserbase = new Browserbase({
    apiKey: session.apiKey,
    baseURL: (session.baseUrl?.trim() || BROWSERBASE_API_URL).replace(/\/+$/u, ""),
    maxRetries: SESSION_RELEASE_MAX_RETRIES,
    timeout: SESSION_RELEASE_TIMEOUT_MS,
  });
  const sessionId = encodeURIComponent(session.sessionId);

  try {
    await browserbase.sessions.update(sessionId, { status: "REQUEST_RELEASE" });
    return;
  } catch {}

  try {
    const remoteSession = await browserbase.sessions.retrieve(sessionId);
    if (remoteSession.status === "COMPLETED") return;
  } catch {}

  throw new BrowserbaseSessionReleaseError();
}
