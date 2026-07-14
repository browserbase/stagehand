import { Flags } from "@oclif/core";

export const sessionFlag = Flags.string({
  char: "s",
  description:
    "Named browser session to use. Defaults to BROWSE_SESSION or default.",
  helpValue: "<name>",
});

export const headedFlag = Flags.boolean({
  description:
    "Show a visible browser window for managed local sessions. Managed local sessions default to headed when run interactively with a display; headless otherwise. Use --headless/--headed to force.",
});

export const headlessFlag = Flags.boolean({
  description:
    "Run managed local sessions in headless mode. Managed local sessions default to headed when run interactively with a display; headless otherwise. Use --headless/--headed to force.",
});

export const localFlag = Flags.boolean({
  description: "Use a managed local browser session.",
});

export const remoteFlag = Flags.boolean({
  description: "Use a remote Browserbase browser session.",
});

export const verifiedFlag = Flags.boolean({
  description:
    "Open the remote session as a Verified (advanced-stealth) browser. Requires --remote and a Browserbase Scale plan.",
});

export const proxiesFlag = Flags.boolean({
  description:
    "Route the remote session through Browserbase proxies. Requires --remote.",
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

export const chromeArgFlag = Flags.string({
  description:
    "Add a Chrome launch arg for managed local sessions. Repeatable.",
  helpValue: "<flag>",
  multiple: true,
});

export const ignoreDefaultChromeArgFlag = Flags.string({
  description:
    "Drop one of Chrome's default launch args for managed local sessions. Repeatable.",
  helpValue: "<flag>",
  multiple: true,
});

export const noDefaultChromeArgsFlag = Flags.boolean({
  description:
    "Launch managed local Chrome without any of its default launch args.",
});

export function sessionName(value?: string): string {
  return value ?? process.env.BROWSE_SESSION ?? "default";
}
