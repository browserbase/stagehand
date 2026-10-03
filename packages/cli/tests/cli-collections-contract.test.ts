import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  jsonResponse,
  startFakeBrowserbaseServer,
  type FakeBrowserbaseServer,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

const env = {
  BROWSERBASE_API_KEY: "test-key",
  BROWSE_LOAD_DOTENV: "0",
  BROWSERBASE_TELEMETRY_DISABLED: "1",
};
let server: FakeBrowserbaseServer | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
const records = Array.from({ length: 21 }, (_, i) => ({
  id: `record-${i}`,
  name: `Record ${i}`,
  slug: `example.com/task-${i}`,
  hostname: "example.com",
  task: `task-${i}`,
  title: `Record ${i}`,
  description: "",
  category: "",
  aliases: [],
  tags: [],
  source: "",
  updated: "",
  recommendedMethod: "",
  verified: false,
  proxies: false,
  sourceUrl: "",
  partner: false,
  screenshotUrls: [],
  installCount: 0,
}));

const arrayCommands = [
  { args: ["cloud", "projects", "list"], key: undefined, complete: true },
  { args: ["cloud", "sessions", "list"], key: undefined, complete: false },
  { args: ["skills", "list"], key: "skills", complete: true },
  { args: ["skills", "find", "Record"], key: "skills", complete: true },
  { args: ["templates", "list"], key: "templates", complete: true },
  { args: ["templates", "find", "Record"], key: "templates", complete: true },
];

