import { describe, expect, it, vi } from "vitest";
import {
  createAgentIndicatorController,
  type AgentIndicatorChrome,
} from "../agentIndicatorController.ts";

function createChromeApi() {
  let updatedListener:
    | ((tabId: number, changeInfo: { status?: string }, tab: unknown) => void)
    | undefined;
  const query = vi.fn<AgentIndicatorChrome["tabs"]["query"]>(async () => [
    { id: 12 },
    {},
    { id: 34 },
  ]);
  const insertCSS = vi.fn<AgentIndicatorChrome["scripting"]["insertCSS"]>(async (_injection) => {});
  const removeCSS = vi.fn<AgentIndicatorChrome["scripting"]["removeCSS"]>(async (_injection) => {});
  const chromeApi: AgentIndicatorChrome = {
    scripting: { insertCSS, removeCSS },
    tabs: {
      query,
      onUpdated: {
        addListener(listener) {
          updatedListener = listener;
        },
      },
    },
  };
  return {
    chromeApi,
    insertCSS,
    query,
    removeCSS,
    update: (tabId: number, status: "loading" | "complete") =>
      updatedListener?.(tabId, { status }, {}),
  };
}

describe("agent indicator controller", () => {
  it("injects and removes the same user-origin stylesheet in every tab", async () => {
    const { chromeApi, insertCSS, query, removeCSS } = createChromeApi();
    const controller = createAgentIndicatorController(chromeApi);

    await controller.setActive(true);

    expect(query).toHaveBeenCalledWith({});
    expect(insertCSS).toHaveBeenCalledTimes(2);
    const firstInjection = insertCSS.mock.calls[0]![0];
    expect(firstInjection).toMatchObject({
      target: { tabId: 12 },
      origin: "USER",
      css: expect.stringContaining(":root::after"),
    });
    expect(firstInjection.css).toContain("position: fixed !important");
    expect(firstInjection.css).toContain("pointer-events: none !important");
    expect(firstInjection.css).toContain("stagehand-agent-indicator-wave");
    expect(firstInjection.css).toContain("prefers-reduced-motion: reduce");

    await controller.setActive(false);

    expect(removeCSS.mock.calls).toStrictEqual([
      [firstInjection],
      [{ ...firstInjection, target: { tabId: 34 } }],
    ]);
  });

  it("serializes rapid transitions so stale activation is skipped", async () => {
    const { chromeApi, insertCSS, query, removeCSS } = createChromeApi();
    let resolveFirstQuery: ((tabs: Array<{ id?: number }>) => void) | undefined;
    query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirstQuery = resolve;
        }),
    );
    const controller = createAgentIndicatorController(chromeApi);

    const activate = controller.setActive(true);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    const deactivate = controller.setActive(false);
    resolveFirstQuery?.([{ id: 12 }]);
    await Promise.all([activate, deactivate]);

    expect(insertCSS).not.toHaveBeenCalled();
    expect(removeCSS).toHaveBeenCalledTimes(2);
  });

  it("reapplies after navigation only while active", async () => {
    const { chromeApi, insertCSS, update } = createChromeApi();
    const controller = createAgentIndicatorController(chromeApi);

    update(12, "loading");
    await Promise.resolve();
    expect(insertCSS).not.toHaveBeenCalled();

    await controller.setActive(true);
    insertCSS.mockClear();
    update(12, "loading");
    await vi.waitFor(() => expect(insertCSS).toHaveBeenCalledTimes(1));

    update(12, "complete");
    await Promise.resolve();
    expect(insertCSS).toHaveBeenCalledTimes(1);

    await controller.setActive(false);
    insertCSS.mockClear();
    update(12, "loading");
    await Promise.resolve();
    expect(insertCSS).not.toHaveBeenCalled();
  });

  it("reapplies when navigation overlaps an in-flight insertion", async () => {
    const { chromeApi, insertCSS, query, update } = createChromeApi();
    query.mockResolvedValue([{ id: 12 }]);
    let resolveInsertion: (() => void) | undefined;
    insertCSS.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveInsertion = resolve;
        }),
    );
    const controller = createAgentIndicatorController(chromeApi);

    const activation = controller.setActive(true);
    await vi.waitFor(() => expect(insertCSS).toHaveBeenCalledTimes(1));
    update(12, "loading");
    update(12, "complete");
    resolveInsertion?.();
    await activation;

    await vi.waitFor(() => expect(insertCSS).toHaveBeenCalledTimes(2));
  });

  it("ignores restricted-tab failures", async () => {
    const { chromeApi, insertCSS } = createChromeApi();
    insertCSS.mockRejectedValueOnce(new Error("Cannot access a chrome:// URL"));
    const controller = createAgentIndicatorController(chromeApi);

    await expect(controller.setActive(true)).resolves.toBeUndefined();
    expect(insertCSS).toHaveBeenCalledTimes(2);
  });

  it("retries the same state after a tab query failure", async () => {
    const { chromeApi, insertCSS, query } = createChromeApi();
    query.mockRejectedValueOnce(new Error("temporary tabs.query failure"));
    const controller = createAgentIndicatorController(chromeApi);

    await expect(controller.setActive(true)).rejects.toThrow("temporary tabs.query failure");
    await expect(controller.setActive(true)).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(2);
    expect(insertCSS).toHaveBeenCalledTimes(2);
  });

  it("removes cached indicators when the deactivation tab query fails", async () => {
    const { chromeApi, query, removeCSS } = createChromeApi();
    const controller = createAgentIndicatorController(chromeApi);
    await controller.setActive(true);
    query.mockRejectedValueOnce(new Error("temporary tabs.query failure"));

    await expect(controller.setActive(false)).resolves.toBeUndefined();

    expect(removeCSS).toHaveBeenCalledTimes(2);
    expect(removeCSS.mock.calls.map(([injection]) => injection.target.tabId)).toStrictEqual([
      12, 34,
    ]);
  });
});
