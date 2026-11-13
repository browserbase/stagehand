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

describe("session update label confusion", () => {
  const labelBodies = [
    { labels: ["Checkout"] },
    { labels: [] },
    { labels: null },
    { label: "Checkout" },
    { labels: ["Checkout"], status: "REQUEST_RELEASE" },
  ];

  it.each(
    (["body", "stdin"] as const).flatMap((input) => labelBodies.map((body) => ({ input, body }))),
  )("rejects $input $body without releasing the browser", async ({ input, body }) => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, { id: "session-1", status: "REQUEST_RELEASE" }),
    );
    const json = JSON.stringify(body);
    const result = await runCli(
      [
        "cloud",
        "sessions",
        "update",
        "session-1",
        ...(input === "body" ? ["--body", json] : ["--stdin"]),
        "--base-url",
        server.baseUrl,
      ],
      { env, ...(input === "stdin" ? { stdin: json } : {}) },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Session updates release the browser");
    expect(result.stderr).toContain("browse cloud sessions labels set");
    expect(result.stderr).toContain("browse cloud sessions labels clear");
    expect(result.stdout).toBe("");
    expect(server.requests).toHaveLength(0);
  });

  it("rejects label bodies even when --status explicitly requests release", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 200, { status: "REQUEST_RELEASE" }),
    );
    const result = await runCli(
      [
        "cloud",
        "sessions",
        "update",
        "session-1",
        "--status",
        "REQUEST_RELEASE",
        "--body",
        '{"labels":["Checkout"]}',
        "--base-url",
        server.baseUrl,
      ],
      { env },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot change labels");
    expect(result.stdout).toBe("");
    expect(server.requests).toHaveLength(0);
  });

  it("explains the label command before asking for API credentials", async () => {
    const result = await runCli(
      ["cloud", "sessions", "update", "session-1", "--body", '{"labels":[]}'],
      { env: { ...env, BROWSERBASE_API_KEY: "" } },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot change labels");
    expect(result.stderr).not.toContain("Missing Browserbase API key");
  });

  it.each(["default", "flag", "body", "stdin"] as const)(
    "preserves the %s session-release flow",
    async (input) => {
      const session = { id: "session-1", status: "REQUEST_RELEASE" };
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 200, session),
      );
      const body = JSON.stringify({ status: "REQUEST_RELEASE", projectId: "project-1" });
      const inputFlags =
        input === "flag"
          ? ["--status", "REQUEST_RELEASE"]
          : input === "body"
            ? ["--body", body]
            : input === "stdin"
              ? ["--stdin"]
              : [];
      const result = await runCli(
        ["cloud", "sessions", "update", "session-1", ...inputFlags, "--base-url", server.baseUrl],
        { env, ...(input === "stdin" ? { stdin: body } : {}) },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(session);
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).toMatchObject({
        method: "POST",
        path: "/v1/sessions/session-1",
        jsonBody: {
          status: "REQUEST_RELEASE",
          ...(["body", "stdin"].includes(input) ? { projectId: "project-1" } : {}),
        },
      });
    },
  );
});
