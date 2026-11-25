import type { Protocol } from "devtools-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import type { CDPSessionLike } from "./cdp.js";
import { Progress } from "./progress.js";
import { queryNativeRoles, type NativeRoleQuery } from "./roleQuery.js";

function node(
  id: number,
  name = "Save",
  properties: Protocol.Accessibility.AXProperty[] = [],
): Protocol.Accessibility.AXNode {
  return {
    nodeId: String(id),
    backendDOMNodeId: id,
    ignored: false,
    role: { type: "role", value: "button" },
    name: { type: "string", value: name },
    properties,
  };
}

function setup(nodes = [node(1)]) {
  const events = new Map<string, Set<(event: unknown) => void>>();
  const groups = new Set<string>();
  const respond = async (method: string, params?: object): Promise<unknown> => {
    if (method === "Runtime.evaluate") {
      groups.add((params as { objectGroup: string }).objectGroup);
      return { result: { type: "object", objectId: "document" } };
    }
    if (method === "Accessibility.queryAXTree") return { nodes };
    if (method === "Runtime.releaseObjectGroup")
      groups.delete((params as { objectGroup: string }).objectGroup);
    return {};
  };
  const send = vi.fn(respond);
  const session: CDPSessionLike = {
    id: "session",
    send: send as CDPSessionLike["send"],
    on(event, handler) {
      if (!events.has(event)) events.set(event, new Set());
      events.get(event)!.add(handler);
    },
    off(event, handler) {
      events.get(event)?.delete(handler);
    },
    async close() {},
  };
  return {
    session,
    send,
    respond,
    groups,
    emit: (event: string, value = {}) => events.get(event)?.forEach((handler) => handler(value)),
    listeners: () => [...events.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

describe("native role queries", () => {
  let progress: Progress;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    progress = new Progress("role query", 100);
  });
  afterEach(() => {
    progress.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("queries the supplied document context without native name filtering & releases it", async () => {
    const state = setup([node(1, "  Save\n report  "), node(2, "Other")]);
    expect(
      await queryNativeRoles(state.session, 42, { role: "button", name: "save REPORT" }, progress),
    ).toEqual([node(1, "  Save\n report  ")]);
    expect(state.send.mock.calls.map(([method]) => method)).toEqual([
      "Runtime.evaluate",
      "Accessibility.queryAXTree",
      "Runtime.releaseObjectGroup",
    ]);
    expect(state.send.mock.calls[0][1]).toMatchObject({ expression: "document", contextId: 42 });
    expect(state.send.mock.calls[1][1]).toEqual({ objectId: "document", role: "button" });
    expect(state.groups.size).toBe(0);
    expect(state.listeners()).toBe(0);
  });

  it.each([
    { name: "Save report", exact: true, ids: [1] },
    { name: "save report", exact: true, ids: [] },
    { name: "report", ids: [1, 2] },
    { name: "", exact: true, ids: [3] },
  ])("matches normalized names: $name / $exact", async ({ ids, ...options }) => {
    const { session } = setup([
      node(1, " Save\u00a0 re\u200bport "),
      node(2, "Reports"),
      node(3, ""),
    ]);
    const matches = await queryNativeRoles(session, 1, { role: "button", ...options }, progress);
    expect(matches.map((match) => match.backendDOMNodeId)).toEqual(ids);
  });

  it.each([
    ["img", ["img", "image"]],
    ["directory", ["directory", "list"]],
  ] as const)("accepts native aliases for %s in one AX call", async (role, aliases) => {
    const state = setup(
      [...aliases, "button"].map((value, index) => ({
        ...node(index + 1),
        role: { type: "role" as const, value },
      })),
    );
    expect(await queryNativeRoles(state.session, 1, { role }, progress)).toHaveLength(2);
    expect(
      state.send.mock.calls.filter(([method]) => method === "Accessibility.queryAXTree"),
    ).toEqual([["Accessibility.queryAXTree", { objectId: "document" }]]);
  });

  it("excludes ignored nodes, other roles & nodes without DOM identities", async () => {
    const { session } = setup([
      node(1),
      { ...node(2), ignored: true },
      { ...node(3), backendDOMNodeId: undefined },
      { ...node(4), role: { type: "role", value: "StaticText" } },
    ]);
    expect(await queryNativeRoles(session, 1, { role: "button" }, progress)).toEqual([node(1)]);
  });

  it.each([
    ["checked", "true", true, true],
    ["checked", "false", false, true],
    ["checked", "mixed", "mixed", true],
    ["checked", "mixed", false, false],
    ["pressed", "mixed", "mixed", true],
    ["pressed", undefined, false, false],
    ["checked", undefined, false, false],
    ["selected", true, true, true],
    ["selected", false, false, true],
    ["selected", undefined, false, false],
    ["expanded", false, false, true],
    ["expanded", undefined, false, false],
    ["disabled", undefined, false, true],
    ["disabled", true, true, true],
    ["disabled", true, false, false],
    ["level", 3, 3, true],
    ["level", "3", 3, false],
  ] as const)("filters %s=%s against %s", async (property, value, expected, matches) => {
    const properties: Protocol.Accessibility.AXProperty[] =
      value === undefined ? [] : [{ name: property, value: { type: "computedString", value } }];
    const { session } = setup([node(1, "Save", properties)]);
    const query: NativeRoleQuery = { role: "button", [property]: expected };
    expect(await queryNativeRoles(session, 1, query, progress)).toHaveLength(matches ? 1 : 0);
  });

  it("combines filters & reads fresh results on every call", async () => {
    const nodes = [
      node(1, "Save", [
        { name: "pressed", value: { type: "tristate", value: "true" } },
        { name: "disabled", value: { type: "boolean", value: true } },
      ]),
    ];
    const { session, send } = setup(nodes);
    const query = { role: "button", pressed: true, disabled: true };
    expect(await queryNativeRoles(session, 1, query, progress)).toHaveLength(1);
    nodes[0].properties!.pop();
    expect(await queryNativeRoles(session, 1, query, progress)).toHaveLength(0);
    expect(
      send.mock.calls.filter(([method]) => method === "Accessibility.queryAXTree"),
    ).toHaveLength(2);
  });

  it.each(["Runtime.evaluate", "Accessibility.queryAXTree"])(
    "propagates %s errors & cleans up",
    async (failing) => {
      const state = setup();
      state.send.mockImplementation(async (method, params) => {
        await state.respond(method, params);
        if (method === failing) throw new Error("unsupported or detached");
        return state.respond(method, params);
      });
      await expect(
        queryNativeRoles(state.session, 1, { role: "button" }, progress),
      ).rejects.toThrow("unsupported or detached");
      expect(state.groups.size).toBe(0);
      expect(state.listeners()).toBe(0);
    },
  );

  it.each([
    { result: { type: "undefined" }, exceptionDetails: { text: "document unavailable" } },
    { result: { type: "undefined" } },
  ])("rejects an invalid document response", async (response) => {
    const state = setup();
    state.send.mockImplementation((method, params) =>
      method === "Runtime.evaluate" ? Promise.resolve(response) : state.respond(method, params),
    );
    await expect(
      queryNativeRoles(state.session, 1, { role: "button" }, progress),
    ).rejects.toThrow();
    expect(state.send).not.toHaveBeenCalledWith("Accessibility.queryAXTree", expect.anything());
    expect(state.listeners()).toBe(0);
  });

  it.each(["Runtime.executionContextDestroyed", "Runtime.executionContextsCleared"])(
    "rejects results after %s",
    async (event) => {
      const state = setup();
      state.send.mockImplementation(async (method, params) => {
        if (method === "Accessibility.queryAXTree") state.emit(event, { executionContextId: 1 });
        return state.respond(method, params);
      });
      await expect(
        queryNativeRoles(state.session, 1, { role: "button" }, progress),
      ).rejects.toThrow("context was destroyed");
      expect(state.groups.size).toBe(0);
      expect(state.listeners()).toBe(0);
    },
  );

  it("ignores another context's destruction", async () => {
    const state = setup();
    state.send.mockImplementation(async (method, params) => {
      state.emit("Runtime.executionContextDestroyed", { executionContextId: 2 });
      return state.respond(method, params);
    });
    expect(await queryNativeRoles(state.session, 1, { role: "button" }, progress)).toHaveLength(1);
  });

  it.each(["Runtime.evaluate", "Accessibility.queryAXTree"])(
    "stops waiting for %s at the deadline & releases late handles",
    async (pendingMethod) => {
      const state = setup();
      let complete!: () => void;
      state.send.mockImplementation(async (method, params) => {
        if (method === pendingMethod)
          await new Promise<void>((resolve) => {
            complete = resolve;
          });
        return state.respond(method, params);
      });
      const pending = queryNativeRoles(state.session, 1, { role: "button" }, progress);
      const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
      expect(state.groups.size).toBe(0);
      expect(state.listeners()).toBe(0);
      complete();
      await vi.advanceTimersByTimeAsync(0);
      expect(state.groups.size).toBe(0);
      if (pendingMethod === "Runtime.evaluate")
        expect(
          state.send.mock.calls.some(([method]) => method === "Accessibility.queryAXTree"),
        ).toBe(false);
    },
  );

  it("does not dispatch work after cancellation", async () => {
    const state = setup();
    await vi.advanceTimersByTimeAsync(100);
    await expect(
      queryNativeRoles(state.session, 1, { role: "button" }, progress),
    ).rejects.toBeInstanceOf(TimeoutError);
    expect(state.send).not.toHaveBeenCalled();
  });
});
