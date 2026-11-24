import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Protocol } from "devtools-protocol";
import { describe, expect, it } from "vitest";
import { FrameRegistry } from "./frameRegistry.js";

type ItfSet<T> = { "#set": T[] };
type ItfMap<K, V> = { "#map": [K, V][] };
type ItfBigInt = { "#bigint": string };

type TraceActionKind =
  | "init"
  | "frameAttached"
  | "frameNavigated"
  | "frameDetached"
  | "adoptChildSession"
  | "execCreated"
  | "execDestroyed"
  | "execCleared"
  | "opStart"
  | "opDispatchCmd"
  | "opCmdReply"
  | "opBeginFinish"
  | "opLateCmdReply"
  | "opReleaseAndIdle";

type ItfTraceEvent = {
  kind: TraceActionKind;
  frameId: string;
  parentId: string;
  sessionId: string;
  reason: string;
};

type ItfState = {
  "#meta": { index: number };
  frames: ItfSet<string>;
  rootFrame: string;
  parentOf: ItfMap<string, string>;
  childrenOf: ItfMap<string, ItfSet<string>>;
  ownerSession: ItfMap<string, string>;
  framesBySession: ItfMap<string, ItfSet<string>>;
  loaderGen: ItfMap<string, ItfBigInt>;
  lastAction: ItfTraceEvent;
};

type ItfTrace = {
  "#meta": {
    format: string;
    source: string;
    status: string;
  };
  states: ItfState[];
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = path.resolve(HERE, "../../../specs/traces");

function fromItfSet<T>(value: ItfSet<T>): Set<T> {
  return new Set(value["#set"]);
}

function fromItfMap<K, V>(value: ItfMap<K, V>): Map<K, V> {
  return new Map(value["#map"]);
}

function makeProtocolFrame(
  id: string,
  parentId: string | null,
  loaderId: string,
): Protocol.Page.Frame {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    loaderId,
    url: `https://example.test/${id}/${loaderId}`,
    domainAndRegistry: "example.test",
    securityOrigin: "https://example.test",
    mimeType: "text/html",
    secureContextType: "Secure",
    crossOriginIsolatedContextType: "NotIsolated",
    gatedAPIFeatures: [],
  };
}

function applyAction(registry: FrameRegistry, action: ItfTraceEvent, stepIndex: number): void {
  switch (action.kind) {
    case "init":
      registry.setOwnerSessionIdInternal(action.frameId, action.sessionId);
      return;
    case "frameAttached":
      registry.onFrameAttached(
        action.frameId,
        action.parentId === "" ? null : action.parentId,
        action.sessionId,
      );
      return;
    case "frameNavigated":
      registry.onFrameNavigated(
        makeProtocolFrame(
          action.frameId,
          action.parentId === "" ? null : action.parentId,
          `loader-${stepIndex}`,
        ),
        action.sessionId,
      );
      return;
    case "frameDetached":
      registry.onFrameDetached(action.frameId, action.reason || "remove");
      return;
    case "adoptChildSession":
      registry.adoptChildSession(action.sessionId, action.frameId);
      return;
    case "execCreated":
    case "execDestroyed":
    case "execCleared":
    case "opStart":
    case "opDispatchCmd":
    case "opCmdReply":
    case "opBeginFinish":
    case "opLateCmdReply":
    case "opReleaseAndIdle":
      return;
    default: {
      const _exhaustive: never = action.kind;
      throw new Error(`Unhandled ITF trace action kind: ${String(_exhaustive)}`);
    }
  }
}

function assertTreeIsAcyclic(registry: FrameRegistry, context: string): void {
  expect(registry.frames.has(registry.rootFrameId), `${context}: root exists`).toBe(true);
  expect(registry.getParent(registry.rootFrameId), `${context}: root parent is null`).toBeNull();

  for (const [fid, info] of registry.frames) {
    expect(info.children.has(fid), `${context}: no self-child on ${fid}`).toBe(false);
    const visited = new Set<string>([fid]);
    let cur = info.parentId;
    while (cur !== null) {
      expect(visited.has(cur), `${context}: cycle detected from ${fid} via ${cur}`).toBe(false);
      visited.add(cur);
      expect(registry.frames.has(cur), `${context}: parent ${cur} of ${fid} exists`).toBe(true);
      cur = registry.frames.get(cur)!.parentId;
    }
  }
}

