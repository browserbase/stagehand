import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  jsonResponse,
  startFakeBrowserbaseServer,
  type FakeBrowserbaseServer,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

const functionId = "ab76f718-0c41-4130-8b02-c926721801fc";
const secretId = "d2c4f48f-38e9-4b82-a36a-2b373fd14a65";
const env = {
  BROWSERBASE_API_KEY: "test-key",
  BROWSE_LOAD_DOTENV: "0",
  BROWSERBASE_TELEMETRY_DISABLED: "1",
};
let configDir: string;
let server: FakeBrowserbaseServer | undefined;
beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "browse-id-validation-"));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(configDir, { recursive: true, force: true });
});

describe.each([
  ...["get", "usage"].map((action) => ({
    command: ["cloud", "projects", action],
    ids: [secretId],
    index: 0,
  })),
  ...["get", "update", "debug", "logs"].map((action) => ({
    command: ["cloud", "sessions", action],
    ids: [secretId],
    index: 0,
  })),
  {
    command: ["cloud", "sessions", "downloads", "get"],
    ids: [secretId],
    index: 0,
  },
  {
    command: ["cloud", "sessions", "uploads", "create"],
    ids: [secretId, "missing-upload.txt"],
    index: 0,
  },
  ...["get", "delete"].map((action) => ({
    command: ["cloud", "extensions", action],
    ids: [secretId],
    index: 0,
  })),
  ...["get", "delete"].map((action) => ({
    command: ["cloud", "contexts", action],
    ids: [secretId],
    index: 0,
  })),
  {
    command: ["cloud", "sessions", "create"],
    ids: ["--context-id", secretId],
    index: 1,
  },
  {
    command: ["cloud", "sessions", "create"],
    ids: ["--extension-id", secretId],
    index: 1,
  },
  {
    command: ["functions", "invoke"],
    ids: [functionId, "--no-wait"],
    index: 0,
  },
  {
    command: ["functions", "invoke"],
    ids: [functionId, "--check-status", secretId, "--no-wait"],
    index: 2,
  },
  { command: ["cloud", "secrets", "get"], ids: [secretId], index: 0 },
  { command: ["cloud", "secrets", "delete"], ids: [secretId], index: 0 },
  { command: ["cloud", "secrets", "update"], ids: [secretId], index: 0 },
  { command: ["functions", "secrets", "list"], ids: [functionId], index: 0 },
  {
    command: ["functions", "secrets", "attach"],
    ids: [functionId, secretId],
    index: 0,
  },
  {
    command: ["functions", "secrets", "attach"],
    ids: [functionId, secretId],
    index: 1,
  },
  {
    command: ["functions", "secrets", "detach"],
    ids: [functionId, secretId],
    index: 0,
  },
  {
    command: ["functions", "secrets", "detach"],
    ids: [functionId, secretId],
    index: 1,
  },
])("$command ID argument $index", ({ command, ids, index }) => {
  it.each([
    "",
    "keypair",
    ".",
    "..",
    "not-a-uuid",
    "id/with?query#fragment",
    "../../projects#",
    `${secretId}\n`,
  ])(
    "rejects %j before reading input or making a request",
    async (invalidId) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 200, {}),
      );
      const args = [...ids];
      args[index] = invalidId;
      const result = await runCli([...command, ...args], {
        cwd: configDir,
        env: {
          ...env,
          BROWSERBASE_CONFIG_DIR: configDir,
          BROWSERBASE_BASE_URL: server.baseUrl,
        },
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("ID must be a UUID");
      expect(result.stdout).toBe("");
      expect(server.requests).toHaveLength(0);
    },
  );
});
