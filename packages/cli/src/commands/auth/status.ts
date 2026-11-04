import { BrowseCommand } from "../../base.js";
import { resolveCredential } from "../../lib/auth/credentials.js";
import { credentialPath, savedCredentialStore } from "../../lib/auth/store.js";
import { outputJson } from "../../lib/output.js";

export default class AuthStatus extends BrowseCommand {
  static override description =
    "Show local credential configuration without printing a key or making an API request.";
  async run(): Promise<void> {
    const store = savedCredentialStore();
    const active = resolveCredential();
    outputJson({
      configured: Boolean(active),
      source: active?.source ?? null,
      apiOrigin: active?.baseUrl ?? null,
      projectId: active?.projectId ?? null,
      savedLogin: Boolean(store),
      ...(store ? { storage: "os-keystore", path: credentialPath() } : {}),
      verified: false,
    });
  }
}
