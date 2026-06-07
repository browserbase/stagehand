import { Flags } from "@oclif/core";

export const sessionFlag = Flags.string({
  char: "s",
  description:
    "Named browser session to use. Defaults to BROWSE_SESSION or default.",
  helpValue: "<name>",
});

export const headedFlag = Flags.boolean({
  description: "Show a visible browser window for managed local sessions.",
});

export const headlessFlag = Flags.boolean({
  description: "Run managed local sessions in headless mode.",
});

export const localFlag = Flags.boolean({
  description: "Use a managed local browser session.",
});

export const remoteFlag = Flags.boolean({
  description: "Use a remote Browserbase browser session.",
});

export const autoConnectFlag = Flags.boolean({
  description:
    "Auto-discover and attach to a local browser with remote debugging enabled.",
});

export const cdpFlag = Flags.string({
  description:
    "Attach directly to a CDP endpoint. Accepts a port, http(s) URL, or ws(s) URL.",
  helpValue: "<url|port>",
});

export const targetIdFlag = Flags.string({
  description:
    "Select a specific CDP target when attaching to an existing browser.",
  helpValue: "<target-id>",
});

export const chromePathFlag = Flags.string({
  description:
    "Path to the Chrome or Chromium executable for managed local sessions. Falls back to CHROME_PATH.",
  helpValue: "<path>",
});

export const connectTimeoutFlag = Flags.integer({
  description:
    "Timeout in milliseconds when launching or connecting to a managed local browser.",
  helpValue: "<ms>",
});

export const chromeArgFlag = Flags.string({
  description:
    "Extra Chromium flag for managed local sessions. Repeat for multiple flags.",
  helpValue: "<flag>",
  multiple: true,
});

export function sessionName(value?: string): string {
  return value ?? process.env.BROWSE_SESSION ?? "default";
}
