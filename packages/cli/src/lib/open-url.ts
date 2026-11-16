import { readFileSync } from "node:fs";
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
 * WSL and environment detection helpers. Exported for test mocking.
 */
export const platformDetection = {
  isWsl(): boolean {
    if (process.env.WSL_DISTRO_NAME) return true;
    try {
      const content = readFileSync("/proc/version", "utf8");
      return /microsoft/i.test(content);
    } catch {
      return false;
    }
  },
  isSSH(): boolean {
    return !!(process.env.SSH_CONNECTION || process.env.SSH_TTY);
  },
  getBrowser(): string | undefined {
    return process.env.BROWSER || undefined;
  },
};

export interface OpenCommand {
  command: string;
  args: string[];
  fallback?: { command: string; args: string[] };
}

/**
 * Returns the command and arguments to open a URL in the default browser.
 * Exported for testing.
 */
export function getOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): OpenCommand {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }

  // Linux and other Unix-like systems
  const browser = platformDetection.getBrowser();
  if (browser) {
    return { command: browser, args: [url] };
  }

  // WSL: use Windows opener via interop (unless over SSH)
  if (platformDetection.isWsl() && !platformDetection.isSSH()) {
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
      fallback: { command: "xdg-open", args: [url] },
    };
  }

  return { command: "xdg-open", args: [url] };
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

function spawnBrowserOpen(url: string): OpenUrlResult {
  const { command, args, fallback } = getOpenCommand(url);

  const spawnOptions: SpawnOptions = {
    stdio: "ignore",
    detached: true,
    shell: false,
  };

  let child: ChildProcess;
  try {
    child = spawn(command, args, spawnOptions);
  } catch {
    return { attempted: true, success: false };
  }

  child.on("error", () => {
    // Primary command failed (e.g. ENOENT). Try fallback if available.
    if (fallback) {
      try {
        const fallbackChild = spawn(fallback.command, fallback.args, spawnOptions);
        fallbackChild.on("error", () => {});
        fallbackChild.unref();
      } catch {
        // Fallback also failed synchronously; URL is still printed
      }
    }
  });

  child.unref();
  return { attempted: true, success: true };
}
