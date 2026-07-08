import { BrowseCommand } from "../base.js";
import { resolveSession, sessionFlag } from "../lib/driver/flags.js";
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
    const resolved = await resolveSession(flags.session, "attach");
    const status = resolved.status ?? (await getDriverStatus(resolved.session));
    outputJson(
      status ?? {
        browserConnected: false,
        initialized: false,
        session: resolved.session,
      },
    );
  }
}
