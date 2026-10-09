import type { Action, ActResult, ObserveResult } from "@browserbasehq/stagehand-protocol/types";
import { describe, expect, it } from "vitest";
import * as nav from "../src/navigationGraph.js";
import type { Page } from "../src/page.js";

type Screen = { url: string; tree: string };

const metadata = {} as ActResult["metadata"];
const screens = {
  home: { url: "https://shop.test/#top", tree: "[0-1] RootWebArea: Home\n  [0-2] link: Login" },
  login: { url: "https://shop.test/login", tree: "[0-1] RootWebArea: Login\n  [0-3] button: Back" },
  menu: { url: "https://shop.test/", tree: "[0-1] RootWebArea: Home\n  [0-9] menu: Account" },
} satisfies Record<string, Screen>;
const toLogin: Action = { selector: "#login", description: "Open login", method: "click" };
const toHome: Action = { selector: "#back", description: "Go back home", method: "click" };

/** A page whose state changes only through deterministic actions; string instructions mean inference. */
function fakeSite(start: Screen, transitions: Map<string, Screen> = new Map()) {
  let screen = start;
  const actCalls: Action[] = [];
  const page = {
    url: async () => screen.url,
    snapshot: async () => ({ formattedTree: screen.tree, xpathMap: {}, urlMap: {} }),
  } as unknown as Page;
  const stagehand = {
    act: async (instruction: string | Action): Promise<ActResult> => {
      if (typeof instruction === "string") throw new Error("inference is not allowed in replay");
      actCalls.push(instruction);
      const next = transitions.get(instruction.selector);
      if (next) screen = next;
      return actResult(next !== undefined, next ? [instruction] : []);
    },
  };
  return { page, stagehand, actCalls, show: (next: Screen) => (screen = next) };
}

function actResult(success: boolean, actions: Action[]): ActResult {
  return { data: { success, message: "", actionDescription: "", actions }, metadata };
}

function observeResult(actions: Action[]): ObserveResult {
  return { data: actions, metadata } as ObserveResult;
}

async function homeLoginGraph() {
  const site = fakeSite(screens.home);
  const graph = nav.create();
  const home = await nav.recordState(graph, site.page);
  if (home.status !== "matched") throw new Error("home was not recorded");
  site.show(screens.login);
  const login = await nav.recordAct(graph, {
    page: site.page,
    from: home.nodeId,
    result: actResult(true, [toLogin]),
  });
  if (login.status !== "matched") throw new Error("login was not recorded");
  site.show(screens.home);
  await nav.recordAct(graph, { page: site.page, from: login.nodeId, result: actResult(false, []) });
  return { graph, home: home.nodeId, login: login.nodeId };
}

