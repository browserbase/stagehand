import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import fc from "fast-check";
import type { Protocol } from "devtools-protocol";
import type { LocatorChain, LocatorStep } from "@browserbasehq/stagehand-protocol/types";
import type { ElementChainResolution } from "../dom/locatorScripts/resolveElementChain.js";
import type { StagehandLogger } from "../logger.js";
import { TimeoutError } from "../errors.js";
import type { CDPSessionLike } from "./cdp.js";
import { ChainLocatorDelegate } from "./chainLocator.js";
import { FrameElementChainResolver } from "./elementChainResolver.js";
import { executionContexts } from "./executionContextRegistry.js";
import type { Frame } from "./frame.js";
import { FrameChainResolver } from "./frameChainResolver.js";
import { FrameRegistry } from "./frameRegistry.js";
import type { Page } from "./page.js";
import { Progress } from "./progress.js";
import { FrameSelectorResolver } from "./selectorResolver.js";

const SEED = 20261124;

type MockNode = {
  id: number;
  tag: string;
  isFrame: boolean;
  childFrameId?: string;
  backendNodeId: number;
  children: number[];
};

type MockFrameDoc = {
  frameId: string;
  parentFrameId: string | null;
  sessionId: string;
  ownerBackendNodeId?: number;
  nodes: Map<number, MockNode>;
  rootChildren: number[];
};

type Violation = {
  sessionId: string;
  method: string;
  detail: string;
};

type FaultKind =
  | "none"
  | "staleObjectId"
  | "frameDetached"
  | "navigationLoaderChange"
  | "oopifSessionSwap"
  | "executionContextDestroyed"
  | "cdpClosed"
  | "timeout"
  | "abort"
  | "lateReplyAfterTimeout";

type Deferred<T = unknown> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

function createDeferred<T = unknown>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class InstrumentedSession {
  readonly liveGroups = new Set<string>();
  readonly allocatedGroups = new Set<string>();
  readonly liveObjects = new Set<string>();
  readonly ownedObjects = new Set<string>();
  readonly ownedContexts = new Set<number>();
  readonly violations: Violation[] = [];
  readonly spuriousReleases: string[] = [];
  readonly commands: Array<{ method: string; params?: object }> = [];
  activeDescribes = 0;
  peakDescribes = 0;

  readonly session: CDPSessionLike;
  private nextObjectSeq = 1;
  private readonly scopes = new Map<string, { frameId: string }>();
  private readonly arrays = new Map<string, Array<{ frameId: string; nodeId: number }>>();
  private readonly elementHandles = new Map<string, { frameId: string; nodeId: number }>();

  constructor(
    readonly id: string,
    private readonly handler: (
      self: InstrumentedSession,
      method: string,
      params?: object,
    ) => Promise<unknown>,
  ) {
    const send = (method: string, params?: object) => this.dispatch(method, params);
    this.session = {
      id,
      send: send as CDPSessionLike["send"],
      on() {},
      off() {},
      async close() {},
    };
  }

  allocateContext(contextId: number): number {
    this.ownedContexts.add(contextId);
    return contextId;
  }

  allocateObject(prefix: string, objectGroup?: string): string {
    const objectId = `${this.id}:${prefix}:${this.nextObjectSeq++}`;
    this.ownedObjects.add(objectId);
    if (objectGroup) {
      this.allocatedGroups.add(objectGroup);
      this.liveGroups.add(objectGroup);
    } else {
      this.liveObjects.add(objectId);
    }
    return objectId;
  }

  registerScope(objectId: string, frameId: string): void {
    this.scopes.set(objectId, { frameId });
  }

  getScope(objectId: string): { frameId: string } | undefined {
    return this.scopes.get(objectId);
  }

  registerArray(objectId: string, entries: Array<{ frameId: string; nodeId: number }>): void {
    this.arrays.set(objectId, entries);
  }

  getArray(objectId: string): Array<{ frameId: string; nodeId: number }> | undefined {
    return this.arrays.get(objectId);
  }

  registerElementHandle(objectId: string, frameId: string, nodeId: number): void {
    this.elementHandles.set(objectId, { frameId, nodeId });
  }

  getElementHandle(objectId: string): { frameId: string; nodeId: number } | undefined {
    return this.elementHandles.get(objectId);
  }

  private async dispatch(method: string, params?: object): Promise<unknown> {
    this.commands.push({ method, params });
    const p = (params ?? {}) as {
      contextId?: number;
      objectId?: string;
      objectGroup?: string;
    };

    if (typeof p.contextId === "number" && !this.ownedContexts.has(p.contextId)) {
      this.violations.push({
        sessionId: this.id,
        method,
        detail: `foreign contextId ${p.contextId}`,
      });
    }

    if (typeof p.objectId === "string" && !this.ownedObjects.has(p.objectId)) {
      this.violations.push({
        sessionId: this.id,
        method,
        detail: `foreign objectId ${p.objectId}`,
      });
    }

    if (method === "Runtime.releaseObjectGroup" && typeof p.objectGroup === "string") {
      if (!this.allocatedGroups.has(p.objectGroup)) {
        this.spuriousReleases.push(p.objectGroup);
      }
      this.liveGroups.delete(p.objectGroup);
      return {};
    }

    if (typeof p.objectGroup === "string") {
      this.allocatedGroups.add(p.objectGroup);
    }

    if (method === "Runtime.releaseObject" && typeof p.objectId === "string") {
      this.liveObjects.delete(p.objectId);
      return {};
    }

    if (method === "DOM.describeNode") {
      this.activeDescribes++;
      this.peakDescribes = Math.max(this.peakDescribes, this.activeDescribes);
      try {
        return await this.handler(this, method, params);
      } finally {
        this.activeDescribes--;
      }
    }

    return await this.handler(this, method, params);
  }
}

