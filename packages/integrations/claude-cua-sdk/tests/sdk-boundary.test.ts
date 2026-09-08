import { BrowserContext, type Stagehand } from "@browserbasehq/stagehand";
import { StagehandFacadeTools } from "@browserbasehq/stagehand-integrations/facade";
import { describe, expect, it } from "vitest";
import { StagehandCuaExecutor, type CuaFacadeTools } from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };

function sdkFacade(options: { missingPageIds?: boolean } = {}) {
  const calls: Array<{ method: string; params: unknown }> = [];
  let activeId = "p1";
  const urls = new Map([
    ["p1", "https://example.com/p1"],
    ["p2", "about:blank"],
  ]);
  let nextPage = 0;
  const context = new BrowserContext({
    send: async (method, params) => {
      const parsed = method.params.parse(params);
      calls.push({ method: method.name, params: parsed });
      switch (method.name) {
        case "context.pages":
          return [...urls.keys()].map((pageId) => ({
            pageId: options.missingPageIds ? "" : pageId,
          })) as never;
        case "context.new_page": {
          const pageId = ++nextPage === 1 ? "keeper" : `new-${nextPage}`;
          urls.set(pageId, (parsed as { url?: string }).url ?? "about:blank");
          return { pageId } as never;
        }
        case "page.close":
          urls.delete((parsed as { pageId: string }).pageId);
          return { ok: true } as never;
        case "page.evaluate":
          return { width: 1280, height: 720 } as never;
        case "context.active_page":
          return { pageId: activeId } as never;
        case "context.set_active_page":
          activeId = (parsed as { pageId: string }).pageId;
          return { ok: true } as never;
        case "page.url":
          return urls.get((parsed as { pageId: string }).pageId) as never;
        case "page.title":
          return "Example" as never;
        case "page.click":
        case "page.drag_and_drop":
          return { ok: true } as never;
        default:
          throw new Error(`unexpected RPC ${method.name}`);
      }
    },
    onNotification: () => () => {},
  });
  const facade = new StagehandFacadeTools({
    browser: { context },
    experimentalBatch: async (
      callback: (batch: unknown, input: unknown) => Promise<unknown>,
      input: unknown,
      options: { page?: unknown },
    ) => callback({ page: options.page ?? (await context.activePage()), context }, input),
  } as unknown as Stagehand);
  const tools: CuaFacadeTools = {
    run: facade.run.bind(facade),
    runActions: async () => {
      urls.set(activeId, `https://example.com/${activeId}/clicked`);
      return { url: urls.get(activeId)!, results: [] } as never;
    },
    snapshot: async () => '[0-1] button "Open"',
    screenshot: async () => {
      throw new Error("unexpected screenshot");
    },
  };
  return { calls, urls, executor: new StagehandCuaExecutor({ tools, logger }) };
}

describe("CUA SDK Page boundary", () => {
  it("executes the complete drag through the real SDK Page and validates its RPC input", async () => {
    const { calls, executor } = sdkFacade();
    const result = await executor.execute(
      "left_click_drag",
      {
        from: { type: "coordinate", x: 10, y: 20 },
        target: { type: "coordinate", x: 90, y: 80 },
      },
      { toolUseId: "drag" },
    );

    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(calls.filter((call) => call.method === "page.drag_and_drop")).toEqual([
      {
        method: "page.drag_and_drop",
        params: { pageId: "p1", fromX: 10, fromY: 20, toX: 90, toY: 80, options: { steps: 2 } },
      },
    ]);
  });
  it("honors tab_id before a coordinate action instead of clicking the active tab", async () => {
    const { calls, executor } = sdkFacade();
    const result = await executor.execute(
      "left_click",
      {
        tab_id: "p2",
        target: { type: "coordinate", x: 10, y: 20 },
      },
      { toolUseId: "target-tab" },
    );
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(calls.filter((call) => call.method === "page.click")).toEqual([
      {
        method: "page.click",
        params: { pageId: "p2", x: 10, y: 20, options: { button: "left", clickCount: 1 } },
      },
    ]);
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "browser_state",
        tabs: expect.arrayContaining([
          expect.objectContaining({ tab_id: "p1", active: false }),
          expect.objectContaining({ tab_id: "p2", active: true }),
        ]),
      }),
    );
  });

  it("rejects an unknown tab before executing an action", async () => {
    const { calls, executor } = sdkFacade();
    const result = await executor.execute(
      "left_click",
      {
        tab_id: "missing",
        target: { type: "coordinate", x: 10, y: 20 },
      },
      { toolUseId: "missing-tab" },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown tab_id "missing"');
    expect(calls.some((call) => call.method === "page.click")).toBe(false);
  });

  it("rejects unsupported modifier clicks before forwarding invalid SDK options", async () => {
    const { calls, executor } = sdkFacade();
    const result = await executor.execute(
      "left_click",
      {
        target: { type: "coordinate", x: 10, y: 20 },
        modifiers: "shift",
      },
      { toolUseId: "modifier-click" },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("modifier clicks are not available");
    expect(calls).toEqual([]);
  });
});