describe("shared collection CLI contract", () => {
  it.each(arrayCommands)(
    "preserves legacy output and aligns $args",
    async ({ args, key, complete }) => {
      const data =
        key === "templates"
          ? records.map((r) => ({ ...r, category: [] }))
          : records;
      server = await startFakeBrowserbaseServer((request, response) => {
        if (request.path === "/Record") {
          jsonResponse(response, 404, {});
          return;
        }
        jsonResponse(response, 200, key ? { [key]: data } : data);
      });
      const options = {
        env: {
          ...env,
          BROWSERBASE_BASE_URL: server.baseUrl,
          BROWSE_SKILLS_API_BASE_URL: server.baseUrl,
          BROWSERBASE_TEMPLATES_API: server.baseUrl,
        },
      };
      const legacy = await runCli([...args, "--json"], options);
      expect(legacy.exitCode, legacy.stderr).toBe(0);
      const legacyPayload = JSON.parse(legacy.stdout);
      const legacyData = key ? legacyPayload[key] : legacyPayload;
      expect(legacyData).toHaveLength(21);
      const defaultList = await runCli(
        [...args, "--list-version", "2"],
        options,
      );
      expect(defaultList.exitCode, defaultList.stderr).toBe(0);
      expect(JSON.parse(defaultList.stdout)).toEqual({
        data: legacyData.slice(0, 20),
        hasMore: true,
        nextCursor: null,
      });
      const limited = await runCli(
        [...args, "--list-version", "2", "--limit", "1", "--json"],
        options,
      );
      expect(limited.exitCode, limited.stderr).toBe(0);
      expect(JSON.parse(limited.stdout)).toEqual({
        data: legacyData.slice(0, 1),
        hasMore: true,
        nextCursor: null,
      });
      const table = await runCli(
        [...args, "--list-version", "2", "--limit", "1", "--format", "table"],
        options,
      );
      expect(table.exitCode, table.stderr).toBe(0);
      const label = args.includes("sessions") ? "record-" : "Record ";
      expect(table.stdout).toContain(`${label}0`);
      expect(table.stdout).not.toContain(`${label}1`);
      expect(table.stdout).toContain(
        "Showing 1 results. More results are available",
      );
      const all = await runCli(
        [...args, "--list-version", "2", "--all", "--json"],
        options,
      );
      expect(all.exitCode, all.stderr).toBe(0);
      expect(JSON.parse(all.stdout)).toEqual({
        data: legacyData,
        hasMore: complete ? false : null,
        nextCursor: null,
      });
      const requestCount = server.requests.length;
      const conflict = await runCli(
        [...args, "--list-version", "2", "--all", "--limit", "1"],
        options,
      );
      expect(conflict.exitCode).not.toBe(0);
      expect(conflict.stderr).toContain("--all and --limit");
      expect(server.requests).toHaveLength(requestCount);
    },
  );

  it("applies the same contract to local context aliases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "browse-collection-contexts-"));
    dirs.push(dir);
    await writeFile(
      join(dir, "contexts.json"),
      JSON.stringify({
        version: 1,
        contexts: {
          a: { id: "ctx-a", createdAt: "2026-01-01T00:00:00Z" },
          b: { id: "ctx-b", createdAt: "2026-01-02T00:00:00Z" },
        },
      }),
    );
    const result = await runCli(
      [
        "cloud",
        "contexts",
        "list",
        "--list-version",
        "2",
        "--limit",
        "1",
        "--json",
      ],
      { env: { ...env, BROWSERBASE_CONFIG_DIR: dir } },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      data: [{ name: "a", id: "ctx-a", createdAt: "2026-01-01T00:00:00Z" }],
      hasMore: true,
      nextCursor: null,
    });
  });

  it.each([
    ["cloud", "secrets", "list"],
    ["functions", "secrets", "list", "function-id"],
  ])(
    "paginates %j without losing records and preserves filters",
    async (...args) => {
      const secrets = Array.from({ length: 5 }, (_, i) => ({
        id: `secret-${i}`,
        secretKey: `KEY_${i}`,
      }));
      server = await startFakeBrowserbaseServer((request, response) => {
        const query = new URL(request.path, "http://localhost").searchParams;
        const offset = Number(query.get("cursor") ?? 0);
        const size = Math.min(2, Number(query.get("limit") ?? 20));
        const data = secrets.slice(offset, offset + size);
        const end = offset + data.length;
        jsonResponse(response, 200, {
          data,
          limit: size,
          nextCursor: end < secrets.length ? String(end) : null,
        });
      });
      const baseArgs = [
        ...args,
        "--base-url",
        server.baseUrl,
        "--list-version",
        "2",
        "--start-at",
        "2026-01-01T00:00:00Z",
        "--end-at",
        "2026-02-01T00:00:00Z",
      ];
      const first = await runCli([...baseArgs, "--limit", "3", "--json"], {
        env,
      });
      expect(first.exitCode, first.stderr).toBe(0);
      expect(JSON.parse(first.stdout)).toEqual({
        data: secrets.slice(0, 3),
        hasMore: true,
        nextCursor: "3",
      });
      expect(
        server.requests.map((r) =>
          new URL(r.path, server!.baseUrl).searchParams.get("limit"),
        ),
      ).toEqual(["3", "1"]);
      const rest = await runCli(
        [...baseArgs, "--cursor", "3", "--all", "--json"],
        { env },
      );
      expect(rest.exitCode, rest.stderr).toBe(0);
      expect(JSON.parse(rest.stdout)).toEqual({
        data: secrets.slice(3),
        hasMore: false,
        nextCursor: null,
      });
      const all = await runCli(
        [...baseArgs, "--all", "--format", "table", "--wide"],
        { env },
      );
      expect(all.exitCode, all.stderr).toBe(0);
      for (const secret of secrets)
        expect(all.stdout).toContain(secret.secretKey);
      for (const request of server.requests) {
        const query = new URL(request.path, server.baseUrl).searchParams;
        expect(query.get("startAt")).toBe("2026-01-01T00:00:00Z");
        expect(query.get("endAt")).toBe("2026-02-01T00:00:00Z");
      }
    },
  );

  it.each(["error", "cycle", "oversized"])(
    "fails cleanly on a later page: %s",
    async (mode) => {
      let calls = 0;
      server = await startFakeBrowserbaseServer((_request, response) => {
        calls++;
        if (calls === 1) {
          jsonResponse(response, 200, {
            data: [{ id: "one", secretKey: "ONE" }],
            nextCursor: "next",
          });
          return;
        }
        if (mode === "error")
          jsonResponse(response, 403, { message: "Forbidden" });
        else
          jsonResponse(response, 200, {
            data: mode === "oversized" ? [{}, {}, {}] : [],
            nextCursor: "next",
          });
      });
      const result = await runCli(
        [
          "cloud",
          "secrets",
          "list",
          "--base-url",
          server.baseUrl,
          "--list-version",
          "2",
          "--limit",
          "3",
          "--json",
        ],
        { env },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(server.requests).toHaveLength(2);
    },
  );

  it("uses the same empty table message", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, { data: [], nextCursor: null }),
    );
    const result = await runCli(
      [
        "cloud",
        "secrets",
        "list",
        "--base-url",
        server.baseUrl,
        "--list-version",
        "2",
        "--format",
        "table",
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("No results.\n");
  });
});
