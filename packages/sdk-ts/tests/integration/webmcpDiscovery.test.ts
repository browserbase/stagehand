import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import type { PageEventNotification } from "@browserbasehq/stagehand-protocol/types";
import { WebMCPTool, type Stagehand, type WebMCPToolIdentity } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

const fixture = `<!doctype html><title>WebMCP discovery</title>
<script>
  const modelContext = document.modelContext ?? navigator.modelContext;
  const controllers = new Map();
  window.registerTool = (name) => {
    const controller = new AbortController();
    controllers.set(name, controller);
    modelContext.registerTool({
      name,
      description: name,
      inputSchema: { type: "object", properties: { searchQuery: { type: "string" } } },
      execute: ({ searchQuery }) => ({ content: [{ type: "text", text: searchQuery }] }),
    }, { signal: controller.signal });
  };
  window.removeTool = (name) => controllers.get(name).abort();
  if (location.pathname === "/registered") registerTool("initial");
</script>`;

describe("WebMCP shared discovery", () => {
  let stagehand: Stagehand;
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startFixtureServer({ "/": fixture, "/registered": fixture });
    stagehand = await createStagehand({ browser: { args: ["--enable-blink-features=WebMCP"] } });
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await server?.close();
  });

  it("keeps callable snapshots current across registration, removal, navigation, and iframe adoption", async () => {
    const page = await firstPage(stagehand);
    await page.goto(server.url, { waitUntil: "load" });
    await expect(page.tools({ timeout: 0 })).resolves.toEqual([]);

    await page.evaluate('window.registerTool("search")');
    const [first, second] = await Promise.all([page.tools(), page.tools()]);
    expect(first.map((tool) => tool.name)).toEqual(["search"]);
    expect(second.map((tool) => tool.name)).toEqual(["search"]);
    expect(first[0]!.inputSchema).toMatchObject({
      properties: { searchQuery: { type: "string" } },
    });
    const invocation = await first[0]!.invoke({ input: { searchQuery: "shared state" } });
    await expect(invocation.result()).resolves.toMatchObject({
      status: "Completed",
      output: { content: [{ type: "text", text: "shared state" }] },
    });

    await page.evaluate('location.hash = "same-document"');
    expect((await page.tools()).map((tool) => tool.name)).toEqual(["search"]);
    await page.evaluate('window.removeTool("search")');
    await expect(page.tools()).resolves.toEqual([]);
    await page.evaluate('window.registerTool("search")');
    expect((await page.tools()).map((tool) => tool.name)).toEqual(["search"]);

    await page.goto(new URL("registered", server.url).href, { waitUntil: "load" });
    expect((await page.tools()).map((tool) => tool.name)).toEqual(["initial"]);
    const childUrl = new URL("registered", server.url);
    childUrl.hostname = "localhost";
    await page.evaluate(
      (url) =>
        new Promise<void>((resolve) => {
          const iframe = document.createElement("iframe");
          iframe.allow = "tools *";
          iframe.src = url;
          iframe.onload = () => resolve();
          document.body.append(iframe);
        }),
      childUrl.href,
    );
    let tools = await page.tools();
    await expect
      .poll(async () => {
        tools = await page.tools();
        return tools.length;
      })
      .toBe(2);
    expect(new Set(tools.map((tool) => tool.frameId)).size).toBe(2);
    expect(tools.map((tool) => tool.name)).toEqual(["initial", "initial"]);
    await page.evaluate(() => document.querySelector("iframe")!.remove());
    await expect.poll(async () => (await page.tools()).length).toBe(1);
    await page.goto(server.url, { waitUntil: "load" });
    await expect(page.tools()).resolves.toEqual([]);
  });

  it("delivers future-only typed notifications through the runtime RPC", async () => {
    const page = await firstPage(stagehand);
    await page.goto(new URL("registered", server.url).href, { waitUntil: "load" });
    const events: PageEventNotification[] = [];
    const removeListener = page.rpcClient.onNotification((notification) => {
      if (notification.method === StagehandNotifications.pageEvent.name)
        events.push(notification.params);
    });
    const subscribe = (subscriptionId: string, event: "toolsadded" | "toolsremoved") =>
      page.rpcClient.send(StagehandMethods.pageOn, { pageId: page.pageId, subscriptionId, event });
    const unsubscribe = (subscriptionId: string) =>
      page.rpcClient.send(StagehandMethods.pageOff, { subscriptionId });
    try {
      await subscribe("added", "toolsadded");
      await subscribe("removed", "toolsremoved");
      const initial = await page.tools();
      expect(initial.map((tool) => tool.name)).toEqual(["initial"]);
      expect(events).toEqual([]);

      await page.evaluate('window.registerTool("live")');
      await expect.poll(() => events.length).toBe(1);
      expect(events[0]).toMatchObject({
        event: "toolsadded",
        subscriptionId: "added",
        pageId: page.pageId,
        tools: [
          {
            name: "live",
            frameId: initial[0]!.frameId,
            inputSchema: { properties: { searchQuery: { type: "string" } } },
          },
        ],
      });
      await subscribe("second-added", "toolsadded");
      await Promise.all([page.tools(), page.tools()]);
      expect(events).toHaveLength(1);
      await page.evaluate('location.hash = "same-document"');
      await page.tools();
      expect(events).toHaveLength(1);

      await page.evaluate('window.removeTool("live")');
      await expect.poll(() => events.length).toBe(2);
      expect(events[1]).toMatchObject({
        event: "toolsremoved",
        subscriptionId: "removed",
        tools: [{ name: "live", frameId: initial[0]!.frameId }],
      });
      await page.evaluate('window.registerTool("live")');
      await expect.poll(() => events.length).toBe(4);
      expect(events.slice(2).map((event) => event.subscriptionId)).toEqual([
        "added",
        "second-added",
      ]);

      await page.goto(server.url, { waitUntil: "load" });
      await page.tools();
      expect(
        events
          .slice(4)
          .flatMap((event) => event.tools.map((tool) => tool.name))
          .sort((a, b) => a.localeCompare(b)),
      ).toEqual(["initial", "live"]);
      expect(events.slice(4).every((event) => event.event === "toolsremoved")).toBe(true);

      events.length = 0;
      const childUrl = new URL("registered", server.url);
      childUrl.hostname = "localhost";
      await page.evaluate(
        (url) =>
          new Promise<void>((resolve) => {
            const iframe = document.createElement("iframe");
            iframe.allow = "tools *";
            iframe.src = url;
            iframe.onload = () => resolve();
            document.body.append(iframe);
          }),
        childUrl.href,
      );
      await expect.poll(() => events.length).toBe(2);
      const childEvent = events[0]!;
      expect(childEvent).toMatchObject({ event: "toolsadded", tools: [{ name: "initial" }] });
      expect(childEvent.tools[0]!.frameId).not.toBe(initial[0]!.frameId);
      await page.evaluate(() => document.querySelector("iframe")!.remove());
      await expect.poll(() => events.length).toBe(3);
      expect(events[2]).toEqual({
        subscriptionId: "removed",
        event: "toolsremoved",
        pageId: page.pageId,
        sessionId: childEvent.sessionId,
        targetId: childEvent.targetId,
        tools: [{ name: "initial", frameId: childEvent.tools[0]!.frameId }],
      });
      await unsubscribe("added");
      await unsubscribe("second-added");
      await page.evaluate('window.registerTool("after-unsubscribe")');
      await page.tools();
      expect(events).toHaveLength(3);
    } finally {
      await Promise.all(["added", "second-added", "removed"].map(unsubscribe));
      removeListener();
    }
  });

  it("invokes event-delivered tools through the public hooks without blocking responses", async () => {
    const page = await firstPage(stagehand);
    await page.goto(server.url, { waitUntil: "load" });
    const removed: WebMCPToolIdentity[] = [];
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise((resolveResult, rejectResult) => {
      resolve = resolveResult;
      reject = rejectResult;
    });
    const addedSubscription = await page.onToolsAdded(async (tools) => {
      try {
        expect(tools[0]).toBeInstanceOf(WebMCPTool);
        const invocation = await tools[0]!.invoke({ input: { searchQuery: "from callback" } });
        resolve(await invocation.result({ timeout: 5_000 }));
      } catch (error) {
        reject(error);
      }
    });
    const removedSubscription = await page.onToolsRemoved((tools) => removed.push(...tools));
    try {
      await page.evaluate('window.registerTool("callback-tool")');
      await expect(result).resolves.toMatchObject({
        status: "Completed",
        output: { content: [{ type: "text", text: "from callback" }] },
      });
      const [tool] = await page.tools();
      await page.evaluate('window.removeTool("callback-tool")');
      await expect.poll(() => removed).toEqual([{ name: "callback-tool", frameId: tool!.frameId }]);
    } finally {
      await addedSubscription.unsubscribe();
      await removedSubscription.unsubscribe();
    }
  });
});
