/**
 * Browser/session shutdown helpers for Stagehand.
 *
 * This module only handles browser-facing teardown (Browserbase session end,
 * local Chrome process kill, profile cleanup). It intentionally avoids touching
 * Stagehand internal state.
 */

/**
 * End a Browserbase session via the API client when keepAlive is not enabled.
 */
export async function shutdownBrowserSession(opts: {
  keepAlive?: boolean;
  endApiClient?: () => Promise<void>;
}): Promise<void> {
  if (opts.keepAlive) return;
  if (!opts.endApiClient) return;
  try {
    await opts.endApiClient();
  } catch {
    // best-effort cleanup
  }
}

/**
 * Shut down a locally launched Chrome and clean up its user data dir
 * when keepAlive is not enabled.
 */
export async function shutdownLocalBrowser(opts: {
  keepAlive?: boolean;
  killChrome?: () => Promise<void>;
  cleanupUserDataDir?: () => void;
}): Promise<void> {
  if (opts.keepAlive) return;
  if (opts.killChrome) {
    try {
      await opts.killChrome();
    } catch {
      // best-effort cleanup
    }
  }
  if (opts.cleanupUserDataDir) {
    try {
      opts.cleanupUserDataDir();
    } catch {
      // ignore cleanup errors
    }
  }
}
