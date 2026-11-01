import { sessionIdArg } from "../../../lib/cloud/args.js";
import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";

export default class SessionsGet extends BrowseCommand {
  static override description = "Get a Browserbase session by ID.";
  static override examples = ["browse cloud sessions get <session-id>"];

  static override args = {
    id: sessionIdArg,
  };

  static override flags = { ...apiCommonFlags };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SessionsGet);
    await withBrowserbaseApi("sessions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      outputJson(await client.sessions.retrieve(args.id));
    });
  }
}
