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
  const browserbase = new Browserbase({
    apiKey: session.apiKey,
    baseURL: (session.baseUrl ?? BROWSERBASE_API_URL).replace(/\/+$/u, ""),
    maxRetries: SESSION_RELEASE_MAX_RETRIES,
    timeout: SESSION_RELEASE_TIMEOUT_MS,
  });
  // The generated SDK currently interpolates path parameters without encoding
  // them. Keep the server-issued ID confined to one URL path segment.
  const sessionId = encodeURIComponent(session.sessionId);

  try {
    await browserbase.sessions.update(sessionId, { status: "REQUEST_RELEASE" });
    return;
  } catch {
    // Verify the remote state below before reporting a failed retry.
  }

  try {
    const remoteSession = await browserbase.sessions.retrieve(sessionId);
    if (remoteSession.status === "COMPLETED") return;
  } catch {
    // Fall through to the stable lifecycle error below.
  }

  throw new BrowserbaseSessionReleaseError();
}
