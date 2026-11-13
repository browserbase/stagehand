import open from "open";

export interface OpenUrlOptions {
  /**
   * Whether to skip opening the browser entirely.
   * When true, the URL is not opened regardless of environment.
   */
  noOpen?: boolean;
}

export interface OpenUrlResult {
  /**
   * Whether the browser was attempted to be opened.
   */
  attempted: boolean;
  /**
   * Whether the opener process started (or opening was skipped).
   * False only when an open was attempted but the spawn failed.
   */
  success: boolean;
}

/**
 * Opens a URL in the system's default browser.
 *
 * Opens the browser when stdout is a TTY and the CI environment variable is
 * not enabled. Returns a result indicating whether the open was attempted and
 * whether it succeeded. Never throws; failures are reported through the
 * result object so callers can print the URL and exit cleanly.
 */
export async function openUrl(url: string, options: OpenUrlOptions = {}): Promise<OpenUrlResult> {
  if (options.noOpen || !process.stdout.isTTY || (process.env.CI && process.env.CI !== "false")) {
    return { attempted: false, success: true };
  }

  try {
    await open(url);
    return { attempted: true, success: true };
  } catch {
    return { attempted: true, success: false };
  }
}
