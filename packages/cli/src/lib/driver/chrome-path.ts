import fs from "node:fs";

const DEFAULT_CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

export function resolveChromeExecutablePath(options?: {
  explicit?: string;
  env?: string;
}): string | undefined {
  if (options?.explicit) {
    return fs.existsSync(options.explicit) ? options.explicit : undefined;
  }

  if (options?.env && fs.existsSync(options.env)) {
    return options.env;
  }

  for (const candidate of DEFAULT_CHROME_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}