describe("experimental navigation graph", () => {
  it("R1: merges revisited states and round-trips through JSON", async () => {
    const { graph, home } = await homeLoginGraph();
    await nav.recordState(graph, fakeSite(screens.home).page);
    nav.recordObserve(graph, { nodeId: home, result: observeResult([toLogin, toHome, toHome]) });

    expect(graph.nodes).toHaveLength(2);
    expect(nav.frontier(graph, home)).toEqual([toHome]);
    expect(nav.fromJSON(nav.toJSON(graph))).toEqual(graph);
    expect(() => nav.fromJSON('{"nodes":[],"edges":[{"from":"a"}]}')).toThrow();
    expect(() => nav.frontier(graph, "missing")).toThrow("Unknown navigation graph node: missing");
  });

  it("R2: recognizes states as matched, unknown, or ambiguous", async () => {
    const { graph, home } = await homeLoginGraph();
    const site = fakeSite({ ...screens.home, tree: screens.home.tree.replace("0-2", "7-42") });

    await expect(nav.recognize(graph, site.page)).resolves.toEqual({
      status: "matched",
      nodeId: home,
    });
    site.show(screens.menu);
    await expect(nav.recognize(graph, site.page)).resolves.toEqual({ status: "unknown" });
    graph.nodes.push({ ...graph.nodes[0]!, id: "copy" });
    site.show(screens.home);
    await expect(nav.recognize(graph, site.page)).resolves.toEqual({
      status: "ambiguous",
      nodeIds: [home, "copy"],
    });
    const blank = fakeSite({ url: "about:blank", tree: "" });
    const blankNode = await nav.recordState(graph, blank.page);
    await expect(nav.recordState(graph, blank.page)).resolves.toEqual(blankNode);
  });

  it("R3: records edges only for successful acts and consumes tried frontier actions", async () => {
    const site = fakeSite(screens.home);
    const graph = nav.create();
    const home = await nav.recordState(graph, site.page);
    if (home.status !== "matched") throw new Error("home was not recorded");
    nav.recordObserve(graph, { nodeId: home.nodeId, result: observeResult([toLogin]) });

    await nav.recordAct(graph, {
      page: site.page,
      from: home.nodeId,
      result: actResult(false, []),
    });
    expect(graph.edges).toEqual([]);
    site.show(screens.login);
    const login = await nav.recordAct(graph, {
      page: site.page,
      from: home.nodeId,
      result: actResult(true, [toLogin]),
    });
    await nav.recordAct(graph, {
      page: site.page,
      from: home.nodeId,
      result: actResult(true, [toLogin]),
    });

    expect(login).toEqual({ status: "matched", nodeId: "node-1" });
    expect(graph.edges).toEqual([{ from: home.nodeId, to: "node-1", actions: [toLogin] }]);
    expect(nav.frontier(graph, home.nodeId)).toEqual([]);

    graph.nodes.push({ ...graph.nodes[1]!, id: "copy" });
    await expect(
      nav.recordAct(graph, {
        page: site.page,
        from: home.nodeId,
        result: actResult(true, [toHome]),
      }),
    ).resolves.toMatchObject({ status: "ambiguous" });
    expect(graph.edges).toHaveLength(1);
  });

  it("R4: plans a backward path over recorded edges", async () => {
    const { graph, home, login } = await homeLoginGraph();
    await nav.recordAct(graph, {
      page: fakeSite(screens.home).page,
      from: login,
      result: actResult(true, [toHome]),
    });

    expect(nav.findPath(graph, login, home)?.map((edge) => edge.actions)).toEqual([[toHome]]);
    expect(nav.findPath(graph, home, home)).toEqual([]);
    expect(nav.findPath(nav.create(), home, login)).toBeUndefined();
  });

  it("R5: replays a path with act(action) only and stops on divergence", async () => {
    const { graph, home, login } = await homeLoginGraph();
    const path = nav.findPath(graph, home, login)!;
    const site = fakeSite(screens.home, new Map([[toLogin.selector, screens.login]]));

    await expect(nav.replay(graph, { ...site, path })).resolves.toEqual({ status: "completed" });
    expect(site.actCalls).toEqual([toLogin]);

    const wrongStart = fakeSite(screens.menu);
    await expect(nav.replay(graph, { ...wrongStart, path })).resolves.toEqual({
      status: "diverged",
      step: 0,
      expectedNodeId: home,
      actual: { status: "unknown" },
    });
    expect(wrongStart.actCalls).toEqual([]);

    const brokenSelector = fakeSite(screens.home);
    await expect(nav.replay(graph, { ...brokenSelector, path })).resolves.toEqual({
      status: "failed",
      step: 0,
      message: "",
    });

    const wrongTarget = fakeSite(screens.home, new Map([[toLogin.selector, screens.menu]]));
    await expect(nav.replay(graph, { ...wrongTarget, path })).resolves.toEqual({
      status: "diverged",
      step: 1,
      expectedNodeId: login,
      actual: { status: "unknown" },
    });
    await expect(nav.replay(graph, { ...wrongTarget, path: [] })).resolves.toEqual({
      status: "completed",
    });
  });
});