type WorldSpec = {
  docs: Map<string, MockFrameDoc>;
  frameSessionMap: Map<string, string>;
  backendToFrame: Map<number, string>;
  describeDelays: number[];
};

function buildWorldSpec(
  childCount: number,
  grandchildCounts: number[],
  oopifFlags: boolean[],
  itemsPerFrame: number[],
  describeDelays: number[],
): WorldSpec {
  const docs = new Map<string, MockFrameDoc>();
  const frameSessionMap = new Map<string, string>();
  const backendToFrame = new Map<number, string>();
  let nextBackend = 1000;

  const makeDoc = (
    frameId: string,
    parentFrameId: string | null,
    sessionId: string,
    ownerBackendNodeId: number | undefined,
    itemCount: number,
  ): MockFrameDoc => {
    const nodes = new Map<number, MockNode>();
    const rootChildren: number[] = [];
    let nextId = 1;

    const sectionCount = Math.max(1, Math.min(3, itemCount));
    const perSection = Math.max(1, Math.ceil(itemCount / sectionCount));
    for (let s = 0; s < sectionCount; s++) {
      const secId = nextId++;
      const secChildren: number[] = [];
      for (let b = 0; b < perSection && nextId <= itemCount + sectionCount + 2; b++) {
        const btnId = nextId++;
        nodes.set(btnId, {
          id: btnId,
          tag: b % 2 === 0 ? "btn" : "link",
          isFrame: false,
          backendNodeId: nextBackend++,
          children: [],
        });
        secChildren.push(btnId);
      }
      nodes.set(secId, {
        id: secId,
        tag: "card",
        isFrame: false,
        backendNodeId: nextBackend++,
        children: secChildren,
      });
      rootChildren.push(secId);
    }

    const doc: MockFrameDoc = {
      frameId,
      parentFrameId,
      sessionId,
      ownerBackendNodeId,
      nodes,
      rootChildren,
    };
    docs.set(frameId, doc);
    frameSessionMap.set(frameId, sessionId);
    return doc;
  };

  const mainDoc = makeDoc("main", null, "main", undefined, itemsPerFrame[0] ?? 4);
  let nextMainId = mainDoc.nodes.size + 1;

  for (let c = 0; c < childCount; c++) {
    const childFrameId = `child-${c}`;
    const childSessionId = oopifFlags[c % oopifFlags.length] ? `oopif-${c}` : "main";
    const iframeBackend = nextBackend++;
    const iframeNodeId = nextMainId++;
    mainDoc.nodes.set(iframeNodeId, {
      id: iframeNodeId,
      tag: "iframe",
      isFrame: true,
      childFrameId,
      backendNodeId: iframeBackend,
      children: [],
    });
    mainDoc.rootChildren.push(iframeNodeId);
    backendToFrame.set(iframeBackend, childFrameId);

    const childDoc = makeDoc(
      childFrameId,
      "main",
      childSessionId,
      iframeBackend,
      itemsPerFrame[(c + 1) % itemsPerFrame.length] ?? 3,
    );

    const gcCount = grandchildCounts[c % grandchildCounts.length] ?? 0;
    let nextChildId = childDoc.nodes.size + 1;
    for (let g = 0; g < gcCount; g++) {
      const gcFrameId = `gc-${c}-${g}`;
      const gcSessionId = oopifFlags[(c + g + 1) % oopifFlags.length]
        ? `oopif-gc-${c}-${g}`
        : childSessionId;
      const gcBackend = nextBackend++;
      const gcNodeId = nextChildId++;
      childDoc.nodes.set(gcNodeId, {
        id: gcNodeId,
        tag: "iframe",
        isFrame: true,
        childFrameId: gcFrameId,
        backendNodeId: gcBackend,
        children: [],
      });
      childDoc.rootChildren.push(gcNodeId);
      backendToFrame.set(gcBackend, gcFrameId);

      makeDoc(
        gcFrameId,
        childFrameId,
        gcSessionId,
        gcBackend,
        itemsPerFrame[(c + g + 2) % itemsPerFrame.length] ?? 2,
      );
    }
  }

  return { docs, frameSessionMap, backendToFrame, describeDelays };
}

function queryDocNodes(doc: MockFrameDoc, scopeNodeId: number, selectorValue: string): MockNode[] {
  const tags = selectorValue
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const wantAll = tags.includes("*");

  const results: MockNode[] = [];
  const visit = (id: number) => {
    const node = doc.nodes.get(id);
    if (!node) return;
    if (wantAll || tags.includes(node.tag)) results.push(node);
    for (const child of node.children) visit(child);
  };

  if (scopeNodeId === 0) {
    for (const rootId of doc.rootChildren) visit(rootId);
  } else {
    const scope = doc.nodes.get(scopeNodeId);
    if (scope) {
      for (const child of scope.children) visit(child);
    }
  }
  return results;
}

