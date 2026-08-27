import { BrowseCommand } from "../base.js";
import { sessionFlag, sessionName } from "../lib/driver/flags.js";
import { getDriverStatus } from "../lib/driver/daemon/client.js";
import { outputJson } from "../lib/output.js";

export default class Status extends BrowseCommand {
  static override description =
    "Show the browse driver daemon status for a named session.";

  static override examples = [
    "browse status",
    "browse status --session research",
  ];

  static override flags = {
    session: sessionFlag,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const session = sessionName(flags.session);
    const status = await getDriverStatus(session);
    outputJson(
      status ?? { browserConnected: false, initialized: false, session },
    );
  }
}
