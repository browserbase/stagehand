import { sessionIdArg } from "../../../lib/cloud/args.js";
import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class SessionsDebug extends BrowseCommand {
  static override description =
    "Get live debugger URLs for a Browserbase session.";
  static override examples = ["browse cloud sessions debug <session-id>"];

  static override args = {
    id: sessionIdArg,
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionsDebug);
    await withBrowserbaseApi("sessions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(await client.sessions.debug(args.id));
    });
  }
}
