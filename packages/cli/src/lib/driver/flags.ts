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
