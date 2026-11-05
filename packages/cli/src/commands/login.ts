import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stripVTControlCharacters } from "node:util";
import { Flags } from "@oclif/core";

import { BrowseCommand } from "../base.js";
import { login, readLoginJson, type LoginProject } from "../lib/auth/login.js";
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
      options: ["auto", "keychain", "file"],
      default: "auto",
      description:
        "Prefer the OS keystore with a private plaintext fallback (auto), require the keystore, or use a file.",
    }),
    "project-id": Flags.string({
      description: "Choose the project whose API key should be saved.",
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
    const store = flags["credential-store"] as CredentialStore | "auto";
    requireSupportedCredentialStore(store);
    this.log(
      store === "auto"
        ? "This saves the selected project's API key in your OS keystore, or a private plaintext file if the keystore is unavailable."
        : store === "file"
          ? `This saves the selected project's API key as plaintext in a private file: ${credentialPath()}`
          : "This saves the selected project's API key in your OS keystore.",
    );
    this.log(
      "Authorize access to your permitted project API keys, then choose one project to use here.",
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
        projectId: flags["project-id"],
        chooseProject,
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
        if (controller.signal.aborted) fail("Login canceled; no credential was saved.");
        const request = credentialFetch({
          ...credential,
          baseUrl: credential.apiOrigin,
          source: "saved",
        });
        const response = await request(
          `${credential.apiOrigin}/v1/projects/${encodeURIComponent(credential.projectId)}`,
          {
            headers: { "x-bb-api-key": credential.apiKey },
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          },
        ).catch(() =>
          fail(
            controller.signal.aborted
              ? "Login canceled; no credential was saved."
              : "Login project verification failed; no credential was saved.",
          ),
        );
        if (controller.signal.aborted) fail("Login canceled; no credential was saved.");
        if (!response.ok)
          fail(
            `Login project verification failed (HTTP ${response.status}); no credential was saved.`,
          );
        const result = (await readLoginJson(response)) as { id?: unknown } | null;
        if (result?.id !== credential.projectId)
          fail("Login project verification failed; no credential was saved.");
        if (controller.signal.aborted) fail("Login canceled; no credential was saved.");
        const savedStore = writeCredential(credential, process.env, store);
        if (savedStore === "file") {
          this.log(`API key saved as plaintext in a private file: ${credentialPath()}`);
        }
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
    const child = spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function chooseProject(projects: LoginProject[], signal: AbortSignal): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    fail("Use --project-id to select a project when running without an interactive terminal.");
  }
  const label = (value: string) =>
    stripVTControlCharacters(value)
      .replace(/\p{Cc}/gu, "")
      .slice(0, 120);
  projects.forEach((project, index) =>
    process.stderr.write(
      `${index + 1}. ${label(project.organizationName)} / ${label(project.name)} (${project.id})\n`,
    ),
  );
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await prompt.question("Project number: ", { signal });
    const index = Number(answer.trim()) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= projects.length)
      fail("Invalid project selection. Run browse login again.");
    return projects[index]!.id;
  } finally {
    prompt.close();
  }
}
