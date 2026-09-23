import { afterEach, describe, expect, it } from "vitest";
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
let server: FakeBrowserbaseServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe.each([
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
    `${secretId}\n`,
  ])(
    "rejects %j before reading a secret or making a request",
    async (invalidId) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 200, {}),
      );
      const args = [...ids];
      args[index] = invalidId;
      const result = await runCli(
        [...command, ...args, "--base-url", server.baseUrl],
        { env },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("ID must be a UUID");
      expect(result.stdout).toBe("");
      expect(server.requests).toHaveLength(0);
    },
  );
});
