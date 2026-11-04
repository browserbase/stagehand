import { spawn } from "node:child_process";
import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import { login, readLoginJson } from "../lib/auth/login.js";
import { credentialFetch } from "../lib/auth/credentials.js";
import {
  credentialPath,
  requireSupportedCredentialStore,
  writeCredential,
  type CredentialStore,
} from "../lib/auth/store.js";
import { fail } from "../lib/errors.js";

export default class Login extends BrowseCommand {
  static override description =
    "Sign in through your browser and save a project API key on this computer.";
  static override examples = ["browse login", "browse login --no-browser"];
  static override flags = {
    "credential-store": Flags.string({
      options: ["keychain", "file"],
      default: "keychain",
      description:
        "Save in the OS keystore (default), or explicitly opt into a private plaintext file.",
    }),
    "no-browser": Flags.boolean({ description: "Print the login URL without opening a browser." }),
    development: Flags.boolean({
      description: "Use the development dashboard and API.",
      hidden: true,
    }),
    dashboard: Flags.string({ description: "Development dashboard origin.", hidden: true }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Login);
    const store = flags["credential-store"] as CredentialStore;
    requireSupportedCredentialStore(store);
    this.log(
      store === "file"
        ? `This saves the selected project's API key as plaintext in a private file: ${credentialPath()}`
        : "This saves the selected project's API key in your OS keystore.",
    );
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    try {
      const credential = await login({
        dashboard: flags.dashboard,
        development: flags.development,
        signal: controller.signal,
        openBrowser: async (url) => {
          this.log(`Authorize in browser: ${url}`);
          if (!flags["no-browser"]) {
            await openBrowser(url).catch(() =>
              this.log("Open the URL above in a browser on this computer."),
            );
          }
        },
      });
      try {
        const request = credentialFetch({
          ...credential,
          baseUrl: credential.apiOrigin,
          source: "saved",
        });
        const response = await request(
          `${credential.apiOrigin}/v1/projects/${encodeURIComponent(credential.projectId)}`,
          {
            headers: { "x-bb-api-key": credential.apiKey },
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!response.ok)
          fail(
            `Login project verification failed (HTTP ${response.status}); no credential was saved.`,
          );
        const result = (await readLoginJson(response)) as { id?: unknown } | null;
        if (result?.id !== credential.projectId)
          fail("Login project verification failed; no credential was saved.");
        writeCredential(credential, process.env, store);
        this.log("Signed in. Run browse auth status to inspect your saved login.");
        this.log(
          "Existing browser sessions keep their original credentials. Run browse stop (with --session NAME for named sessions) before switching projects.",
        );
        if (process.env.BROWSERBASE_API_KEY)
          this.log("BROWSERBASE_API_KEY is set and takes precedence over your saved login.");
      } finally {
        credential.apiKey = "";
      }
    } finally {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  }
}

async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32.exe"
        : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error("Browser opener failed.")),
    );
  });
}
