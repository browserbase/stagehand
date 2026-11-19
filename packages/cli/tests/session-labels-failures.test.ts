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

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const actions = [
  {
    name: "create",
    args: ["create", "--label", "Checkout"],
    method: "POST",
    path: "/v1/sessions",
    result: { id: "session-1", status: "RUNNING" },
  },
  {
    name: "get",
    args: ["get", "session-1"],
    method: "GET",
    path: "/v1/sessions/session-1?includeLabels=true",
    result: { id: "session-1", status: "RUNNING", labels: [] },
  },
  {
    name: "set",
    args: ["labels", "set", "session-1", "--label", "Checkout"],
    method: "PUT",
    path: "/v1/sessions/session-1/labels",
    result: { labels: [{ id: "label-1", name: "Checkout" }] },
  },
  {
    name: "clear",
    args: ["labels", "clear", "session-1"],
    method: "PUT",
    path: "/v1/sessions/session-1/labels",
    result: { labels: [] },
  },
];

describe("session labels with simulated service limits and failures", () => {
  it("preserves session success and avoids destructive quota-recovery attempts", async () => {
    // This deliberately small fixture quota is not a Browserbase plan allowance.
    const simulatedCatalogLimit = 2;
    const catalog = new Set(["Store A", "Store B"]);
    const sessions = new Map([
      ["existing-session", { id: "existing-session", status: "RUNNING", labels: ["Store A"] }],
    ]);
    const labelResponse = (names: string[]) => names.map((name) => ({ id: name, name }));
    const exceedsQuota = (names: string[]) =>
      new Set([...catalog, ...names]).size > simulatedCatalogLimit;
    server = await startFakeBrowserbaseServer((request, response) => {
      const url = new URL(request.path, "http://fixture.invalid");
      const body = request.jsonBody as { labels: string[] };
      if (request.method === "POST" && url.pathname === "/v1/sessions") {
        const session = { id: "created-session", status: "RUNNING", labels: [] as string[] };
        if (!exceedsQuota(body.labels)) {
          session.labels = body.labels;
          body.labels.forEach((name) => catalog.add(name));
        }
        sessions.set(session.id, session);
        jsonResponse(response, 201, { id: session.id, status: session.status });
        return;
      }
      const id = url.pathname.split("/")[3]!;
      const session = sessions.get(id);
      if (request.method === "GET" && session) {
        jsonResponse(response, 200, { ...session, labels: labelResponse(session.labels) });
        return;
      }
      if (request.method === "PUT" && url.pathname.endsWith("/labels") && session) {
        if (exceedsQuota(body.labels)) {
          jsonResponse(response, 422, { message: "Simulated label allowance reached" });
          return;
        }
        session.labels = body.labels;
        body.labels.forEach((name) => catalog.add(name));
        jsonResponse(response, 200, { labels: labelResponse(session.labels) });
        return;
      }
      jsonResponse(response, 404, { message: "Unexpected request in quota fixture" });
    });
    const run = (args: string[]) =>
      runCli(["cloud", "sessions", ...args, "--base-url", server!.baseUrl], { env });

    const created = await run(["create", "--label", "Store C"]);
    expect(created.exitCode, created.stderr).toBe(0);
    expect(JSON.parse(created.stdout)).toEqual({ id: "created-session", status: "RUNNING" });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.jsonBody).toMatchObject({ labels: ["Store C"] });
    const createdRead = await run(["get", "created-session"]);
    expect(createdRead.exitCode, createdRead.stderr).toBe(0);
    expect(JSON.parse(createdRead.stdout)).toEqual({
      id: "created-session",
      status: "RUNNING",
      labels: [],
    });

    const rejected = await run([
      "labels",
      "set",
      "existing-session",
      "--label",
      "Store B",
      "--label",
      "Store C",
    ]);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stdout).toBe("");
    expect(rejected.stderr).toContain("Simulated label allowance reached");
    expect(sessions.get("existing-session")?.labels).toEqual(["Store A"]);
    expect([...catalog]).toEqual(["Store A", "Store B"]);
    const unchanged = await run(["get", "existing-session"]);
    expect(unchanged.exitCode, unchanged.stderr).toBe(0);
    expect(JSON.parse(unchanged.stdout)).toMatchObject({
      status: "RUNNING",
      labels: labelResponse(["Store A"]),
    });

    const reused = await run(["labels", "set", "existing-session", "--label", "Store B"]);
    expect(reused.exitCode, reused.stderr).toBe(0);
    expect(JSON.parse(reused.stdout)).toEqual({ labels: labelResponse(["Store B"]) });
    const cleared = await run(["labels", "clear", "existing-session"]);
    expect(cleared.exitCode, cleared.stderr).toBe(0);
    expect(JSON.parse(cleared.stdout)).toEqual({ labels: [] });
    expect([...catalog]).toEqual(["Store A", "Store B"]);
    const clearedRead = await run(["get", "existing-session"]);
    expect(clearedRead.exitCode, clearedRead.stderr).toBe(0);
    expect(JSON.parse(clearedRead.stdout)).toMatchObject({ status: "RUNNING", labels: [] });

    const stillFull = await run(["labels", "set", "existing-session", "--label", "Store C"]);
    expect(stillFull.exitCode).toBe(1);
    expect(stillFull.stdout).toBe("");
    expect(stillFull.stderr).toContain("Simulated label allowance reached");
    expect(sessions.get("existing-session")).toEqual({
      id: "existing-session",
      status: "RUNNING",
      labels: [],
    });
    expect([...catalog]).toEqual(["Store A", "Store B"]);
    expect(server.requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "POST /v1/sessions",
      "GET /v1/sessions/created-session?includeLabels=true",
      "PUT /v1/sessions/existing-session/labels",
      "GET /v1/sessions/existing-session?includeLabels=true",
      "PUT /v1/sessions/existing-session/labels",
      "PUT /v1/sessions/existing-session/labels",
      "GET /v1/sessions/existing-session?includeLabels=true",
      "PUT /v1/sessions/existing-session/labels",
    ]);
    const writes = server.requests.filter(({ method }) => method === "PUT");
    expect(writes.map(({ jsonBody }) => jsonBody)).toEqual([
      { labels: ["Store B", "Store C"] },
      { labels: ["Store B"] },
      { labels: [] },
      { labels: ["Store C"] },
    ]);
  });

  it.each(
    [429, 503].flatMap((status) =>
      actions.flatMap((action) => [false, true].map((recovers) => ({ status, action, recovers }))),
    ),
  )(
    "$action.name preserves its request on $status retries (recovers: $recovers)",
    async ({ status, action, recovers }) => {
      let attempts = 0;
      let successfulMutations = 0;
      server = await startFakeBrowserbaseServer((_request, response) => {
        attempts += 1;
        if (!recovers || attempts < 3) {
          response.setHeader("retry-after-ms", "1");
          jsonResponse(response, status, { message: `Simulated ${status} failure` });
          return;
        }
        if (action.name !== "get") successfulMutations += 1;
        jsonResponse(response, action.name === "create" ? 201 : 200, action.result);
      });
      const result = await runCli(
        ["cloud", "sessions", ...action.args, "--base-url", server.baseUrl],
        { env },
      );
      expect(server.requests).toHaveLength(3);
      for (const request of server.requests) {
        expect(request).toMatchObject({ method: action.method, path: action.path });
        expect(request.jsonBody).toEqual(server.requests[0]?.jsonBody);
      }
      if (action.name === "create" || action.name === "set") {
        expect(server.requests[0]?.jsonBody).toMatchObject({ labels: ["Checkout"] });
      } else if (action.name === "clear") {
        expect(server.requests[0]?.jsonBody).toEqual({ labels: [] });
      }
      if (recovers) {
        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(action.result);
        expect(successfulMutations).toBe(action.name === "get" ? 0 : 1);
      } else {
        expect(result.exitCode).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(`Simulated ${status} failure`);
        expect(successfulMutations).toBe(0);
      }
    },
  );

  it.each([401, 403, 404].flatMap((status) => actions.map((action) => ({ status, action }))))(
    "$action.name reports $status once without fallback or success output",
    async ({ status, action }) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, status, { message: `Simulated ${status} rejection` }),
      );
      const result = await runCli(
        ["cloud", "sessions", ...action.args, "--base-url", server.baseUrl],
        { env },
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(`Simulated ${status} rejection`);
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).toMatchObject({ method: action.method, path: action.path });
    },
  );

  it.each([undefined, []].map((labels) => ({ labels })))(
    "keeps unavailable labels distinct from $labels",
    async ({ labels }) => {
      const session = {
        id: "session-1",
        status: "RUNNING",
        ...(labels === undefined ? {} : { labels }),
      };
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 200, session),
      );
      const result = await runCli(
        ["cloud", "sessions", "get", "session-1", "--base-url", server.baseUrl],
        { env },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toEqual(session);
      expect(Object.hasOwn(output, "labels")).toBe(labels !== undefined);
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]?.path).toBe("/v1/sessions/session-1?includeLabels=true");
    },
  );
});
