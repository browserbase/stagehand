import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CHROME_NOT_FOUND_MESSAGE =
  "No supported local browser installation was found. Stagehand supports Chrome Stable, Beta, Dev, Canary, and Chromium. Set browser.executablePath or CHROME_PATH to use a custom executable.";

const MAC_APPLICATIONS = [
  ["Google Chrome.app", "Google Chrome"],
  ["Google Chrome Beta.app", "Google Chrome Beta"],
  ["Google Chrome Dev.app", "Google Chrome Dev"],
  ["Google Chrome Canary.app", "Google Chrome Canary"],
  ["Chromium.app", "Chromium"],
] as const;

const WINDOWS_APPLICATIONS = [
  ["Google", "Chrome"],
  ["Google", "Chrome Beta"],
  ["Google", "Chrome Dev"],
  ["Google", "Chrome SxS"],
  ["Chromium"],
] as const;

const LINUX_EXECUTABLES = [
  "google-chrome-stable",
  "google-chrome",
  "google-chrome-beta",
  "google-chrome-unstable",
  "chromium-browser",
  "chromium",
] as const;

const CHANNEL_ORDER = ["stable", "beta", "dev", "canary", "chromium", "unknown"] as const;

type ChromeChannel = (typeof CHANNEL_ORDER)[number];

export type ChromeExecutableResolverOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  isExecutable?: (candidate: string) => boolean;
  legacyInstallations?: () => readonly string[];
};

export function chromeExecutableCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDirectory: string,
): string[] {
  if (platform === "darwin") {
    const applicationDirectories = [
      "/Applications",
      path.posix.join(homeDirectory, "Applications"),
    ];
    return MAC_APPLICATIONS.flatMap(([bundle, executable]) =>
      applicationDirectories.map((directory) =>
        path.posix.join(directory, bundle, "Contents", "MacOS", executable),
      ),
    );
  }

  if (platform === "win32") {
    const roots = [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]].filter(
      (root): root is string => root !== undefined && root.length > 0,
    );
    return WINDOWS_APPLICATIONS.flatMap((segments) =>
      roots.map((root) => path.win32.join(root, ...segments, "Application", "chrome.exe")),
    );
  }

  const pathDirectories = (env.PATH ?? "").split(":").filter(Boolean);
  return LINUX_EXECUTABLES.flatMap((executable) =>
    pathDirectories.map((directory) => path.posix.join(directory, executable)),
  );
}

export function findChromeExecutable(options: ChromeExecutableResolverOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const isExecutable = options.isExecutable ?? canExecute;

  const configuredPath = env.CHROME_PATH;
  if (configuredPath !== undefined && isExecutable(configuredPath)) {
    return configuredPath;
  }

  const candidates = chromeExecutableCandidates(platform, env, homeDirectory);
  if (options.legacyInstallations !== undefined) {
    try {
      candidates.push(...options.legacyInstallations());
    } catch {
      // Stagehand reports its own actionable error if neither discovery strategy succeeds.
    }
  }

  const candidate = orderChromeExecutableCandidates(candidates).find(isExecutable);
  if (candidate !== undefined) {
    return candidate;
  }

  throw new Error(CHROME_NOT_FOUND_MESSAGE);
}

function orderChromeExecutableCandidates(candidates: readonly string[]): string[] {
  const uniqueCandidates = [...new Set(candidates)];
  return CHANNEL_ORDER.flatMap((channel) =>
    uniqueCandidates.filter((candidate) => chromeChannel(candidate) === channel),
  );
}

function chromeChannel(candidate: string): ChromeChannel {
  const normalized = candidate.toLowerCase().replaceAll("\\", "/");
  const executable = path.posix.basename(normalized);
  if (executable.includes("chromium") || normalized.includes("/chromium/")) return "chromium";
  if (executable.includes("canary") || normalized.includes("/chrome sxs/")) return "canary";
  if (executable.includes("beta") || normalized.includes("/chrome beta/")) return "beta";
  if (
    executable.includes(" dev") ||
    executable.includes("unstable") ||
    normalized.includes("/chrome dev/")
  ) {
    return "dev";
  }
  if (executable.includes("chrome")) return "stable";
  return "unknown";
}

function canExecute(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}
