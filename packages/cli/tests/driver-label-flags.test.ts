import { Parser } from "@oclif/core";
import { promises as fs } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Open from "../src/commands/open.js";
import { getSocketPath, sanitizeSessionName } from "../src/lib/driver/daemon/paths.js";
import type { ConnectionTarget } from "../src/lib/driver/types.js";
import {
  jsonResponse,
  startFakeBrowserbaseServer,
  type FakeBrowserbaseServer,
} from "./helpers/fake-browserbase-server.js";
import { runCli } from "./helpers/run-cli.js";

describe("remote open label flags", () => {
  it("accepts repeated labels before a positional URL without consuming the URL", async () => {
    const parsed = await Parser.parse(
      ["--remote", "--label", "Checkout", "--label", "Smoke test", "https://example.com"],
      { args: Open.args, flags: Open.flags },
    );
    expect(parsed.args.url).toBe("https://example.com");
    expect(parsed.flags.label).toEqual(["Checkout", "Smoke test"]);
    expect(parsed.flags.remote).toBe(true);
  });

  it("leaves labels absent for existing sessions when the flag is omitted", async () => {
    const parsed = await Parser.parse(["https://example.com", "--remote"], {
      args: Open.args,
      flags: Open.flags,
    });
    expect(parsed.flags.label).toBeUndefined();
  });
});

