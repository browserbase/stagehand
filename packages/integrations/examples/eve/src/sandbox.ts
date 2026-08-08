import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

export const PROPOSED_STAGEHAND_CODEMODE_IMAGE = "ghcr.io/browserbase/stagehand-codemode";

const GUEST_GATEWAY_PATH = "/tmp/stagehand-eve-gateway/gateway.mjs";
const GUEST_GATEWAY_SOURCE = new URL("./sandbox-guest.mjs", import.meta.url);

type GuestEnvironment = Partial<
  Record<
    | "BROWSERBASE_API_KEY"
    | "BROWSERBASE_PROJECT_ID"
    | "STAGEHAND_BROWSER"
    | "STAGEHAND_MODEL_API_KEY"
    | "STAGEHAND_MODEL_NAME",
    string
  >
>;

export type SandboxProcess = {
  wait: () => Promise<{ exitCode: number }>;
  kill: (signal: "SIGTERM" | "SIGKILL") => Promise<void>;
};

export type SandboxInstance = {
  /**
   * Command for the Stagehand stdio server inside this sandbox. A provider can
   * materialize the OCI image as the sandbox rootfs, or return a nested
   * container-runtime command such as `docker run --rm -i <image>@<digest>`.
   */
  stdioCommand: { command: string; args: string[] };
  publicUrl: (port: number) => Promise<string>;
  writeTextFile: (path: string, contents: string) => Promise<void>;
  spawn: (options: {
    command: string;
    args: string[];
    env: Record<string, string>;
  }) => Promise<SandboxProcess>;
  close: () => Promise<void>;
};

export type SandboxProvider = {
  create: (options: {
    stdioImage: string;
    exposedPorts: number[];
    timeoutMs: number;
  }) => Promise<SandboxInstance>;
};

export async function createStagehandSandboxGateway(
  provider: SandboxProvider,
  options: {
    image?: string;
    timeoutMs?: number;
    environment?: GuestEnvironment;
  } = {},
): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  const port = 3000;
  const token = randomBytes(32).toString("hex");
  const sandbox = await provider.create({
    stdioImage: options.image ?? PROPOSED_STAGEHAND_CODEMODE_IMAGE,
    exposedPorts: [port],
    timeoutMs: options.timeoutMs ?? 15 * 60_000,
  });

  try {
    await sandbox.writeTextFile(GUEST_GATEWAY_PATH, await readFile(GUEST_GATEWAY_SOURCE, "utf8"));
    const process = await sandbox.spawn({
      command: "/bin/sh",
      args: [
        "-lc",
        [
          "set -eu",
          "cd /tmp/stagehand-eve-gateway",
          "npm init -y >/dev/null 2>&1",
          "npm install --ignore-scripts --no-audit --no-fund supergateway@3.4.3 >/dev/null 2>&1",
          `exec node ${GUEST_GATEWAY_PATH}`,
        ].join("\n"),
      ],
      env: {
        ...options.environment,
        STAGEHAND_GATEWAY_PORT: String(port),
        STAGEHAND_GATEWAY_TOKEN: token,
        STAGEHAND_STDIO_COMMAND_JSON: JSON.stringify(sandbox.stdioCommand),
      },
    });
    const baseUrl = (await sandbox.publicUrl(port)).replace(/\/$/, "");
    await waitForGateway(baseUrl, token);
    const url = `${baseUrl}/mcp`;

    return {
      url,
      token,
      async close() {
        await process.kill("SIGTERM").catch(() => undefined);
        const stopped = await Promise.race([
          process.wait().then(() => true),
          new Promise<false>((resolve) => setTimeout(() => resolve(false), 3_000)),
        ]);
        if (!stopped) await process.kill("SIGKILL").catch(() => undefined);
        await sandbox.close();
      },
    };
  } catch (error) {
    await sandbox.close().catch(() => undefined);
    throw error;
  }
}

async function waitForGateway(baseUrl: string, token: string): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const response = await fetch(`${baseUrl}/healthz`, {
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the sandboxed Stagehand gateway did not become healthy");
}
