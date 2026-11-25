import { readFileSync } from "node:fs";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export interface OpenUrlOptions {
  noOpen?: boolean;
}

export interface OpenUrlResult {
  attempted: boolean;
  success: boolean;
}

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

function parseBrowserEntry(entry: string, url: string): { command: string; args: string[] } {
  const parts = entry.trim().split(/\s+/).filter(Boolean);
  const command = parts[0] ?? entry;
  const templateArgs = parts.slice(1);

  const hasPlaceholder = templateArgs.some((arg) => arg.includes("%s"));
  const args = hasPlaceholder
    ? templateArgs.map((arg) => arg.replace(/%s/g, url))
    : [...templateArgs, url];

  return { command, args };
}

export function parseBrowserEnv(
  browser: string,
  url: string,
): Array<{ command: string; args: string[] }> {
  return browser
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseBrowserEntry(entry, url));
}

export interface OpenCommand {
  command: string;
  args: string[];
  fallbacks?: Array<{ command: string; args: string[] }>;
}

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

  const browser = platformDetection.getBrowser();
  if (browser) {
    const entries = parseBrowserEnv(browser, url);
    const first = entries[0];
    if (!first) {
      return { command: "xdg-open", args: [url] };
    }
    const rest = entries.slice(1);
    return {
      command: first.command,
      args: first.args,
      fallbacks: rest.length > 0 ? rest : undefined,
    };
  }

  if (platformDetection.isWsl() && !platformDetection.isSSH()) {
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
      fallbacks: [{ command: "xdg-open", args: [url] }],
    };
  }

  return { command: "xdg-open", args: [url] };
}

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
  const { command, args, fallbacks } = getOpenCommand(url);

  const spawnOptions: SpawnOptions = {
    stdio: "ignore",
    detached: true,
    shell: false,
  };

  function trySpawn(cmd: string, cmdArgs: string[], remaining: typeof fallbacks): boolean {
    let child: ChildProcess;
    try {
      child = spawn(cmd, cmdArgs, spawnOptions);
    } catch {
      const next = remaining?.[0];
      if (next) {
        return trySpawn(next.command, next.args, remaining.slice(1));
      }
      return false;
    }

    child.on("error", () => {
      const next = remaining?.[0];
      if (next) {
        trySpawn(next.command, next.args, remaining.slice(1));
      }
    });

    child.unref();
    return true;
  }

  const success = trySpawn(command, args, fallbacks);
  return { attempted: true, success };
}
