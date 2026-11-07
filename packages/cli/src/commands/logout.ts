import { BrowseCommand } from "../base.js";
import { removeCredential } from "../lib/auth/store.js";

export default class Logout extends BrowseCommand {
  static override description =
    "Remove this computer's saved login. The project API key is not revoked.";
  async run(): Promise<void> {
    this.log(removeCredential() ? "Saved login removed." : "No saved login found.");
    this.log(
      "Existing browser sessions and API keys remain active. Revoke or rotate the key in the dashboard if needed.",
    );
    if (process.env.BROWSERBASE_API_KEY)
      this.log("BROWSERBASE_API_KEY is still set and remains available to commands.");
  }
}
