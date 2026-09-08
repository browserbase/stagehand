import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
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
});
