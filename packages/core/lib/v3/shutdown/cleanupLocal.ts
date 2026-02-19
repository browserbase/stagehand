import fs from "node:fs";

/**
 * Shared cleanup logic for locally launched Chrome.
 *
 * Used by both `V3.close()` (normal shutdown) and the supervisor process
 * (crash cleanup). The caller provides a `killChrome` callback since the
 * kill mechanism differs: chrome-launcher's `chrome.kill()` in-process
 * vs raw `process.kill(pid)` from the supervisor.
 */
export async function cleanupLocalBrowser(opts: {
  killChrome?: () => Promise<void> | void;
  userDataDir?: string;
  createdTempProfile?: boolean;
  preserveUserDataDir?: boolean;
}): Promise<void> {
  if (opts.killChrome) {
    try {
      await opts.killChrome();
    } catch {
      // best-effort
    }
  }
  if (
    opts.createdTempProfile &&
    !opts.preserveUserDataDir &&
    opts.userDataDir
  ) {
    try {
      fs.rmSync(opts.userDataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
