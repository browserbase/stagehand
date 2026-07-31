import { Flags } from "@oclif/core";

import { BrowseCommand } from "../../base.js";
import {
  createBrowserbaseClient,
  withBrowserbaseApi,
} from "../../lib/cloud/api.js";
import { resolveContextRefOrFail } from "../../lib/cloud/contexts-resolve.js";
import { fail } from "../../lib/errors.js";
import { sessionFlag, sessionName } from "../../lib/driver/flags.js";
import { runDriverCommandWithTarget } from "../../lib/driver/runtime.js";
import type { RemoteConnectionTarget } from "../../lib/driver/types.js";
import { outputJson } from "../../lib/output.js";

export default class CookiesSync extends BrowseCommand {
  static override description =
    "Copy cookies from a debuggable local Chrome browser into a Browserbase session.";

  static override examples = [
    "browse cookies sync --domain github.com",
    "browse cookies sync --domain github.com --domain google.com --session work",
    "browse cookies sync --domain github.com --persist --session github",
    "browse cookies sync --domain github.com --context github --verified",
    "browse cookies sync --all --source-cdp 9222",
  ];

  static override flags = {
    all: Flags.boolean({
      description:
        "Sync every cookie from local Chrome. Required when --domain is omitted.",
      exclusive: ["domain"],
    }),
    context: Flags.string({
      description:
        "Existing Browserbase context ID or saved name. Changes are persisted.",
      helpValue: "<id|name>",
    }),
    domain: Flags.string({
      description:
        "Cookie domain to sync, including its subdomains. Repeat for multiple domains.",
      helpValue: "<domain>",
      multiple: true,
    }),
    persist: Flags.boolean({
      description:
        "Create a Browserbase context and persist the synced cookies for future sessions.",
    }),
    proxies: Flags.boolean({
      description: "Route the remote session through Browserbase proxies.",
    }),
    session: sessionFlag,
    "source-cdp": Flags.string({
      description:
        "Local Chrome CDP endpoint or port. Defaults to automatic discovery.",
      helpValue: "<url|port>",
    }),
    verified: Flags.boolean({
      description:
        "Use Browserbase Verified browser mode. Requires a Browserbase Scale plan.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CookiesSync);
    const domains = flags.domain ?? [];
    if (!flags.all && domains.length === 0) {
      fail("Pass at least one --domain, or explicitly pass --all.");
    }

    let contextId: string | undefined;
    if (flags.context) {
      contextId = await resolveContextRefOrFail(flags.context);
    } else if (flags.persist) {
      contextId = await withBrowserbaseApi("contexts", async () => {
        const context = await createBrowserbaseClient({}).contexts.create({});
        if (!context.id) fail("Browserbase created a context without an ID.");
        return context.id;
      });
    }

    const target: RemoteConnectionTarget = {
      kind: "remote",
      ...(contextId ? { contextId, persist: true } : {}),
      ...(flags.proxies ? { proxies: true } : {}),
      ...(flags.verified ? { verified: true } : {}),
    };
    const result = (await runDriverCommandWithTarget(
      sessionName(flags.session),
      target,
      "cookies.sync",
      {
        all: flags.all,
        domains,
        sourceCdp: flags["source-cdp"],
      },
    )) as Record<string, unknown>;

    outputJson({ ...result, ...(contextId ? { contextId } : {}) });
  }
}
