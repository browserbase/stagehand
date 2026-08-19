import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { buildAcpFacadeEnv } from "../src/acp/env.js";
import { buildAcpFacadeMcpServer } from "../src/acp/facade-mcp.js";

const envFixture = fileURLToPath(new URL("./fixtures/record-env.mjs", import.meta.url));
const builtFacadeLauncher = fileURLToPath(
  new URL("../dist/acp/facade-launcher.mjs", import.meta.url),
);
const resolvedFacadeLauncher = fileURLToPath(
  new URL("../src/acp/facade-launcher.mjs", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("ACP facade MCP adapter", () => {
  it("allowlists only non-empty Stagehand and Browserbase values", () => {
    expect(
      buildAcpFacadeEnv({
        STAGEHAND_BROWSER: "local",
        BROWSERBASE_API_KEY: "bb-secret",
        STAGEHAND_EMPTY: "",
        XAI_API_KEY: "xai-secret",
        OTHER_SECRET: "hidden",
      }),
    ).toStrictEqual({
      STAGEHAND_BROWSER: "local",
      BROWSERBASE_API_KEY: "bb-secret",
    });
  });

  it("builds the exact Stagehand stdio MCP definition", () => {
    expect(
      buildAcpFacadeMcpServer("/absolute/facade.mjs", {
        STAGEHAND_BROWSER: "local",
        XAI_API_KEY: "not-forwarded",
      }),
    ).toStrictEqual({
      name: "stagehand",
      command: process.execPath,
      args: [resolvedFacadeLauncher, "/absolute/facade.mjs"],
      env: [{ name: "STAGEHAND_BROWSER", value: "local" }],
    });
  });

  it("enforces the allowlist in the actual facade runtime", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "stagehand-acp-env-test-"));
    temporaryDirectories.push(cwd);
    const recordPath = join(cwd, "env.json");
    const child = spawn(process.execPath, [builtFacadeLauncher, envFixture, recordPath], {
      env: {
        ...process.env,
        STAGEHAND_BROWSER: "local",
        BROWSERBASE_API_KEY: "bb-secret",
        XAI_API_KEY: "xai-secret",
        OTHER_SECRET: "hidden",
      },
      stdio: "ignore",
    });

    const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    expect({ code, signal }).toStrictEqual({ code: 0, signal: null });
    expect(JSON.parse(await readFile(recordPath, "utf8"))).toStrictEqual({
      STAGEHAND_BROWSER: "local",
      BROWSERBASE_API_KEY: "bb-secret",
    });
  });

  it.skipIf(process.platform === "win32")(
    "preserves signal termination from the facade process",
    async () => {
      const child = spawn(
        process.execPath,
        [builtFacadeLauncher, "-e", 'process.kill(process.pid, "SIGTERM")'],
        { stdio: "ignore" },
      );

      const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      expect({ code, signal }).toStrictEqual({ code: null, signal: "SIGTERM" });
    },
  );
});
