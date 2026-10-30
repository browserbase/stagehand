import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  localLaunch: vi.fn(),
  cloudLaunch: vi.fn(),
  create: vi.fn(),
  construct: vi.fn(),
  run: vi.fn(),
  runActions: vi.fn(),
  snapshot: vi.fn(),
  screenshot: vi.fn(),
  closeTools: vi.fn(),
  closeBrowser: vi.fn(),
  closeStagehand: vi.fn(),
}));

vi.mock("@browserbasehq/stagehand", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@browserbasehq/stagehand")>()),
  browserbase: { launch: mocks.cloudLaunch },
  localBrowser: { launch: mocks.localLaunch },
  Stagehand: { create: mocks.create },
}));

vi.mock("stagehand-middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("stagehand-middleware")>()),
  StagehandFacadeTools: class {
    constructor(...args: unknown[]) {
      mocks.construct(...args);
    }
    run = mocks.run;
    runActions = mocks.runActions;
    snapshot = mocks.snapshot;
    screenshot = mocks.screenshot;
    close = mocks.closeTools;
  },
}));

import * as middleware from "stagehand-middleware";
const { facadeAgentInstructions, facadeToolsFor } = middleware;
import { createStagehandMcp } from "../src/lib/mcp/server.js";

const hosts: Array<ReturnType<typeof createStagehandMcp>> = [];
const clients: Client[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  const browser = { close: mocks.closeBrowser };
  mocks.localLaunch.mockResolvedValue(browser);
  mocks.cloudLaunch.mockResolvedValue(browser);
  mocks.create.mockResolvedValue({ browser, close: mocks.closeStagehand });
  mocks.run.mockResolvedValue({ answer: 42 });
  mocks.runActions.mockResolvedValue({
    completed: 1,
    url: "https://example.com",
  });
  mocks.snapshot.mockResolvedValue("heading: Example");
  mocks.screenshot.mockResolvedValue({
    data: "aW1hZ2U=",
    mimeType: "image/png",
  });
});

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(
  env: NodeJS.ProcessEnv = { STAGEHAND_BROWSER: "local" },
) {
  const host = createStagehandMcp("0.1.0", middleware, env);
  const client = new Client({ name: "adapter-test", version: "1" });
  hosts.push(host);
  clients.push(client);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await host.server.connect(serverTransport);
  await client.connect(clientTransport);
  return { host, client };
}

it("advertises the middleware contract and instructions without launching a browser", async () => {
  const env = { STAGEHAND_BROWSER: "local", EXPLICIT_SNAPSHOT_ACTIONS: "1" };
  const { client } = await connect(env);
  expect((await client.listTools()).tools).toEqual([
    ...facadeToolsFor("playwright", env),
  ]);
  expect(client.getInstructions()).toBe(facadeAgentInstructions(env));
  expect(client.getServerVersion()).toEqual({
    name: "stagehand",
    version: "0.1.0",
  });
  expect(mocks.localLaunch).not.toHaveBeenCalled();
  expect(mocks.cloudLaunch).not.toHaveBeenCalled();
});

it("reuses one middleware instance for code, actions, snapshots, and screenshots", async () => {
  const { client, host } = await connect();
  expect(
    await client.callTool({ name: "run", arguments: { code: "return 42;" } }),
  ).toMatchObject({
    content: [{ type: "text", text: '{"answer":42}' }],
  });
  await client.callTool({
    name: "run",
    arguments: { actions: [{ op: "click", id: "1-42" }] },
  });
  expect(
    await client.callTool({
      name: "snapshot",
      arguments: { includeIframes: false },
    }),
  ).toMatchObject({ content: [{ text: "heading: Example" }] });
  expect(
    await client.callTool({ name: "screenshot", arguments: { type: "png" } }),
  ).toMatchObject({
    content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
  });
  expect(mocks.localLaunch).toHaveBeenCalledTimes(1);
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.construct).toHaveBeenCalledTimes(1);
  expect(mocks.run).toHaveBeenCalledWith("return 42;");
  expect(mocks.runActions).toHaveBeenCalledWith([{ op: "click", id: "1-42" }]);
  expect(mocks.snapshot).toHaveBeenCalledWith({ includeIframes: false });
  expect(mocks.screenshot).toHaveBeenCalledWith({ type: "png" });
  await Promise.all([host.close(), host.close()]);
  expect(mocks.closeTools).toHaveBeenCalledTimes(1);
});

it("validates middleware inputs and unknown tools before launching", async () => {
  const { client } = await connect();
  expect(
    await client.callTool({
      name: "run",
      arguments: { code: "return 42;", actions: [] },
    }),
  ).toMatchObject({ isError: true });
  expect(await client.callTool({ name: "missing" })).toMatchObject({
    isError: true,
  });
  expect(mocks.localLaunch).not.toHaveBeenCalled();
});

it("uses middleware cloud configuration with the Browserbase launcher", async () => {
  const { client } = await connect({
    STAGEHAND_BROWSER: "browserbase",
    BROWSERBASE_API_KEY: "test-browserbase-key",
  });
  await client.callTool({ name: "snapshot" });
  expect(mocks.cloudLaunch).toHaveBeenCalledWith(
    expect.objectContaining({ apiKey: "test-browserbase-key" }),
  );
  expect(mocks.localLaunch).not.toHaveBeenCalled();
});

it("cleans up failed initialization, redacts credentials, and allows a retry", async () => {
  const key = "test-browserbase-key";
  mocks.create.mockRejectedValueOnce(
    new Error(`Initialization failed with ${key}`),
  );
  const { client } = await connect({
    STAGEHAND_BROWSER: "local",
    BROWSERBASE_API_KEY: key,
  });
  const failed = await client.callTool({ name: "snapshot" });
  expect(failed).toMatchObject({
    isError: true,
    content: [{ text: "Initialization failed with [redacted]" }],
  });
  expect(mocks.closeBrowser).toHaveBeenCalledTimes(1);
  expect(await client.callTool({ name: "snapshot" })).not.toHaveProperty(
    "isError",
    true,
  );
  expect(mocks.localLaunch).toHaveBeenCalledTimes(2);
});
