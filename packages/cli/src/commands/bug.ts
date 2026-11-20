import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import { detectAgent } from "../lib/agent.js";
import { getCliVersion } from "../lib/identity.js";
import { openUrl } from "../lib/open-url.js";

const GITHUB_ISSUES_URL = "https://github.com/browserbase/stagehand/issues/new";

export default class Bug extends BrowseCommand {
  static override description =
    "Open a prefilled GitHub issue in your system browser (not a browse session).";

  static override examples = [
    "browse bug",
    "browse bug --no-open",
    "browse bug --title 'Crash on snapshot'",
  ];

  static override flags = {
    "no-open": Flags.boolean({
      description: "Print the issue URL without opening a browser.",
    }),
    title: Flags.string({
      description: "Prefill the issue title.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Bug);
    const noOpen = flags["no-open"];
    const title = flags.title ?? "";

    const agent = await detectAgent();

    const body = `## What happened

<!-- Describe the issue -->

## Steps to reproduce

1. 
2. 
3. 

## Environment

| Key | Value |
|-----|-------|
| browse | ${getCliVersion()} |
| node | ${process.version} |
| os | ${process.platform}/${process.arch} |
| agent | ${agent ?? "none"} |
`;

    const params = new URLSearchParams();
    if (title) params.set("title", title);
    params.set("body", body);

    const url = `${GITHUB_ISSUES_URL}?${params.toString()}`;

    const result = openUrl(url, { noOpen });

    if (result.attempted && result.success) {
      this.log(`Opening ${url}`);
    } else {
      this.log(url);
    }

    this.log("Please fill in the details to help us reproduce the issue.");
  }
}