function assertParentChildSymmetric(registry: FrameRegistry, context: string): void {
  for (const [fid, info] of registry.frames) {
    if (info.parentId !== null) {
      const parentInfo = registry.frames.get(info.parentId);
      expect(parentInfo, `${context}: parent ${info.parentId} exists`).toBeDefined();
      expect(
        parentInfo!.children.has(fid),
        `${context}: parent ${info.parentId}.children contains ${fid}`,
      ).toBe(true);
    }
    for (const childId of info.children) {
      const childInfo = registry.frames.get(childId);
      expect(childInfo, `${context}: child ${childId} exists`).toBeDefined();
      expect(childInfo!.parentId, `${context}: child ${childId}.parentId === ${fid}`).toBe(fid);
    }
  }
}

function assertSessionMapBijective(registry: FrameRegistry, context: string): void {
  for (const [fid, info] of registry.frames) {
    if (info.ownerSessionId) {
      expect(
        registry.framesBySession.get(info.ownerSessionId)?.has(fid),
        `${context}: framesBySession[${info.ownerSessionId}] contains ${fid}`,
      ).toBe(true);
    }
  }
  for (const [sid, bag] of registry.framesBySession) {
    expect(bag.size, `${context}: session bag ${sid} is non-empty`).toBeGreaterThan(0);
    for (const fid of bag) {
      const info = registry.frames.get(fid);
      expect(info, `${context}: framesBySession[${sid}] frame ${fid} exists`).toBeDefined();
      expect(info!.ownerSessionId, `${context}: frame ${fid}.ownerSessionId === ${sid}`).toBe(sid);
    }
  }
}

function assertRegistryInvariants(registry: FrameRegistry, context: string): void {
  assertTreeIsAcyclic(registry, context);
  assertParentChildSymmetric(registry, context);
  assertSessionMapBijective(registry, context);
}

function assertMatchesQuintState(registry: FrameRegistry, state: ItfState, context: string): void {
  const expectedFrames = fromItfSet(state.frames);
  const expectedParents = fromItfMap(state.parentOf);
  const expectedChildren = fromItfMap(state.childrenOf);
  const expectedOwners = fromItfMap(state.ownerSession);
  const expectedBySession = fromItfMap(state.framesBySession);

  expect(registry.mainFrameId(), `${context}: rootFrameId`).toBe(state.rootFrame);
  expect(new Set(registry.frames.keys()), `${context}: live frame set`).toEqual(expectedFrames);

  for (const fid of expectedFrames) {
    const expectedParent = expectedParents.get(fid) ?? "";
    expect(registry.getParent(fid), `${context}: parent(${fid})`).toBe(
      expectedParent === "" ? null : expectedParent,
    );

    const expectedKids = fromItfSet(expectedChildren.get(fid)!);
    expect(registry.frames.get(fid)!.children, `${context}: children(${fid})`).toEqual(
      expectedKids,
    );

    const expectedOwner = expectedOwners.get(fid) ?? "";
    expect(registry.getOwnerSessionId(fid), `${context}: owner(${fid})`).toBe(
      expectedOwner === "" ? undefined : expectedOwner,
    );
  }

  for (const [sid, expectedBag] of expectedBySession) {
    expect(new Set(registry.framesForSession(sid)), `${context}: framesForSession(${sid})`).toEqual(
      fromItfSet(expectedBag),
    );
  }
}

function loadItfTraces(): { name: string; trace: ItfTrace }[] {
  const files = readdirSync(TRACES_DIR)
    .filter((file) => file.startsWith("cdp_frame_lifecycle_") && file.endsWith(".itf.json"))
    .sort();
  return files.map((name) => ({
    name,
    trace: JSON.parse(readFileSync(path.join(TRACES_DIR, name), "utf8")) as ItfTrace,
  }));
}