describe("CUA visible facade tab boundary", () => {
  it("fails descriptively when the host cannot supply stable visible page IDs", async () => {
    const { executor } = sdkFacade({ missingPageIds: true });
    const result = await executor.execute("list_tabs", {}, { toolUseId: "missing-id" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("missing a stable pageId");
  });

  it("lists real visible IDs, including a legitimate blank page, without the keeper", async () => {
    const { executor } = sdkFacade();
    const result = await executor.execute("list_tabs", {}, { toolUseId: "tabs" });
    expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
    expect(result.content).toContainEqual({
      type: "browser_state",
      tabs: [
        { tab_id: "p1", title: "Example", url: "https://example.com/p1", active: true },
        { tab_id: "p2", title: "Example", url: "about:blank", active: false },
      ],
    });
    for (const member of ["switch_tab", "close_tab"]) {
      const hidden = await executor.execute(member, { tab_id: "keeper" }, { toolUseId: member });
      expect(hidden.isError).toBe(true);
      expect(hidden.content).toContain('Unknown tab_id "keeper"');
    }
  });

  it("cannot close the last visible page even when a keeper remains", async () => {
    const { executor, urls } = sdkFacade();
    await executor.execute("close_tab", { tab_id: "p2" }, { toolUseId: "close-p2" });
    const result = await executor.execute("close_tab", { tab_id: "p1" }, { toolUseId: "close-p1" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Cannot close the last remaining tab");
    expect([...urls.keys()]).toEqual(["p1", "keeper"]);
  });

  it("creates, selects and closes a visible tab with stable active identity", async () => {
    const { executor } = sdkFacade();
    const created = await executor.execute("new_tab", {}, { toolUseId: "new" });
    expect(created.content).toContainEqual(
      expect.objectContaining({
        type: "browser_state",
        tabs: [
          expect.objectContaining({ tab_id: "p1", active: false }),
          expect.objectContaining({ tab_id: "p2", active: false }),
          expect.objectContaining({ tab_id: "new-2", active: true }),
        ],
      }),
    );
    const closed = await executor.execute("close_tab", { tab_id: "new-2" }, { toolUseId: "close" });
    expect(closed.content).toContainEqual(
      expect.objectContaining({
        type: "browser_state",
        tabs: expect.arrayContaining([
          expect.objectContaining({ tab_id: "p1", active: false }),
          expect.objectContaining({ tab_id: "p2", active: true }),
        ]),
      }),
    );
    const selected = await executor.execute(
      "switch_tab",
      { tab_id: "p1" },
      { toolUseId: "select" },
    );
    expect(selected.content).toContainEqual(
      expect.objectContaining({
        type: "browser_state",
        tabs: expect.arrayContaining([
          expect.objectContaining({ tab_id: "p1", active: true }),
          expect.objectContaining({ tab_id: "p2", active: false }),
        ]),
      }),
    );
  });

  it("reports a real tab ID for a first ref action following read_page", async () => {
    const { executor } = sdkFacade();
    await executor.execute("read_page", {}, { toolUseId: "read" });
    const result = await executor.execute(
      "left_click",
      { target: { type: "ref", ref: "0-1" } },
      { toolUseId: "ref" },
    );
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "browser_state",
        tabs: [
          expect.objectContaining({
            tab_id: "p1",
            active: true,
            url: "https://example.com/p1/clicked",
          }),
          expect.objectContaining({ tab_id: "p2", active: false, url: "about:blank" }),
        ],
      }),
    );
  });

  it("refreshes cached active identity when a ref action explicitly selects another tab", async () => {
    const { executor } = sdkFacade();
    await executor.execute("list_tabs", {}, { toolUseId: "tabs" });
    const result = await executor.execute(
      "left_click",
      { tab_id: "p2", target: { type: "ref", ref: "0-1" } },
      { toolUseId: "ref" },
    );
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "browser_state",
        tabs: [
          expect.objectContaining({ tab_id: "p1", active: false, url: "https://example.com/p1" }),
          expect.objectContaining({
            tab_id: "p2",
            active: true,
            url: "https://example.com/p2/clicked",
          }),
        ],
      }),
    );
  });
});
