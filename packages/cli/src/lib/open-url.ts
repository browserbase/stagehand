import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

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
export function openUrl(url: string, options: OpenUrlOptions = {}): OpenUrlResult {
  if (options.noOpen || !shouldOpenBrowser()) {
    return { attempted: false, success: true };
  }

  return spawnBrowserOpen(url);
}

function shouldOpenBrowser(): boolean {
  if (!process.stdout.isTTY) {
    return false;
  }

  const ci = process.env.CI;
  if (ci !== undefined && ci !== "" && ci.trim().toLowerCase() !== "false") {
    return false;
  }

  return true;
}

/**
 * Returns the command and arguments to open a URL in the default browser.
 * Exported for testing.
 */
export function getOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (platform === "win32") {
    // Using rundll32 avoids shell mangling of URLs with & characters.
    // cmd /c start "" "url" mangles URLs; rundll32 passes them untouched.
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }

  // Linux and other Unix-like systems (including WSL)
  return { command: "xdg-open", args: [url] };
}

function spawnBrowserOpen(url: string): OpenUrlResult {
  const { command, args } = getOpenCommand(url);

  const spawnOptions: SpawnOptions = {
    stdio: "ignore",
    detached: true,
    shell: false,
  };

  let child: ChildProcess;
  try {
    child = spawn(command, args, spawnOptions);
  } catch {
    // Synchronous spawn failure (rare)
    return { attempted: true, success: false };
  }

  // Handle async spawn errors (e.g., ENOENT when opener doesn't exist).
  // Without this listener, Node would emit an uncaught 'error' event and crash.
  child.on("error", () => {
    // Swallow - we've already returned success: true because the spawn() call
    // itself succeeded. The user will still see the printed URL.
  });

  child.unref();
  return { attempted: true, success: true };
}