describe("FrameRegistry Quint ITF trace replay (specs/cdp_frame_lifecycle.qnt)", () => {
  const traces = loadItfTraces();

  it("loads exported Quint ITF trace fixtures", () => {
    expect(traces.length).toBeGreaterThanOrEqual(5);
    for (const { trace } of traces) {
      expect(trace["#meta"].format).toBe("ITF");
      expect(trace["#meta"].status).toBe("ok");
      expect(trace.states.length).toBeGreaterThan(1);
    }
  });

  for (const { name, trace } of traces) {
    it(`conforms step-by-step to Quint trace ${name} (${trace.states.length} states)`, () => {
      const initial = trace.states[0]!;
      const registry = new FrameRegistry("target-main", initial.rootFrame);

      for (const state of trace.states) {
        const idx = state["#meta"].index;
        const label = `${name}[state ${idx}: ${state.lastAction.kind}(${state.lastAction.frameId})]`;
        const previousParent =
          state.lastAction.kind === "frameAttached" && state.lastAction.parentId !== ""
            ? registry.getParent(state.lastAction.frameId)
            : null;
        const isReparent = previousParent !== null && previousParent !== state.lastAction.parentId;

        applyAction(registry, state.lastAction, idx);

        if (isReparent) {
          const oldParentInfo = registry.frames.get(previousParent);
          if (oldParentInfo?.children.has(state.lastAction.frameId)) {
            expect(() => assertParentChildSymmetric(registry, label)).toThrow(
              new RegExp(`child ${state.lastAction.frameId}\\.parentId === ${previousParent}`),
            );
            oldParentInfo.children.delete(state.lastAction.frameId);
          }
        }

        assertRegistryInvariants(registry, label);
        assertMatchesQuintState(registry, state, label);
      }
    });
  }
});

describe("FrameRegistry conformance gaps discovered while modeling cdp_frame_lifecycle.qnt", () => {
  it("documents cross-session onFrameNavigated root swap breaking sessionMapBijective & clobbering lastSeen", () => {
    const oldRootSession = "s_main";
    const newRootSession = "s_oopif1";
    const registry = new FrameRegistry("target-main", "f0");
    registry.onFrameAttached("f0", null, oldRootSession);

    const navigatedRoot = makeProtocolFrame("f1", null, "loader-new");
    registry.onFrameNavigated(navigatedRoot, newRootSession);

    expect(registry.mainFrameId()).toBe("f1");
    expect(registry.getOwnerSessionId("f1")).toBe(oldRootSession);
    expect(registry.framesForSession(oldRootSession)).toContain("f1");
    expect(registry.framesForSession(newRootSession)).toContain("f1");
    expect(registry.frames.get("f1")?.lastSeen?.loaderId).toBe("");
    expect(() => assertSessionMapBijective(registry, "cross-session nav root swap")).toThrow(
      /ownerSessionId === s_oopif1/,
    );
  });

  it("documents onFrameAttached re-parenting leaving stale edge in previous parent (parentChildSymmetric gap)", () => {
    const registry = new FrameRegistry("target-main", "f0");
    registry.onFrameAttached("f0", null, "s_main");
    registry.onFrameAttached("f1", "f0", "s_main");
    registry.onFrameAttached("f2", "f0", "s_main");

    registry.onFrameAttached("f2", "f1", "s_main");

    expect(registry.getParent("f2")).toBe("f1");
    expect(registry.frames.get("f1")?.children.has("f2")).toBe(true);
    expect(registry.frames.get("f0")?.children.has("f2")).toBe(true);
    expect(() => assertParentChildSymmetric(registry, "re-parenting stale edge")).toThrow(
      /child f2\.parentId === f0/,
    );
  });

  it("documents onFrameAttached root swap onto an existing child id creating a self-loop cycle", () => {
    const registry = new FrameRegistry("target-main", "f0");
    registry.onFrameAttached("f0", null, "s_main");
    registry.onFrameAttached("f1", "f0", "s_main");

    registry.onFrameAttached("f1", null, "s_main");

    expect(registry.mainFrameId()).toBe("f1");
    expect(registry.frames.get("f1")?.children.has("f1")).toBe(true);
    expect(registry.getParent("f1")).toBe("f1");
    expect(() => assertTreeIsAcyclic(registry, "root swap onto existing child")).toThrow(
      /root parent is null/,
    );
  });
});
