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
    startupTimeoutMs?: number;
    timeoutMs?: number;
    environment?: GuestEnvironment;
  } = {},
): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  const port = 3000;
  const token = randomBytes(32).toString("hex");
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const startupTimeoutMs = Math.min(options.startupTimeoutMs ?? 2 * 60_000, timeoutMs - 1_000);
  if (startupTimeoutMs <= 0) {
    throw new Error("the sandbox timeout must leave at least one second for gateway startup");
  }
  const sandbox = await provider.create({
    stdioImage: options.image ?? PROPOSED_STAGEHAND_CODEMODE_IMAGE,
    exposedPorts: [port],
    timeoutMs,
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
    await waitForGateway(baseUrl, token, startupTimeoutMs);
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

async function waitForGateway(
  baseUrl: string,
  token: string,
  startupTimeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/healthz`, {
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("the sandboxed Stagehand gateway did not become healthy");
}
