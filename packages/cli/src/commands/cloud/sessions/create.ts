import { Flags } from "@oclif/core";

import {
  createBrowserbaseClient,
  deepMerge,
  outputJson,
  resolveBody,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { fail } from "../../../lib/errors.js";
import { BrowseCommand } from "../../../base.js";

const REGIONS = [
  "us-west-2",
  "us-east-1",
  "eu-central-1",
  "ap-southeast-1",
] as const;

interface SessionCreateFlagInputs {
  proxies?: boolean;
  "advanced-stealth"?: boolean;
  verified?: boolean;
  "solve-captchas"?: boolean;
  "block-ads"?: boolean;
  region?: string;
  "keep-alive"?: boolean;
  timeout?: number;
  "context-id"?: string;
  persist?: boolean;
  "record-session"?: boolean;
  "log-session"?: boolean;
  viewport?: string;
  "extension-id"?: string;
}

function buildSessionCreateBody(
  flags: SessionCreateFlagInputs,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const browserSettings: Record<string, unknown> = {};

  if (flags.proxies) body.proxies = true;
  if (flags.region) body.region = flags.region;
  if (flags["keep-alive"]) body.keepAlive = true;
  if (flags.timeout !== undefined) body.timeout = flags.timeout;
  if (flags["extension-id"]) body.extensionId = flags["extension-id"];

  if (flags.verified || flags["advanced-stealth"])
    browserSettings.verified = true;
  if (flags["block-ads"]) browserSettings.blockAds = true;

  if (flags["solve-captchas"] !== undefined) {
    browserSettings.solveCaptchas = flags["solve-captchas"];
  }
  if (flags["record-session"] !== undefined) {
    browserSettings.recordSession = flags["record-session"];
  }
  if (flags["log-session"] !== undefined) {
    browserSettings.logSession = flags["log-session"];
  }

  if (flags.viewport) {
    const match = flags.viewport.match(/^(\d+)x(\d+)$/);
    if (!match)
      fail("Invalid viewport format. Use WIDTHxHEIGHT (e.g. 1920x1080).");
    const [, width, height] = match;
    browserSettings.viewport = {
      width: Number.parseInt(width!, 10),
      height: Number.parseInt(height!, 10),
    };
  }

  if (flags["context-id"] || flags.persist) {
    browserSettings.context = {
      ...(flags["context-id"] ? { id: flags["context-id"] } : {}),
      ...(flags.persist ? { persist: true } : {}),
    };
  }

  if (Object.keys(browserSettings).length > 0) {
    body.browserSettings = browserSettings;
  }

  return body;
}

export default class SessionsCreate extends BrowseCommand {
  static override description =
    "Create a new browser session. Use flags for common options, or --body/--stdin for the full API.";

  static override examples = [
    "browse cloud sessions create --proxies --verified",
    "browse cloud sessions create --region us-east-1 --timeout 300",
    "browse cloud sessions create --solve-captchas --context-id ctx_abc --persist",
    `browse cloud sessions create --body '{"keepAlive":true}'`,
    `echo '{"keepAlive":true,"proxies":true}' | browse cloud sessions create --stdin`,
  ];

  static override flags = {
    ...apiCommonFlags,
    body: Flags.string({
      description: "Optional JSON request body.",
      helpValue: "<body>",
    }),
    stdin: Flags.boolean({
      description: "Read JSON request body from stdin.",
    }),
    proxies: Flags.boolean({
      description: "Enable Browserbase proxy.",
    }),
    "advanced-stealth": Flags.boolean({
      hidden: true,
    }),
    verified: Flags.boolean({
      description: "Enable Browserbase Verified browser mode.",
    }),
    "solve-captchas": Flags.boolean({
      description:
        "Enable automatic CAPTCHA solving. Use --no-solve-captchas to disable.",
      allowNo: true,
    }),
    "block-ads": Flags.boolean({
      description: "Enable ad blocking.",
    }),
    region: Flags.string({
      description: `Session region. (choices: ${REGIONS.map((r) => `"${r}"`).join(", ")})`,
      options: [...REGIONS],
      helpValue: "<region>",
    }),
    "keep-alive": Flags.boolean({
      description: "Keep session alive after disconnection.",
    }),
    timeout: Flags.integer({
      description: "Session timeout in seconds.",
      helpValue: "<seconds>",
    }),
    "context-id": Flags.string({
      description: "Browserbase context ID for persistent state.",
      helpValue: "<id>",
    }),
    persist: Flags.boolean({
      description: "Persist context changes after session ends.",
    }),
    "record-session": Flags.boolean({
      description:
        "Enable session recording. Use --no-record-session to disable.",
      allowNo: true,
    }),
    "log-session": Flags.boolean({
      description: "Enable session logging. Use --no-log-session to disable.",
      allowNo: true,
    }),
    viewport: Flags.string({
      description: "Browser viewport dimensions (e.g. 1920x1080).",
      helpValue: "<WxH>",
    }),
    "extension-id": Flags.string({
      description: "Chrome extension ID to load.",
      helpValue: "<id>",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SessionsCreate);
    await withBrowserbaseApi("sessions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      const jsonBody = await resolveBody({
        body: flags.body,
        stdin: flags.stdin,
      });
      const flagBody = buildSessionCreateBody(flags);
      const body = deepMerge(jsonBody, flagBody);
      outputJson(await client.sessions.create(body));
    });
  }
}