type OracleTarget = { sessionId: string; frameId: string; backendNodeId: number };

function evaluateChainOracle(
  spec: WorldSpec,
  chain: LocatorChain,
  resolution: ElementChainResolution,
):
  | { ok: true; mode: "count"; count: number }
  | { ok: true; mode: "selected" | "all"; targets: OracleTarget[] }
  | { ok: false; error: string } {
  let matches: Array<{ frameId: string; nodeId: number; isFrame: boolean }> = [
    { frameId: "main", nodeId: 0, isFrame: false },
  ];

  for (const step of chain.steps) {
    if (!matches.length) break;
    if (step.type === "nth") {
      matches = matches[step.index] ? [matches[step.index]!] : [];
      continue;
    }
    if (step.type === "frame" && matches.some((m) => !m.isFrame)) {
      return { ok: false, error: "Explicit frame hop requires an iframe or frame element" };
    }

    const scopes = matches.map((m) => {
      if (!m.isFrame) return m;
      const doc = spec.docs.get(m.frameId)!;
      const node = doc.nodes.get(m.nodeId)!;
      return { frameId: node.childFrameId!, nodeId: 0, isFrame: false };
    });

    const seen = new Set<string>();
    const next: typeof matches = [];
    for (const scope of scopes) {
      const doc = spec.docs.get(scope.frameId)!;
      const found = queryDocNodes(doc, scope.nodeId, step.selector.value);
      for (const node of found) {
        const key = `${scope.frameId}:${node.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ frameId: scope.frameId, nodeId: node.id, isFrame: node.isFrame });
      }
    }
    matches = next;
  }

  if (resolution.mode === "count") return { ok: true, mode: "count", count: matches.length };
  if (resolution.mode === "selected") {
    matches = matches[resolution.index] ? [matches[resolution.index]!] : [];
  }
  const targets = matches.map((m) => {
    const doc = spec.docs.get(m.frameId)!;
    const node = doc.nodes.get(m.nodeId)!;
    return { sessionId: doc.sessionId, frameId: m.frameId, backendNodeId: node.backendNodeId };
  });
  return { ok: true, mode: resolution.mode, targets };
}

function createMockHarness(
  spec: WorldSpec,
  faultConfig?: {
    kind: FaultKind;
    triggerCallIndex: number;
    controller?: AbortController;
  },
) {
  const sessions = new Map<string, InstrumentedSession>();
  const registry = new FrameRegistry("page", "main");
  let nextContextSeq = 10;
  let globalCallSeq = 0;
  const lateGates: Array<{ gate: Deferred; session: InstrumentedSession; group?: string }> = [];
  const contextToFrame = new Map<string, string>();
  const frameSessionOverride = new Map<string, InstrumentedSession>();

  const getOrCreateSession = (sessionId: string): InstrumentedSession => {
    let existing = sessions.get(sessionId);
    if (existing) return existing;

    existing = new InstrumentedSession(sessionId, async (self, method, params) => {
      const callIndex = globalCallSeq++;
      const p = (params ?? {}) as {
        contextId?: number;
        objectId?: string;
        objectGroup?: string;
        functionDeclaration?: string;
        arguments?: Array<{ value: unknown }>;
        frameId?: string;
        backendNodeId?: number;
      };

      if (
        faultConfig &&
        faultConfig.kind !== "none" &&
        callIndex === faultConfig.triggerCallIndex
      ) {
        const activeFrames = [...registry.frames.keys()];
        const victimFrame = activeFrames.find((fid) => fid !== "main") ?? activeFrames[0] ?? "main";
        switch (faultConfig.kind) {
          case "staleObjectId":
            throw new Error("Could not find object with given id");
          case "frameDetached":
            registry.onFrameDetached(victimFrame);
            break;
          case "navigationLoaderChange": {
            const info = registry.frames.get(victimFrame);
            if (info) {
              info.lastSeen = {
                ...(info.lastSeen ?? ({ id: victimFrame } as Protocol.Page.Frame)),
                loaderId: "navigated-loader",
              };
            }
            break;
          }
          case "oopifSessionSwap": {
            const replacement = getOrCreateSession(`replacement-${callIndex}`);
            frameSessionOverride.set(victimFrame, replacement);
            break;
          }
          case "executionContextDestroyed":
            throw new Error("Cannot find context with specified id");
          case "cdpClosed":
            throw new Error("CDP connection closed: socket-close");
          case "abort":
            faultConfig.controller?.abort(new Error("aborted mid-chain"));
            throw new Error("aborted mid-chain");
          case "timeout":
          case "lateReplyAfterTimeout": {
            const gate = createDeferred();
            lateGates.push({ gate, session: self, group: p.objectGroup });
            return gate.promise;
          }
          default: {
            const exhaustive: never = faultConfig.kind;
            throw new Error(`Unhandled fault kind: ${String(exhaustive)}`);
          }
        }
      }

      if (method === "Runtime.evaluate") {
        const frameId = contextToFrame.get(`${self.id}:${p.contextId}`) ?? "main";
        const objectId = self.allocateObject("scope", p.objectGroup);
        self.registerScope(objectId, frameId);
        return { result: { objectId, type: "object" } };
      }

      if (method === "Runtime.callFunctionOn") {
        const scope = self.getScope(p.objectId!);
        if (!scope) throw new Error("Unknown scope objectId");
        const doc = spec.docs.get(scope.frameId);
        if (!doc) throw new Error(`Missing doc ${scope.frameId}`);

        if (p.functionDeclaration?.includes("this.query(")) {
          const selector = p.arguments![0]!.value as { value: string };
          const scopeIds = p.arguments![1]!.value as number[];
          const groups = scopeIds.map((scopeId) =>
            queryDocNodes(doc, scopeId, selector.value).map((node) => ({
              id: node.id,
              isFrame: node.isFrame,
            })),
          );
          return { result: { value: groups } };
        }

        if (p.functionDeclaration?.includes("return this.elements(")) {
          const ids = p.arguments![0]!.value as number[];
          const arrayId = self.allocateObject("array", p.objectGroup);
          self.registerArray(
            arrayId,
            ids.map((nodeId) => ({ frameId: scope.frameId, nodeId })),
          );
          return { result: { objectId: arrayId, type: "object" } };
        }

        return { result: { value: undefined } };
      }

      if (method === "Runtime.getProperties") {
        const entries = self.getArray(p.objectId!);
        if (!entries) throw new Error("Unknown array objectId");
        const group = [...self.liveGroups][0];
        const props = entries.map((entry, idx) => {
          const handleId = self.allocateObject("el", group);
          self.registerElementHandle(handleId, entry.frameId, entry.nodeId);
          return { name: String(idx), value: { objectId: handleId, type: "object" } };
        });
        props.reverse();
        props.push({
          name: "length",
          value: { objectId: undefined as unknown as string, type: "number" },
        });
        return { result: props };
      }

      if (method === "DOM.describeNode") {
        const entry = self.getElementHandle(p.objectId!);
        if (!entry) throw new Error("Unknown element objectId");
        const doc = spec.docs.get(entry.frameId)!;
        const node = doc.nodes.get(entry.nodeId)!;
        const delayMs = spec.describeDelays[node.backendNodeId % spec.describeDelays.length] ?? 0;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        return { node: { backendNodeId: node.backendNodeId } };
      }

      if (method === "DOM.getFrameOwner") {
        const childDoc = spec.docs.get(p.frameId!);
        return { backendNodeId: childDoc?.ownerBackendNodeId ?? -1 };
      }

      if (method === "DOM.resolveNode") {
        const objectId = self.allocateObject("resolved");
        return { object: { objectId, type: "object" } };
      }

      if (method === "DOM.requestNode") {
        return { nodeId: 1 };
      }

      return {};
    });

    sessions.set(sessionId, existing);
    return existing;
  };

  for (const doc of spec.docs.values()) {
    getOrCreateSession(doc.sessionId);
    registry.onFrameAttached(doc.frameId, doc.parentFrameId, doc.sessionId);
    if (doc.ownerBackendNodeId !== undefined) {
      registry.setOwnerBackendNodeId(doc.frameId, doc.ownerBackendNodeId);
    }
  }

  const getSessionForFrame = (frameId: string): CDPSessionLike => {
    const overridden = frameSessionOverride.get(frameId);
    if (overridden) return overridden.session;
    const sessionId = spec.frameSessionMap.get(frameId) ?? "main";
    return getOrCreateSession(sessionId).session;
  };

  const mainSession = getOrCreateSession("main").session;
  const root = { session: mainSession, frameId: "main" } as Frame;

  const page = {
    pageId: "page-1",
    browserIsRemote: false,
    logger: {} as StagehandLogger,
    registry,
    mainFrame: () => root,
    getSessionForFrame,
    getFullFrameTree: () => registry.asProtocolFrameTree("main"),
  } as unknown as Page;

  const readySpy = vi
    .spyOn(executionContexts, "waitForLocatorWorld")
    .mockImplementation(async (session, frameId) => {
      const inst = [...sessions.values()].find((s) => s.session === session);
      const contextId = nextContextSeq++;
      if (inst) {
        inst.allocateContext(contextId);
        contextToFrame.set(`${inst.id}:${contextId}`, frameId);
      }
      return {
        contextId,
        kind: "extension",
        capabilities: { closedShadowRoots: true },
      };
    });

  return {
    sessions,
    registry,
    page,
    root,
    readySpy,
    lateGates,
    sessionIdOf: (session: CDPSessionLike) =>
      [...sessions.values()].find((s) => s.session === session)?.id,
    allViolations: () => [...sessions.values()].flatMap((s) => s.violations),
    allSpuriousReleases: () => [...sessions.values()].flatMap((s) => s.spuriousReleases),
    totalLiveGroups: () => [...sessions.values()].reduce((sum, s) => sum + s.liveGroups.size, 0),
    totalLiveObjects: () => [...sessions.values()].reduce((sum, s) => sum + s.liveObjects.size, 0),
    peakDescribes: () => Math.max(0, ...[...sessions.values()].map((s) => s.peakDescribes)),
  };
}

const selectorTagArb = fc.constantFrom(
  "card",
  "btn",
  "link",
  "iframe",
  "card, iframe",
  "btn, link",
  "iframe, btn",
  "nonexistent",
  "*",
);

const chainStepArb: fc.Arbitrary<LocatorStep> = fc.oneof(
  {
    weight: 5,
    arbitrary: selectorTagArb.map((value) => ({
      type: "query" as const,
      selector: { kind: "css" as const, value },
    })),
  },
  {
    weight: 2,
    arbitrary: selectorTagArb.map((value) => ({
      type: "frame" as const,
      selector: { kind: "css" as const, value },
    })),
  },
  {
    weight: 3,
    arbitrary: fc.integer({ min: 0, max: 6 }).map((index) => ({
      type: "nth" as const,
      index,
    })),
  },
);

const chainArb: fc.Arbitrary<LocatorChain> = fc
  .tuple(
    selectorTagArb.map((value) => ({
      type: "query" as const,
      selector: { kind: "css" as const, value },
    })),
    fc.array(chainStepArb, { minLength: 0, maxLength: 5 }),
  )
  .map(([first, rest]) => ({ steps: [first, ...rest] }));

const resolutionArb: fc.Arbitrary<ElementChainResolution> = fc.oneof(
  fc.constant({ mode: "count" as const }),
  fc.constant({ mode: "all" as const }),
  fc.integer({ min: 0, max: 8 }).map((index) => ({ mode: "selected" as const, index })),
);

const worldSpecArb = fc
  .record({
    childCount: fc.integer({ min: 0, max: 3 }),
    grandchildCounts: fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 3 }),
    oopifFlags: fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
    itemsPerFrame: fc.array(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 5 }),
    describeDelays: fc.array(fc.constantFrom(0, 1, 3, 7, 12), { minLength: 1, maxLength: 8 }),
  })
  .map(({ childCount, grandchildCounts, oopifFlags, itemsPerFrame, describeDelays }) =>
    buildWorldSpec(childCount, grandchildCounts, oopifFlags, itemsPerFrame, describeDelays),
  );

describe("locatorChain stateful & adversarial properties", () => {
  const progresses: Progress[] = [];
  const makeProgress = (timeout = 0) => {
    const p = new Progress("prop-chain", timeout);
    progresses.push(p);
    return p;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  });

  afterEach(async () => {
    try {
      progresses.splice(0).forEach((p) => p.dispose());
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("matches the multi-frame reference oracle with bounded concurrency, deterministic order, and zero leaks", async () => {
    await fc.assert(
      fc.asyncProperty(worldSpecArb, chainArb, resolutionArb, async (spec, chain, resolution) => {
        const harness = createMockHarness(spec);
        try {
          const resolver = new FrameChainResolver(harness.page, harness.root, {
            readinessRetries: "none",
          });
          const expected = evaluateChainOracle(spec, chain, resolution);

          let actual: Awaited<ReturnType<FrameChainResolver["resolve"]>> | undefined;
          let error: unknown;
          const pending = resolver
            .resolve(chain, resolution)
            .then((res) => {
              actual = res;
            })
            .catch((err) => {
              error = err;
            });

          await vi.advanceTimersByTimeAsync(500);
          await pending;

          if (!expected.ok) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toContain(expected.error);
          } else {
            expect(error).toBeUndefined();
            expect(actual).toBeDefined();
            if (expected.mode === "count") {
              expect(actual).toEqual({ mode: "count", count: expected.count });
            } else {
              expect(actual!.mode).toBe(expected.mode);
              if (actual!.mode !== "count") {
                expect(
                  actual!.targets.map((t) => ({
                    sessionId: harness.sessionIdOf(t.session),
                    frameId: t.frameId,
                    backendNodeId: t.backendNodeId,
                  })),
                ).toEqual(expected.targets);
              }
            }
          }

          expect(harness.peakDescribes()).toBeLessThanOrEqual(4);
          expect(harness.totalLiveGroups()).toBe(0);
          expect(harness.totalLiveObjects()).toBe(0);
          expect(harness.allViolations()).toEqual([]);
          expect(harness.allSpuriousReleases()).toEqual([]);
        } finally {
          harness.readySpy.mockRestore();
        }
      }),
      { seed: SEED, numRuns: 80 },
    );
  });

  it("leaks zero objectGroups and never mixes sessions under adversarial faults at any step k", async () => {
    const faultArb = fc.record({
      kind: fc.constantFrom<FaultKind>(
        "staleObjectId",
        "frameDetached",
        "navigationLoaderChange",
        "oopifSessionSwap",
        "executionContextDestroyed",
        "cdpClosed",
        "timeout",
        "abort",
        "lateReplyAfterTimeout",
      ),
      triggerCallIndex: fc.integer({ min: 0, max: 10 }),
      lateRejects: fc.boolean(),
    });

    await fc.assert(
      fc.asyncProperty(
        worldSpecArb,
        chainArb,
        resolutionArb,
        faultArb,
        async (spec, chain, resolution, fault) => {
          const controller = new AbortController();
          const harness = createMockHarness(spec, {
            kind: fault.kind,
            triggerCallIndex: fault.triggerCallIndex,
            controller,
          });
          const timeout =
            fault.kind === "timeout" || fault.kind === "lateReplyAfterTimeout" ? 60 : 0;
          const progress = makeProgress(timeout);
          if (fault.kind === "abort") {
            vi.spyOn(progress, "signal", "get").mockReturnValue(controller.signal);
          }

          try {
            const resolver = new FrameChainResolver(harness.page, harness.root, {
              readinessRetries: "none",
            });

            const settled = resolver.resolve(chain, resolution, progress).then(
              () => ({ ok: true as const }),
              (err) => ({ ok: false as const, err }),
            );

            await vi.advanceTimersByTimeAsync(1500);
            const outcome = await settled;

            if (fault.kind === "timeout" && harness.lateGates.length > 0) {
              expect(outcome.ok).toBe(false);
              if (!outcome.ok) expect(outcome.err).toBeInstanceOf(TimeoutError);
            }

            for (const { gate, session, group } of harness.lateGates) {
              if (group) {
                session.allocatedGroups.add(group);
                session.liveGroups.add(group);
              }
              if (fault.lateRejects) {
                gate.reject(new Error("late CDP failure"));
              } else {
                gate.resolve({ result: { objectId: session.allocateObject("late", group) } });
              }
            }
            await vi.advanceTimersByTimeAsync(1500);

            expect(harness.peakDescribes()).toBeLessThanOrEqual(4);
            expect(harness.totalLiveGroups()).toBe(0);
            expect(harness.totalLiveObjects()).toBe(0);
            expect(harness.allViolations()).toEqual([]);
            expect(harness.allSpuriousReleases()).toEqual([]);
          } finally {
            progress.dispose();
            harness.readySpy.mockRestore();
          }
        },
      ),
      { seed: SEED, numRuns: 90 },
    );
  });

  it("never leaks groups or violates concurrency/ordering in FrameElementChainResolver", async () => {
    const simpleChain: LocatorChain = {
      steps: [
        { type: "query", selector: { kind: "css", value: ".card" } },
        { type: "query", selector: { kind: "css", value: "button" } },
      ],
    };

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 14 }),
        fc.array(fc.constantFrom(0, 1, 4, 9), { minLength: 1, maxLength: 14 }),
        fc.constantFrom(
          "ok",
          "describeError",
          "timeout",
          "alreadyExpired",
          "sessionSwap",
        ) as fc.Arbitrary<"ok" | "describeError" | "timeout" | "alreadyExpired" | "sessionSwap">,
        fc.integer({ min: 0, max: 13 }),
        async (matchCount, delays, mode, failIdx) => {
          let active = 0;
          let peak = 0;
          const liveGroups = new Set<string>();
          const allocatedGroups = new Set<string>();
          const spuriousReleases: string[] = [];
          const swapSend = vi.fn(async () => ({}));
          const swapSession = {
            id: "swapped",
            send: swapSend,
            on() {},
            off() {},
            async close() {},
          } as unknown as CDPSessionLike;

          const send = vi.fn(async (method: string, params?: object): Promise<unknown> => {
            const p = (params ?? {}) as { objectGroup?: string; objectId?: string };
            if (method === "Runtime.evaluate") {
              allocatedGroups.add(p.objectGroup!);
              liveGroups.add(p.objectGroup!);
              if (mode === "sessionSwap") {
                Object.defineProperty(frame, "session", { value: swapSession, configurable: true });
              }
              return { result: { objectId: "arr-1", type: "object" } };
            }
            if (method === "Runtime.getProperties") {
              return {
                result: Array.from({ length: matchCount }, (_, i) => ({
                  name: String(i),
                  value: { objectId: `el-${i}` },
                })).reverse(),
              };
            }
            if (method === "DOM.describeNode") {
              const idx = Number(p.objectId!.slice(3));
              active++;
              peak = Math.max(peak, active);
              try {
                if (mode === "timeout") {
                  await new Promise((resolve) => setTimeout(resolve, 200));
                } else {
                  const delay = delays[idx % delays.length] ?? 0;
                  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
                }
                if (mode === "describeError" && idx === failIdx % Math.max(1, matchCount)) {
                  throw new Error("stale node handle");
                }
                return { node: { backendNodeId: 500 + idx } };
              } finally {
                active--;
              }
            }
            if (method === "Runtime.releaseObjectGroup") {
              if (!allocatedGroups.has(p.objectGroup!)) spuriousReleases.push(p.objectGroup!);
              liveGroups.delete(p.objectGroup!);
              return {};
            }
            return {};
          });

          const session: CDPSessionLike = {
            id: "orig",
            send: send as CDPSessionLike["send"],
            on() {},
            off() {},
            async close() {},
          };
          const frame = { session, frameId: "f1" } as Frame;
          const progress = makeProgress(mode === "timeout" || mode === "alreadyExpired" ? 50 : 0);
          let nowSpy: MockInstance | undefined;
          const ready = vi
            .spyOn(executionContexts, "waitForLocatorWorld")
            .mockImplementation(async () => {
              if (mode === "alreadyExpired") {
                nowSpy = vi.spyOn(performance, "now").mockReturnValue(performance.now() + 60);
              }
              return { contextId: 7, kind: "extension", capabilities: { closedShadowRoots: true } };
            });

          try {
            const resolver = new FrameElementChainResolver(frame);
            const settled = resolver.resolve(simpleChain, { mode: "all" }, progress).then(
              (value) => ({ ok: true as const, value }),
              (err) => ({ ok: false as const, err }),
            );
            await vi.advanceTimersByTimeAsync(1500);
            const res = await settled;

            if (mode === "ok" || mode === "sessionSwap") {
              expect(res.ok).toBe(true);
              if (res.ok && res.value.mode !== "count") {
                expect(res.value.targets.map((t) => t.backendNodeId)).toEqual(
                  Array.from({ length: matchCount }, (_, i) => 500 + i),
                );
                expect(res.value.targets.every((t) => t.session === session)).toBe(true);
              }
            } else if (mode === "alreadyExpired") {
              expect(res.ok).toBe(false);
            } else if (matchCount > 0) {
              expect(res.ok).toBe(false);
            }

            expect(peak).toBeLessThanOrEqual(4);
            expect(liveGroups.size).toBe(0);
            expect(spuriousReleases).toEqual([]);
            expect(swapSend).not.toHaveBeenCalled();
          } finally {
            nowSpy?.mockRestore();
            progress.dispose();
            ready.mockRestore();
          }
        },
      ),
      { seed: SEED, numRuns: 70 },
    );
  });

  it("never mixes sessions across FrameSelectorResolver methods when frame.session swaps mid-flight", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("resolveAtIndex", "count", "resolveAll") as fc.Arbitrary<
          "resolveAtIndex" | "count" | "resolveAll"
        >,
        fc.constantFrom("duringReadiness", "duringEvaluate") as fc.Arbitrary<
          "duringReadiness" | "duringEvaluate"
        >,
        fc.integer({ min: 0, max: 3 }),
        async (method, swapPoint, index) => {
          const violations: Violation[] = [];
          const origContexts = new Set<number>([101]);
          const origObjects = new Set<string>();
          const origGroups = new Set<string>();
          const origLiveGroups = new Set<string>();
          const origLiveObjects = new Set<string>();
          let seq = 1;

          const makeReplacementSession = (): CDPSessionLike => ({
            id: "session-new",
            send: vi.fn(async (cdpMethod: string, params?: object) => {
              const p = (params ?? {}) as {
                contextId?: number;
                objectId?: string;
                objectGroup?: string;
              };
              if (p.contextId !== undefined && origContexts.has(p.contextId)) {
                violations.push({
                  sessionId: "session-new",
                  method: cdpMethod,
                  detail: `received old session contextId ${p.contextId}`,
                });
              }
              if (p.objectId !== undefined && origObjects.has(p.objectId)) {
                violations.push({
                  sessionId: "session-new",
                  method: cdpMethod,
                  detail: `received old session objectId ${p.objectId}`,
                });
              }
              if (p.objectGroup !== undefined && origGroups.has(p.objectGroup)) {
                violations.push({
                  sessionId: "session-new",
                  method: cdpMethod,
                  detail: `received old session objectGroup ${p.objectGroup}`,
                });
              }
              return { result: { value: 0 } };
            }) as CDPSessionLike["send"],
            on() {},
            off() {},
            async close() {},
          });

          const newSession = makeReplacementSession();
          const oldSession: CDPSessionLike = {
            id: "session-old",
            send: vi.fn(async (cdpMethod: string, params?: object) => {
              const p = (params ?? {}) as { objectGroup?: string; objectId?: string };
              if (cdpMethod === "Runtime.evaluate") {
                if (swapPoint === "duringEvaluate") {
                  frame.session = newSession;
                }
                if (method === "count") return { result: { value: 3 } };
                const objectId = `old-obj-${seq++}`;
                origObjects.add(objectId);
                if (p.objectGroup) {
                  origGroups.add(p.objectGroup);
                  origLiveGroups.add(p.objectGroup);
                } else {
                  origLiveObjects.add(objectId);
                }
                return { result: { objectId, type: "object" } };
              }
              if (cdpMethod === "Runtime.getProperties") {
                const objectId = `old-el-${seq++}`;
                origObjects.add(objectId);
                return { result: [{ name: "0", value: { objectId } }] };
              }
              if (cdpMethod === "DOM.requestNode") {
                return { nodeId: 99 };
              }
              if (cdpMethod === "Runtime.releaseObjectGroup") {
                origLiveGroups.delete(p.objectGroup!);
                return {};
              }
              if (cdpMethod === "Runtime.releaseObject") {
                origLiveObjects.delete(p.objectId!);
                return {};
              }
              return {};
            }) as CDPSessionLike["send"],
            on() {},
            off() {},
            async close() {},
          };

          const frame = { session: oldSession, frameId: "frame-swap" } as Frame;
          const ready = vi
            .spyOn(executionContexts, "waitForLocatorWorld")
            .mockImplementation(async (session) => {
              expect(session).toBe(oldSession);
              if (swapPoint === "duringReadiness") {
                frame.session = newSession;
              }
              return {
                contextId: 101,
                kind: "extension",
                capabilities: { closedShadowRoots: true },
              };
            });

          try {
            const resolver = new FrameSelectorResolver(frame);
            const query = { kind: "css" as const, value: "button" };
            if (method === "resolveAtIndex") {
              const node = await resolver.resolveAtIndex(query, index);
              if (node) {
                await oldSession.send("Runtime.releaseObject", { objectId: node.objectId });
              }
            } else if (method === "count") {
              await resolver.count(query);
            } else {
              const batch = await resolver.resolveAll(query);
              await batch.release();
            }

            expect(violations).toEqual([]);
            expect(origLiveGroups.size).toBe(0);
            expect(origLiveObjects.size).toBe(0);
          } finally {
            ready.mockRestore();
          }
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  });

  it("preserves ChainLocatorDelegate immutability, nth validation, and TargetLocator cleanup", async () => {
    const invalidIndexArb = fc.oneof(
      fc.integer({ min: -1000, max: -1 }),
      fc.double({ min: 0.01, max: 100, noInteger: true, noNaN: true }),
      fc.constantFrom(
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ),
    );

    await fc.assert(
      fc.asyncProperty(
        worldSpecArb,
        invalidIndexArb,
        fc.integer({ min: 0, max: 4 }),
        async (spec, badIndex, goodIndex) => {
          const harness = createMockHarness(spec);
          try {
            const baseChain: LocatorChain = {
              steps: [{ type: "query", selector: { kind: "css", value: "btn" } }],
            };
            const base = new ChainLocatorDelegate(harness.page, baseChain);

            expect(() => base.nth(badIndex)).toThrow(RangeError);

            const narrowed = base.nth(goodIndex);
            const first = base.first();
            expect(base.chain.steps).toHaveLength(1);
            expect(narrowed.chain.steps).toEqual([
              ...baseChain.steps,
              { type: "nth", index: goodIndex },
            ]);
            expect(first.chain.steps).toEqual([...baseChain.steps, { type: "nth", index: 0 }]);

            const progress = makeProgress(0);
            try {
              const countPending = base.count(progress);
              await vi.advanceTimersByTimeAsync(500);
              const count = await countPending;

              const allPending = base.all(progress);
              await vi.advanceTimersByTimeAsync(500);
              const allLocators = await allPending;
              expect(allLocators).toHaveLength(count);

              if (count > 0) {
                const realPending = first.real(progress);
                await vi.advanceTimersByTimeAsync(500);
                const firstLocator = await realPending;
                const maskPending = firstLocator.resolveNodesForMask(progress);
                await vi.advanceTimersByTimeAsync(500);
                const mask = await maskPending;
                expect(mask.nodes).toHaveLength(1);
                await mask.release();
              }
            } finally {
              progress.dispose();
            }

            await expect(
              new FrameElementChainResolver(harness.root).resolve(baseChain, {
                mode: "selected",
                index: badIndex,
              }),
            ).rejects.toThrow(RangeError);
            await expect(
              new FrameChainResolver(harness.page).resolve(baseChain, {
                mode: "selected",
                index: badIndex,
              }),
            ).rejects.toThrow(RangeError);

            await expect(
              new FrameSelectorResolver(harness.root).resolveAtIndex(
                { kind: "css", value: "btn" },
                badIndex,
              ),
            ).resolves.toBeNull();
            const emptyBatch = await new FrameSelectorResolver(harness.root).resolveAll(
              { kind: "css", value: "btn" },
              { start: badIndex },
            );
            expect(emptyBatch.nodes).toEqual([]);

            expect(harness.totalLiveGroups()).toBe(0);
            expect(harness.totalLiveObjects()).toBe(0);
            expect(harness.allViolations()).toEqual([]);
            expect(harness.allSpuriousReleases()).toEqual([]);
          } finally {
            harness.readySpy.mockRestore();
          }
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  });

  it("does not emit spurious releaseObjectGroup when progress expires before FrameChainResolver dispatches CDP", async () => {
    await fc.assert(
      fc.asyncProperty(worldSpecArb, chainArb, async (spec, chain) => {
        const harness = createMockHarness(spec);
        const progress = makeProgress(50);
        let nowSpy: MockInstance | undefined;
        let sessionChecks = 0;
        const origGetSession = harness.page.getSessionForFrame.bind(harness.page);
        harness.page.getSessionForFrame = (frameId: string) => {
          sessionChecks++;
          if (sessionChecks === 2) {
            nowSpy = vi.spyOn(performance, "now").mockReturnValue(performance.now() + 60);
          }
          return origGetSession(frameId);
        };
        try {
          await expect(
            new FrameChainResolver(harness.page, harness.root, {
              readinessRetries: "none",
            }).resolve(chain, { mode: "count" }, progress),
          ).rejects.toBeInstanceOf(TimeoutError);
          expect(harness.totalLiveGroups()).toBe(0);
          expect(harness.allSpuriousReleases()).toEqual([]);
        } finally {
          nowSpy?.mockRestore();
          progress.dispose();
          harness.readySpy.mockRestore();
        }
      }),
      { seed: SEED, numRuns: 30 },
    );
  });

  it("rejects partial Runtime.getProperties handles cleanly without leaking objectGroups", async () => {
    const spec = buildWorldSpec(0, [0], [false], [4], [0]);
    const harness = createMockHarness(spec);
    const mainInst = harness.sessions.get("main")!;
    const origSend = mainInst.session.send.bind(mainInst.session);
    mainInst.session.send = (async (method: string, params?: object) => {
      if (method === "Runtime.getProperties") {
        return { result: [] };
      }
      return origSend(method, params);
    }) as CDPSessionLike["send"];

    try {
      await expect(
        new FrameChainResolver(harness.page, harness.root, {
          readinessRetries: "none",
        }).resolve(
          { steps: [{ type: "query", selector: { kind: "css", value: "btn" } }] },
          { mode: "all" },
        ),
      ).rejects.toThrow("Missing frame chain target handles");
      expect(harness.totalLiveGroups()).toBe(0);
      expect(harness.allViolations()).toEqual([]);
      expect(harness.allSpuriousReleases()).toEqual([]);
    } finally {
      harness.readySpy.mockRestore();
    }
  });
});
