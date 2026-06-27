import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type CapturedRequest,
  jsonResponse,
  startFakeBrowserbaseServer,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

const CONTEXT_ID = "ctx_real_1";

let configDir: string;

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), "browse-named-ctx-"));
});

afterEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

function pathOf(request: CapturedRequest): string {
  return request.path.split("?")[0] ?? request.path;
}

/**
 * Drives the real built CLI through the full named-context lifecycle against a
 * fake Browserbase server, proving the local name->id map is written on create
 * and resolved by list / get / sessions-create / delete.
 */
describe("named contexts (end to end through the CLI)", () => {
  it("creates by name, resolves the name everywhere, and prunes on delete", async () => {
    const server = await startFakeBrowserbaseServer((request, response) => {
      const path = pathOf(request);
      if (request.method === "POST" && path === "/v1/contexts") {
        jsonResponse(response, 200, {
          id: CONTEXT_ID,
          uploadUrl: "https://upload",
        });
        return;
      }
      if (request.method === "GET" && path === `/v1/contexts/${CONTEXT_ID}`) {
        jsonResponse(response, 200, { id: CONTEXT_ID, status: "ready" });
        return;
      }
      if (
        request.method === "DELETE" &&
        path === `/v1/contexts/${CONTEXT_ID}`
      ) {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method === "POST" && path === "/v1/sessions") {
        jsonResponse(response, 200, { id: "sess_1" });
        return;
      }
      jsonResponse(response, 200, {});
    });

    const env = {
      BROWSERBASE_CONFIG_DIR: configDir,
      BROWSERBASE_API_KEY: "test-key",
      BROWSERBASE_BASE_URL: server.baseUrl,
    };
    const storePath = join(configDir, "contexts.json");

    try {
      // 1. create --name writes the local alias and echoes the name back.
      const created = await runCli(
        ["cloud", "contexts", "create", "--name", "github"],
        { env },
      );
      expect(created.exitCode).toBe(0);
      expect(JSON.parse(created.stdout)).toMatchObject({
        id: CONTEXT_ID,
        name: "github",
      });
      expect(JSON.parse(await readFile(storePath, "utf8"))).toMatchObject({
        contexts: { github: { id: CONTEXT_ID } },
      });

      // 2. list --json surfaces the saved alias.
      const listed = await runCli(["cloud", "contexts", "list", "--json"], {
        env,
      });
      expect(listed.exitCode).toBe(0);
      expect(JSON.parse(listed.stdout)).toEqual({
        contexts: [expect.objectContaining({ name: "github", id: CONTEXT_ID })],
      });

      // 3. sessions create --context-id <name> sends the resolved id.
      const session = await runCli(
        ["cloud", "sessions", "create", "--context-id", "github", "--persist"],
        { env },
      );
      expect(session.exitCode).toBe(0);
      const sessionRequest = server.requests.find(
        (r) => r.method === "POST" && pathOf(r) === "/v1/sessions",
      );
      expect(sessionRequest?.jsonBody).toMatchObject({
        browserSettings: { context: { id: CONTEXT_ID, persist: true } },
      });

      // 4. get <name> resolves to GET /v1/contexts/<id>.
      const got = await runCli(["cloud", "contexts", "get", "github"], { env });
      expect(got.exitCode).toBe(0);
      expect(
        server.requests.some(
          (r) =>
            r.method === "GET" && pathOf(r) === `/v1/contexts/${CONTEXT_ID}`,
        ),
      ).toBe(true);

      // 5. delete <name> hits the API and prunes the local alias.
      const deleted = await runCli(["cloud", "contexts", "delete", "github"], {
        env,
      });
      expect(deleted.exitCode).toBe(0);
      expect(JSON.parse(deleted.stdout)).toMatchObject({
        ok: true,
        id: CONTEXT_ID,
        removedAliases: ["github"],
      });
      expect(JSON.parse(await readFile(storePath, "utf8")).contexts).toEqual(
        {},
      );
    } finally {
      await server.close();
    }
  });

  it("fails with a did-you-mean hint for a typo'd name, without calling the API", async () => {
    const server = await startFakeBrowserbaseServer((request, response) => {
      if (request.method === "POST" && pathOf(request) === "/v1/contexts") {
        jsonResponse(response, 200, { id: CONTEXT_ID });
        return;
      }
      jsonResponse(response, 200, {});
    });
    const env = {
      BROWSERBASE_CONFIG_DIR: configDir,
      BROWSERBASE_API_KEY: "test-key",
      BROWSERBASE_BASE_URL: server.baseUrl,
    };
    try {
      await runCli(["cloud", "contexts", "create", "--name", "github"], {
        env,
      });

      const result = await runCli(["cloud", "contexts", "get", "githubb"], {
        env,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No saved context named "githubb"');
      expect(result.stderr).toContain("Did you mean: github");
      // The typo never reached the API as a bogus id.
      expect(server.requests.some((r) => r.method === "GET")).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("passes an unrecognized raw id through to the API (raw-id compatibility)", async () => {
    const rawId = "legacy-id-not-a-uuid-9000";
    const server = await startFakeBrowserbaseServer((request, response) => {
      jsonResponse(response, 200, { id: rawId });
    });
    const env = {
      BROWSERBASE_CONFIG_DIR: configDir,
      BROWSERBASE_API_KEY: "test-key",
      BROWSERBASE_BASE_URL: server.baseUrl,
    };
    try {
      // A saved name exists, but the ref is far from it -> no "did you mean",
      // so the ref must pass through unchanged rather than being rejected.
      await runCli(["cloud", "contexts", "create", "--name", "github"], {
        env,
      });
      const got = await runCli(["cloud", "contexts", "get", rawId], { env });

      expect(got.exitCode).toBe(0);
      expect(
        server.requests.some(
          (r) => r.method === "GET" && pathOf(r) === `/v1/contexts/${rawId}`,
        ),
      ).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("rejects an invalid context name without calling the API", async () => {
    const server = await startFakeBrowserbaseServer((_request, response) => {
      jsonResponse(response, 200, { id: CONTEXT_ID });
    });
    const env = {
      BROWSERBASE_CONFIG_DIR: configDir,
      BROWSERBASE_API_KEY: "test-key",
      BROWSERBASE_BASE_URL: server.baseUrl,
    };
    try {
      const result = await runCli(
        ["cloud", "contexts", "create", "--name", "bad name"],
        { env },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Invalid context name");
      expect(server.requests.length).toBe(0);
    } finally {
      await server.close();
    }
  });
});
