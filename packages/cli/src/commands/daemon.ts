import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import { runDriverDaemon } from "../lib/driver/daemon/server.js";
import { sessionName } from "../lib/driver/flags.js";
import type { ConnectionTarget } from "../lib/driver/types.js";

export default class Daemon extends BrowseCommand {
  static override description = "Run the private browse driver daemon.";
  static override hidden = true;

  static override flags = {
    session: Flags.string({
      required: true,
      description: "Named browser session.",
    }),
    target: Flags.string({
      required: true,
      description: "Serialized driver connection target.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Daemon);
    await runDriverDaemon({
      session: sessionName(flags.session),
      target: JSON.parse(flags.target) as ConnectionTarget,
    });
  }
}
