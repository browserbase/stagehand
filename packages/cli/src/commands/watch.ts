import { Args, Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import {
  driverCommandFlags,
  resolveTargetForCommand,
  timeoutMsFlag,
  type DriverFlags,
} from "../lib/driver/command-cli.js";
import { sessionName } from "../lib/driver/flags.js";
import { runDriverCommandWithTarget } from "../lib/driver/runtime.js";
import { createStringMatcher, pollWatch } from "../lib/driver/watch.js";
import { fail } from "../lib/errors.js";
import { outputJson } from "../lib/output.js";

type WatchKind = "checked" | "text" | "url" | "visible";

export default class Watch extends BrowseCommand {
  static override description =
    "Poll until text, URL, or selector state matches.";

  static override examples = [
    "browse watch text 'Order confirmed'",
    "browse watch text 'Order #\\d+' --regex",
    "browse watch text 'Thanks' --selector main",
    "browse watch url '/checkout'",
    "browse watch visible '#submit'",
    "browse watch checked '#terms' --timeout 60000",
  ];

  static override args = {
    kind: Args.string({
      description: "Condition kind to watch.",
      options: ["text", "url", "visible", "checked"],
      required: true,
    }),
    target: Args.string({
      description:
        "Text/URL query for text|url, or selector for visible|checked.",
      required: true,
    }),
  };

  static override flags = {
    ...driverCommandFlags,
    interval: Flags.integer({
      default: 500,
      description: "Polling interval in milliseconds.",
      helpValue: "<ms>",
    }),
    regex: Flags.boolean({
      default: false,
      description: "Treat text/url target as a regular expression.",
    }),
    selector: Flags.string({
      description: "Optional selector to scope text checks (defaults to body).",
      helpValue: "<selector>",
    }),
    timeout: timeoutMsFlag,
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Watch);
    const kind = args.kind as WatchKind;

    if (flags.interval <= 0) {
      fail("--interval must be a positive integer.");
    }

    if ((kind === "visible" || kind === "checked") && flags.regex) {
      fail("--regex is only valid for text and url watch kinds.");
    }

    if ((kind === "visible" || kind === "checked") && flags.selector) {
      fail("--selector is only valid for text watch kind.");
    }

    const session = sessionName((flags as DriverFlags).session);
    const target = await resolveTargetForCommand(session, flags as DriverFlags);
    const query = args.target;
    const matcher = createStringMatcher(query, flags.regex);

    try {
      const result = await pollWatch({
        check: async () =>
          checkCondition({
            kind,
            matcher,
            query,
            selector: flags.selector,
            session,
            target,
          }),
        intervalMs: flags.interval,
        timeoutMs: flags.timeout,
      });

      outputJson({
        attempts: result.attempts,
        elapsedMs: result.elapsedMs,
        kind,
        matched: true,
        session,
        value: result.value,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(`watch ${kind} failed: ${message}`);
    }
  }
}

async function checkCondition(options: {
  kind: WatchKind;
  matcher: (value: string) => boolean;
  query: string;
  selector?: string;
  session: string;
  target: Awaited<ReturnType<typeof resolveTargetForCommand>>;
}): Promise<{ matched: boolean; value?: string }> {
  if (options.kind === "visible" || options.kind === "checked") {
    const key = options.kind;
    const result = (await runDriverCommandWithTarget(
      options.session,
      options.target,
      "is",
      { check: key, selector: options.query },
    )) as { checked?: boolean; visible?: boolean };
    const boolValue = key === "visible" ? result.visible : result.checked;
    return { matched: Boolean(boolValue), value: String(boolValue) };
  }

  if (options.kind === "url") {
    const result = (await runDriverCommandWithTarget(
      options.session,
      options.target,
      "get",
      { what: "url" },
    )) as { url?: string };
    const value = result.url ?? "";
    return { matched: options.matcher(value), value };
  }

  const result = (await runDriverCommandWithTarget(
    options.session,
    options.target,
    "get",
    { selector: options.selector ?? "body", what: "text" },
  )) as { text?: string };
  const value = result.text ?? "";
  return { matched: options.matcher(value), value };
}
