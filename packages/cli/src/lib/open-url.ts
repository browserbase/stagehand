import spawn from "cross-spawn";

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
  if (options.noOpen || !shouldOpenBrowser()) {
    return { attempted: false, success: true };
  }

  try {
    const child = spawnBrowserOpen(url);
    return await new Promise<OpenUrlResult>((resolve) => {
      child.once("error", () => resolve({ attempted: true, success: false }));
      child.once("spawn", () => {
        child.unref();
        resolve({ attempted: true, success: true });
      });
    });
  } catch {
    return { attempted: true, success: false };
  }
}

function shouldOpenBrowser(): boolean {
  if (!process.stdout.isTTY) {
    return false;
  }

  const ci = process.env.CI;
  if (ci && !isExplicitFalse(ci)) {
    return false;
  }

  return true;
}

function isExplicitFalse(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

function spawnBrowserOpen(url: string): ReturnType<typeof spawn> {
  const platform = process.platform;

  if (platform === "darwin") {
    return spawn("open", [url], { stdio: "ignore", detached: true });
  }

  if (platform === "win32") {
    return spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
  }

  // Linux and other Unix-like systems
  return spawn("xdg-open", [url], { stdio: "ignore", detached: true });
}
