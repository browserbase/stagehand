import { afterEach, describe, expect, it } from "vitest";

import { normalizeSessionLabels } from "../src/lib/session-labels.js";
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

describe("session label cloud commands", () => {
  it.each(["body", "stdin"] as const)(
    "create flags replace %s labels while preserving other options and metadata",
    async (input) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 201, { id: "session-1", status: "RUNNING" }),
      );
      const body = JSON.stringify({
        labels: ["Previous"],
        keepAlive: true,
        userMetadata: { workflow: "checkout" },
      });
      const result = await runCli(
        [
          "cloud",
          "sessions",
          "create",
          ...(input === "body" ? ["--body", body] : ["--stdin"]),
          "--label",
          "  Store A  ",
          "--label",
          "Café, checkout",
          "--base-url",
          server.baseUrl,
        ],
        { env, ...(input === "stdin" ? { stdin: body } : {}) },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ id: "session-1", status: "RUNNING" });
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).toMatchObject({
        method: "POST",
        path: "/v1/sessions",
        headers: { "x-bb-api-key": "test-key" },
        jsonBody: {
          labels: ["Store A", "Café, checkout"],
          keepAlive: true,
          userMetadata: { workflow: "checkout", browse_cli: "true" },
        },
      });
    },
  );

  it("preserves body-only labels and does not poll or edit a newly created session", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 201, { id: "session-1" }),
    );
    const result = await runCli(
      [
        "cloud",
        "sessions",
        "create",
        "--body",
        '{"labels":["Store A"]}',
        "--base-url",
        server.baseUrl,
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.jsonBody).toMatchObject({ labels: ["Store A"] });
  });

  it.each(["create", "set"] as const)("%s rejects blank labels before HTTP", async (command) => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, {}),
    );
    const action = command === "create" ? ["create"] : ["labels", "set", "session-1"];
    const result = await runCli(
      ["cloud", "sessions", ...action, "--label", " \t ", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("label names must not be blank");
    expect(server.requests).toHaveLength(0);
  });

  it("reads assigned labels and prints the complete session response", async () => {
    const session = {
      id: "session-1",
      status: "COMPLETED",
      labels: [{ id: "label-1", name: "Store A" }],
    };
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, session),
    );
    const result = await runCli(
      ["cloud", "sessions", "get", "session-1", "--include-labels", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(session);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "GET",
      path: "/v1/sessions/session-1?includeLabels=true",
      bodyText: "",
      headers: { "x-bb-api-key": "test-key" },
    });
  });

  it("distinguishes an empty label set from unavailable label reads", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, { id: "session-1", labels: [] }),
    );
    const result = await runCli(
      ["cloud", "sessions", "get", "session-1", "--include-labels", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ id: "session-1", labels: [] });
  });

  it("reports unavailable requested labels instead of inventing an empty array", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, { id: "session-1" }),
    );
    const result = await runCli(
      ["cloud", "sessions", "get", "session-1", "--include-labels", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "Session labels are unavailable for this project or API endpoint",
    );
    expect(result.stdout.trim()).toBe("");
    expect(server.requests).toHaveLength(1);
  });

  it("preserves plain session get without requesting labels", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, { id: "session-1" }),
    );
    const result = await runCli(
      ["cloud", "sessions", "get", "session-1", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ id: "session-1" });
    expect(server.requests[0]?.path).toBe("/v1/sessions/session-1");
  });

  it("replaces labels without changing lifecycle status and accepts the ID after a label flag", async () => {
    const assigned = {
      labels: [
        { id: "label-1", name: "Store A" },
        { id: "label-2", name: "Checkout" },
      ],
    };
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, assigned),
    );
    const result = await runCli(
      [
        "cloud",
        "sessions",
        "labels",
        "set",
        "--label",
        "Store A",
        "session-1",
        "--label",
        " Checkout ",
        "--base-url",
        server.baseUrl,
        "--api-key",
        "override-key",
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(assigned);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "PUT",
      path: "/v1/sessions/session-1/labels",
      headers: { "x-bb-api-key": "override-key", "content-type": "application/json" },
    });
    expect(server.requests[0]?.jsonBody).toEqual({ labels: ["Store A", "Checkout"] });
  });

  it("clears assignments with an empty replacement and does not release the session", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, { labels: [] }),
    );
    const result = await runCli(
      ["cloud", "sessions", "labels", "clear", "session-1", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ labels: [] });
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({
      method: "PUT",
      path: "/v1/sessions/session-1/labels",
    });
    expect(server.requests[0]?.jsonBody).toEqual({ labels: [] });
  });

  it.each(["get", "set", "clear"] as const)("%s escapes the session ID", async (command) => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, { labels: [] }),
    );
    const action = command === "get" ? ["get"] : ["labels", command];
    const flags =
      command === "get" ? ["--include-labels"] : command === "set" ? ["--label", "Checkout"] : [];
    const result = await runCli(
      [
        "cloud",
        "sessions",
        ...action,
        "id/with?query#fragment",
        ...flags,
        "--base-url",
        server.baseUrl,
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]?.path).toBe(
      "/v1/sessions/id%2Fwith%3Fquery%23fragment" +
        (command === "get" ? "?includeLabels=true" : "/labels"),
    );
  });

  it.each([
    [["get", "session-1", "--include-labels"], 403, "Forbidden"],
    [["labels", "set", "session-1", "--label", "Checkout"], 404, "Session not found"],
    [["labels", "clear", "session-1"], 429, "Rate limit reached"],
    [["labels", "set", "session-1", "--label", "Checkout"], 422, "Label allowance reached"],
  ] as const)("preserves API errors for %j", async (action, status, message) => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, status, { message }),
    );
    const result = await runCli(["cloud", "sessions", ...action, "--base-url", server.baseUrl], {
      env,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
    expect(result.stdout.trim()).toBe("");
    expect(server.requests).toHaveLength(1);
  });

  it("requires at least one label for set without clearing existing assignments", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, {}),
    );
    const result = await runCli(
      ["cloud", "sessions", "labels", "set", "session-1", "--base-url", server.baseUrl],
      { env },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("label");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects NUL names without silently rewriting them", () => {
    expect(() => normalizeSessionLabels(["Checkout\0"])).toThrow("must not contain NUL");
  });
});
