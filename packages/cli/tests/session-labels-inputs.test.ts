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

const invalid = [
  { name: "scalar", labels: "Checkout", error: "array of names" },
  { name: "null", labels: null, error: "array of names" },
  { name: "object", labels: { name: "Checkout" }, error: "array of names" },
  { name: "mixed types", labels: ["Checkout", 1], error: "array of names" },
  { name: "nested array", labels: [["Checkout"]], error: "array of names" },
  { name: "blank", labels: ["  "], error: "must not be blank" },
  { name: "Unicode whitespace", labels: ["\u0085\u2000"], error: "must not be blank" },
  { name: "NUL", labels: ["Check\0out"], error: "NUL" },
  { name: "129 ASCII characters", labels: ["a".repeat(129)], error: "128 Unicode" },
  { name: "129 emoji", labels: ["😀".repeat(129)], error: "128 Unicode" },
  { name: "1001 repeated names", labels: Array(1001).fill("A"), error: "1,000" },
];

describe("session label input boundaries", () => {
  it.each(invalid)("rejects $name", ({ labels, error }) => {
    expect(() => normalizeSessionLabels(labels)).toThrow(error);
  });

  it("counts code points, trims Unicode whitespace, and preserves literal names", () => {
    expect(
      normalizeSessionLabels([
        "a".repeat(128),
        "😀".repeat(128),
        "e\u0301".repeat(64),
        "\u0085\u2000Checkout\u3000",
        "\ufeffCheckout\ufeff",
        "Store A,Store B",
        '["Store A","Store B"]',
        "--remote",
        "Checkout",
        "checkout",
      ]),
    ).toEqual([
      "a".repeat(128),
      "😀".repeat(128),
      "e\u0301".repeat(64),
      "Checkout",
      "\ufeffCheckout\ufeff",
      "Store A,Store B",
      '["Store A","Store B"]',
      "--remote",
      "Checkout",
      "checkout",
    ]);
    expect(normalizeSessionLabels(Array(1000).fill("A"))).toHaveLength(1000);
    expect(normalizeSessionLabels([])).toEqual([]);
  });

  for (const input of ["body", "stdin"] as const) {
    it.each(invalid)(
      `rejects $name from ${input} before creating a session`,
      async ({ labels, error }) => {
        server = await startFakeBrowserbaseServer((_request, response) =>
          jsonResponse(response, 201, { id: "should-not-be-created" }),
        );
        const body = JSON.stringify({ labels });
        const result = await runCli(
          [
            "cloud",
            "sessions",
            "create",
            ...(input === "body" ? ["--body", body] : ["--stdin"]),
            "--base-url",
            server.baseUrl,
          ],
          { env, ...(input === "stdin" ? { stdin: body } : {}) },
        );
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(error);
        expect(result.stdout.trim()).toBe("");
        expect(server.requests).toHaveLength(0);
      },
    );
  }

  it.each(["create", "set"] as const)(
    "%s rejects oversized flag inputs before HTTP",
    async (action) => {
      server = await startFakeBrowserbaseServer((_request, response) =>
        jsonResponse(response, 200, {}),
      );
      for (const labels of [["😀".repeat(129)], Array<string>(1001).fill("A")]) {
        const result = await runCli(
          [
            "cloud",
            "sessions",
            ...(action === "create" ? ["create"] : ["labels", "set", "session-1"]),
            ...labels.flatMap((label) => ["--label", label]),
            "--base-url",
            server.baseUrl,
          ],
          { env },
        );
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(labels.length === 1 ? "128 Unicode" : "1,000");
      }
      expect(server.requests).toHaveLength(0);
    },
  );

  it.each(
    [[], ["\u0085 Checkout \u0085", "😀".repeat(128)], Array(1000).fill("A")].map((labels) => ({
      labels,
    })),
  )("accepts valid JSON arrays without inventing label success", async ({ labels }) => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 201, { id: "session-1" }),
    );
    const result = await runCli(
      [
        "cloud",
        "sessions",
        "create",
        "--body",
        JSON.stringify({ labels }),
        "--base-url",
        server.baseUrl,
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(server.requests[0]?.jsonBody).toMatchObject({
      labels: normalizeSessionLabels(labels),
    });
    expect(JSON.parse(result.stdout)).toEqual({ id: "session-1" });
  });

  it("keeps literal flag values and replaces even malformed body labels", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 201, { id: "session-1" }),
    );
    const result = await runCli(
      [
        "cloud",
        "sessions",
        "create",
        "--body",
        '{"labels":null}',
        "--label=--remote",
        "--label",
        '["A","B"]',
        "--label",
        "A,B",
        "--base-url",
        server.baseUrl,
      ],
      { env },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    expect(server.requests[0]?.jsonBody).toMatchObject({
      labels: ["--remote", '["A","B"]', "A,B"],
    });
  });

  it.each([
    ["--session", "Checkout"],
    ["-s", "Checkout"],
    ["--name", "Checkout"],
    ["--labels", "Checkout"],
    ["--label"],
    ["--label", "A", "B"],
    ["--body", '{"label":"Checkout"}'],
  ])("rejects ambiguous create arguments %j before HTTP", async (...args) => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 201, {}),
    );
    const result = await runCli(
      ["cloud", "sessions", "create", "--base-url", server.baseUrl, ...args],
      { env },
    );
    expect(result.exitCode).not.toBe(0);
    expect(server.requests).toHaveLength(0);
  });

  it("does not synchronize BROWSE_SESSION into cloud creation", async () => {
    server = await startFakeBrowserbaseServer((_request, response) =>
      jsonResponse(response, 201, { id: "session-1" }),
    );
    const result = await runCli(["cloud", "sessions", "create", "--base-url", server.baseUrl], {
      env: { ...env, BROWSE_SESSION: "local-handle" },
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(server.requests[0]?.jsonBody).not.toHaveProperty("labels");
    expect(server.requests[0]?.jsonBody).not.toHaveProperty("name");
    expect(server.requests[0]?.jsonBody).not.toHaveProperty("session");
  });
});