describe("session handles and cloud labels through the CLI", () => {
  let daemonDir: string;
  let api: FakeBrowserbaseServer | undefined;
  const daemons: Array<Awaited<ReturnType<typeof startDaemonFixture>>> = [];

  beforeEach(async () => {
    daemonDir = await fs.mkdtemp(join(tmpdir(), "browse-label-dx-"));
  });

  afterEach(async () => {
    await api?.close();
    api = undefined;
    await Promise.all(daemons.splice(0).map((daemon) => daemon.close()));
    await fs.rm(daemonDir, { recursive: true, force: true });
  });

  function cli(args: string[], session = "default") {
    return runCli(args, {
      timeoutMs: 15_000,
      env: {
        BROWSERBASE_API_KEY: "test-key",
        BROWSERBASE_TELEMETRY_DISABLED: "1",
        BROWSE_LOAD_DOTENV: "0",
        BROWSE_DAEMON_DIR: daemonDir,
        BROWSE_SESSION: session,
      },
    });
  }

  async function daemon(session: string, target: ConnectionTarget) {
    const fixture = await startDaemonFixture(daemonDir, session, target);
    daemons.push(fixture);
    return fixture;
  }

  it.each(["--session", "-s", "environment"])(
    "%s chooses the local handle even when another handle shares its cloud label",
    async (selector) => {
      const selected = await daemon("checkout-worker", { kind: "remote", labels: ["Checkout"] });
      const other = await daemon("Checkout", { kind: "remote", labels: ["Checkout"] });
      const result = await cli(
        [
          "open",
          "https://example.com",
          "--remote",
          "--label",
          "Checkout",
          ...(selector === "environment" ? [] : [selector, "checkout-worker"]),
        ],
        selector === "environment" ? "checkout-worker" : "Checkout",
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        session: "checkout-worker",
        browserbaseSessionId: selected.browserbaseSessionId,
      });
      expect(selected.requests.map((request) => request.type)).toEqual(["status", "open"]);
      expect(other.requests).toEqual([]);
    },
  );

  it("keeps distinct handles whose names require the same filename sanitization", async () => {
    const first = await daemon("worker/a", { kind: "remote", labels: ["Checkout"] });
    const second = await daemon("worker:a", { kind: "remote", labels: ["Checkout"] });
    for (const [session, fixture] of [
      ["worker/a", first],
      ["worker:a", second],
    ] as const) {
      const result = await cli(["open", "https://example.com", "--session", session]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        session,
        browserbaseSessionId: fixture.browserbaseSessionId,
      });
      expect(fixture.requests.map((request) => request.type)).toEqual(["status", "open"]);
    }
  });

  it("reuses a handle for reordered, repeated, and case-varied creation labels", async () => {
    const selected = await daemon("worker", {
      kind: "remote",
      labels: ["Café, checkout", "Smoke test"],
    });
    const result = await cli([
      "open",
      "--remote",
      "--session",
      "worker",
      "--label",
      " SMOKE TEST ",
      "--label",
      "cAFÉ, CHECKOUT",
      "--label",
      "Smoke test",
      "https://example.com",
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).browserbaseSessionId).toBe(selected.browserbaseSessionId);
    expect(selected.requests.map((request) => request.type)).toEqual(["status", "open"]);
  });

  it("normalizes Unicode whitespace consistently when reusing creation labels", async () => {
    const selected = await daemon("worker", { kind: "remote", labels: ["Checkout"] });
    const result = await cli([
      "open",
      "https://example.com",
      "--session",
      "worker",
      "--remote",
      "--label",
      "\u0085Checkout\u0085",
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(selected.requests.map((request) => request.type)).toEqual(["status", "open"]);
  });

  it("rejects a leading BOM before using the daemon", async () => {
    const selected = await daemon("worker", { kind: "remote", labels: ["Checkout"] });
    const result = await cli([
      "open",
      "https://example.com",
      "--session",
      "worker",
      "--remote",
      "--label",
      "\uFEFFCheckout",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("must not start with U+FEFF");
    expect(selected.requests).toEqual([]);
  });

  it.each([[], ["--local"], ["--cdp", "9222"], ["--auto-connect"]])(
    "rejects creation labels without explicit remote mode: %j",
    async (...mode) => {
      const selected = await daemon("default", { kind: "remote", labels: ["Checkout"] });
      const result = await cli(["open", "https://example.com", ...mode, "--label", "Checkout"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("--label requires --remote");
      expect(selected.requests).toEqual([]);
    },
  );

  it.each([["--local"], ["--cdp", "9222"], ["--auto-connect"], ["--headed"]])(
    "rejects remote label mode conflicts before using the daemon: %j",
    async (...mode) => {
      const selected = await daemon("default", { kind: "remote", labels: ["Checkout"] });
      const result = await cli([
        "open",
        "https://example.com",
        "--remote",
        ...mode,
        "--label",
        "Checkout",
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/cannot be combined|either --local or --remote/);
      expect(selected.requests).toEqual([]);
    },
  );

  it.each(["status", "snapshot", "stop"])(
    "%s does not accept a cloud label as a local session selector",
    async (command) => {
      const selected = await daemon("default", { kind: "remote", labels: ["Checkout"] });
      const result = await cli([command, "--label", "Checkout"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("--label");
      expect(selected.requests).toEqual([]);
    },
  );

  it("preserves a running handle after set and clear, with actionable creation-label guidance", async () => {
    const selected = await daemon("worker", { kind: "remote", labels: ["Original"] });
    let assigned = ["Original"];
    api = await startFakeBrowserbaseServer((request, response) => {
      if (request.method === "PUT") {
        assigned = (request.jsonBody as { labels: string[] }).labels;
        jsonResponse(response, 200, { labels: assigned.map((name) => ({ id: name, name })) });
      } else {
        jsonResponse(response, 200, {
          id: selected.browserbaseSessionId,
          labels: assigned.map((name) => ({ id: name, name })),
        });
      }
    });

    const set = await cli([
      "cloud",
      "sessions",
      "labels",
      "set",
      selected.browserbaseSessionId,
      "--label",
      "Replacement",
      "--base-url",
      api.baseUrl,
    ]);
    expect(set.exitCode, set.stderr).toBe(0);
    const assignedResult = await cli([
      "cloud",
      "sessions",
      "get",
      selected.browserbaseSessionId,
      "--base-url",
      api.baseUrl,
    ]);
    expect(assignedResult.exitCode, assignedResult.stderr).toBe(0);
    expect(JSON.parse(assignedResult.stdout).labels).toEqual([
      { id: "Replacement", name: "Replacement" },
    ]);

    const changed = await cli([
      "open",
      "https://example.com",
      "--session",
      "worker",
      "--remote",
      "--label",
      "Replacement",
    ]);
    expect(changed.exitCode).not.toBe(0);
    expect(changed.stderr).toContain("creation labels");
    expect(changed.stderr).toContain("omit --label");
    expect(changed.stderr).toContain(`browse cloud sessions get ${selected.browserbaseSessionId}`);

    for (const clear of [false, true]) {
      if (clear) {
        const cleared = await cli([
          "cloud",
          "sessions",
          "labels",
          "clear",
          selected.browserbaseSessionId,
          "--base-url",
          api.baseUrl,
        ]);
        expect(cleared.exitCode, cleared.stderr).toBe(0);
      }
      const opened = await cli(["open", "https://example.com", "--session", "worker", "--remote"]);
      expect(opened.exitCode, opened.stderr).toBe(0);
      expect(JSON.parse(opened.stdout)).toMatchObject({
        session: "worker",
        browserbaseSessionId: selected.browserbaseSessionId,
      });
    }
    const oldCreationLabels = await cli([
      "open",
      "https://example.com",
      "--session",
      "worker",
      "--remote",
      "--label",
      "Original",
    ]);
    expect(oldCreationLabels.exitCode, oldCreationLabels.stderr).toBe(0);
    const afterClear = await cli([
      "cloud",
      "sessions",
      "get",
      selected.browserbaseSessionId,
      "--base-url",
      api.baseUrl,
    ]);
    expect(afterClear.exitCode, afterClear.stderr).toBe(0);
    expect(JSON.parse(afterClear.stdout).labels).toEqual([]);
    expect(assigned).toEqual([]);
    expect(api.requests.map((request) => [request.method, request.path])).toEqual([
      ["PUT", `/v1/sessions/${selected.browserbaseSessionId}/labels`],
      ["GET", `/v1/sessions/${selected.browserbaseSessionId}?includeLabels=true`],
      ["PUT", `/v1/sessions/${selected.browserbaseSessionId}/labels`],
      ["GET", `/v1/sessions/${selected.browserbaseSessionId}?includeLabels=true`],
    ]);
    expect(selected.requests.filter((request) => request.type === "open")).toHaveLength(3);
  });
});

interface DaemonFixtureRequest {
  id: string;
  type: string;
  url?: string;
}

async function startDaemonFixture(directory: string, session: string, target: ConnectionTarget) {
  const requests: DaemonFixtureRequest[] = [];
  const sockets = new Set<net.Socket>();
  const browserbaseSessionId = `cloud-${sanitizeSessionName(session)}`;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline)) as DaemonFixtureRequest;
      requests.push(request);
      const data =
        request.type === "status"
          ? {
              session,
              target,
              mode: target.kind,
              initialized: true,
              browserConnected: true,
              pages: [],
              pid: process.pid,
              browserbaseSessionId,
            }
          : { session, browserbaseSessionId, url: request.url };
      socket.end(`${JSON.stringify({ id: request.id, type: "success", data })}\n`);
    });
  });
  const socketPath =
    process.platform === "win32"
      ? getSocketPath(session)
      : join(directory, `${sanitizeSessionName(session)}.sock`);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  return {
    browserbaseSessionId,
    requests,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
