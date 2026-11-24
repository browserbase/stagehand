import type { Protocol } from "devtools-protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FrameRegistry } from "./frameRegistry.js";

const SESSION_POOL = ["session-root", "session-oopif-a", "session-oopif-b"] as const;

type SessionId = (typeof SESSION_POOL)[number];

type FrameModel = {
  rootFrameId: string;
  knownFrames: string[];
  nextId: number;
};

function makeProtocolFrame(
  id: string,
  parentId: string | undefined,
  url: string,
  loaderId: string,
): Protocol.Page.Frame {
  return {
    id,
    ...(parentId === undefined ? {} : { parentId }),
    loaderId,
    url,
    domainAndRegistry: "",
    securityOrigin: "https://example.test",
    mimeType: "text/html",
    secureContextType: "Secure",
    crossOriginIsolatedContextType: "NotIsolated",
    gatedAPIFeatures: [],
  };
}

function assertFrameRegistryInvariants(registry: FrameRegistry, contextLabel: string): void {
  const { frames, framesBySession, rootFrameId } = registry;

  if (frames.size > 0) {
    const rootInfo = frames.get(rootFrameId);
    expect(
      rootInfo,
      `${contextLabel}: rootFrameId "${rootFrameId}" must exist in frames`,
    ).toBeDefined();
    expect(
      rootInfo?.parentId,
      `${contextLabel}: root "${rootFrameId}" must have parentId === null`,
    ).toBeNull();
  }

  for (const [frameId, info] of frames.entries()) {
    if (info.parentId !== null) {
      const parent = frames.get(info.parentId);
      expect(
        parent,
        `${contextLabel}: parent "${info.parentId}" of "${frameId}" must exist in frames`,
      ).toBeDefined();
      expect(
        parent?.children.has(frameId),
        `${contextLabel}: parent "${info.parentId}".children must contain "${frameId}"`,
      ).toBe(true);
    }

    for (const childId of info.children) {
      const child = frames.get(childId);
      expect(
        child,
        `${contextLabel}: child "${childId}" of "${frameId}" must exist in frames`,
      ).toBeDefined();
      expect(
        child?.parentId,
        `${contextLabel}: child "${childId}".parentId must equal "${frameId}"`,
      ).toBe(frameId);
    }
  }

  const visited = new Set<string>();
  const dfs = (frameId: string): void => {
    expect(
      visited.has(frameId),
      `${contextLabel}: cycle or duplicate parent edge detected at "${frameId}"`,
    ).toBe(false);
    visited.add(frameId);
    const info = frames.get(frameId);
    if (!info) return;
    for (const childId of info.children) {
      dfs(childId);
    }
  };
  if (frames.has(rootFrameId)) {
    dfs(rootFrameId);
  }
  expect(
    visited.size,
    `${contextLabel}: orphan frames detected (reachable=${visited.size}, total=${frames.size}, all=[${[...frames.keys()].join(",")}], reachable=[${[...visited].join(",")}])`,
  ).toBe(frames.size);

  for (const [frameId, info] of frames.entries()) {
    if (info.ownerSessionId !== undefined) {
      const bag = framesBySession.get(info.ownerSessionId);
      expect(
        bag?.has(frameId),
        `${contextLabel}: framesBySession["${info.ownerSessionId}"] must contain "${frameId}"`,
      ).toBe(true);
    }
    for (const [sessionId, bag] of framesBySession.entries()) {
      if (sessionId !== info.ownerSessionId) {
        expect(
          bag.has(frameId),
          `${contextLabel}: framesBySession["${sessionId}"] must not contain "${frameId}" (owner=${String(info.ownerSessionId)})`,
        ).toBe(false);
      }
    }
  }

  for (const [sessionId, bag] of framesBySession.entries()) {
    expect(
      bag.size,
      `${contextLabel}: framesBySession["${sessionId}"] must not be empty`,
    ).toBeGreaterThan(0);
    for (const frameId of bag) {
      const info = frames.get(frameId);
      expect(
        info,
        `${contextLabel}: framesBySession["${sessionId}"] references missing frame "${frameId}"`,
      ).toBeDefined();
      expect(
        info?.ownerSessionId,
        `${contextLabel}: frame "${frameId}" ownerSessionId must match "${sessionId}"`,
      ).toBe(sessionId);
    }
  }

  const listed = registry.listAllFrames();
  expect(listed.length, `${contextLabel}: listAllFrames() length must match frames.size`).toBe(
    frames.size,
  );
  expect(new Set(listed).size, `${contextLabel}: listAllFrames() must not contain duplicates`).toBe(
    listed.length,
  );
  expect(new Set(listed), `${contextLabel}: listAllFrames() set must match frames.keys()`).toEqual(
    new Set(frames.keys()),
  );
  if (listed.length > 0) {
    expect(listed[0], `${contextLabel}: listAllFrames()[0] must be rootFrameId`).toBe(rootFrameId);
  }
}

function syncModel(model: FrameModel, registry: FrameRegistry): void {
  model.rootFrameId = registry.mainFrameId();
  model.knownFrames = [...registry.frames.keys()];
}

class AttachFreshChildCommand implements fc.Command<FrameModel, FrameRegistry> {
  constructor(
    readonly parentIdx: number,
    readonly sessionId: SessionId,
  ) {}

  check(model: Readonly<FrameModel>): boolean {
    return model.knownFrames.length > 0;
  }

  run(model: FrameModel, registry: FrameRegistry): void {
    const parentId = model.knownFrames[this.parentIdx % model.knownFrames.length]!;
    const frameId = `frame-${model.nextId++}`;
    registry.onFrameAttached(frameId, parentId, this.sessionId);
    syncModel(model, registry);
    assertFrameRegistryInvariants(registry, this.toString());
  }

  toString(): string {
    return `AttachFreshChild(parentIdx=${this.parentIdx}, session=${this.sessionId})`;
  }
}

class ReattachExistingChildCommand implements fc.Command<FrameModel, FrameRegistry> {
  constructor(
    readonly childIdx: number,
    readonly newParentIdx: number,
    readonly sessionId: SessionId,
  ) {}

  check(model: Readonly<FrameModel>): boolean {
    return model.knownFrames.length >= 3;
  }

  run(model: FrameModel, registry: FrameRegistry): void {
    const nonRoots = model.knownFrames.filter((id) => id !== model.rootFrameId);
    if (nonRoots.length < 2) return;
    const childId = nonRoots[this.childIdx % nonRoots.length]!;

    const descendants = new Set<string>();
    const collect = (id: string): void => {
      descendants.add(id);
      for (const kid of registry.frames.get(id)?.children ?? []) {
        if (!descendants.has(kid)) collect(kid);
      }
    };
    collect(childId);

    const eligibleParents = model.knownFrames.filter((id) => !descendants.has(id));
    if (eligibleParents.length === 0) return;
    const newParentId = eligibleParents[this.newParentIdx % eligibleParents.length]!;

    registry.onFrameAttached(childId, newParentId, this.sessionId);
    syncModel(model, registry);
    assertFrameRegistryInvariants(registry, this.toString());
  }

  toString(): string {
    return `ReattachExistingChild(childIdx=${this.childIdx}, newParentIdx=${this.newParentIdx}, session=${this.sessionId})`;
  }
}

class AttachRootSwapCommand implements fc.Command<FrameModel, FrameRegistry> {
  constructor(readonly sessionId: SessionId) {}

  check(model: Readonly<FrameModel>): boolean {
    return model.knownFrames.length > 0;
  }

  run(model: FrameModel, registry: FrameRegistry): void {
    const newRootId = `frame-${model.nextId++}`;
    registry.onFrameAttached(newRootId, null, this.sessionId);
    syncModel(model, registry);
    assertFrameRegistryInvariants(registry, this.toString());
  }

  toString(): string {
    return `AttachRootSwap(session=${this.sessionId})`;
  }
}

class NavigateExistingFrameCommand implements fc.Command<FrameModel, FrameRegistry> {
  constructor(
    readonly frameIdx: number,
    readonly sessionId: SessionId,
    readonly urlSuffix: number,
  ) {}

  check(model: Readonly<FrameModel>): boolean {
    return model.knownFrames.length > 0;
  }

  run(model: FrameModel, registry: FrameRegistry): void {
    const frameId = model.knownFrames[this.frameIdx % model.knownFrames.length]!;
    const parentId = registry.getParent(frameId) ?? undefined;
    const frame = makeProtocolFrame(
      frameId,
      parentId,
      `https://example.test/page-${this.urlSuffix}`,
      `loader-${this.urlSuffix}`,
    );
    registry.onFrameNavigated(frame, this.sessionId);
    syncModel(model, registry);
    assertFrameRegistryInvariants(registry, this.toString());
  }

  toString(): string {
    return `NavigateExistingFrame(frameIdx=${this.frameIdx}, session=${this.sessionId}, url=${this.urlSuffix})`;
  }
}

class NavigateRootSwapCommand implements fc.Command<FrameModel, FrameRegistry> {
  constructor(
    readonly sessionId: SessionId,
    readonly urlSuffix: number,
  ) {}

  check(model: Readonly<FrameModel>): boolean {
    return model.knownFrames.length > 0;
  }

  run(model: FrameModel, registry: FrameRegistry): void {
    const newRootId = `frame-${model.nextId++}`;
    const frame = makeProtocolFrame(
      newRootId,
      undefined,
      `https://example.test/root-${this.urlSuffix}`,
      `loader-root-${this.urlSuffix}`,
    );
    registry.onFrameNavigated(frame, this.sessionId);
    syncModel(model, registry);
    assertFrameRegistryInvariants(registry, this.toString());
  }

  toString(): string {
    return `NavigateRootSwap(session=${this.sessionId}, url=${this.urlSuffix})`;
  }
}

class NavigateBeforeAttachChildCommand implements fc.Command<FrameModel, FrameRegistry> {
  constructor(
    readonly parentIdx: number,
    readonly sessionId: SessionId,
    readonly urlSuffix: number,
  ) {}

  check(model: Readonly<FrameModel>): boolean {
    return model.knownFrames.length > 0;
  }

  run(model: FrameModel, registry: FrameRegistry): void {
    const parentId = model.knownFrames[this.parentIdx % model.knownFrames.length]!;
    const newChildId = `frame-${model.nextId++}`;
    const frame = makeProtocolFrame(
      newChildId,
      parentId,
      `https://example.test/child-${this.urlSuffix}`,
      `loader-child-${this.urlSuffix}`,
    );
    registry.onFrameNavigated(frame, this.sessionId);
    syncModel(model, registry);
    assertFrameRegistryInvariants(registry, this.toString());
  }

  toString(): string {
    return `NavigateBeforeAttachChild(parentIdx=${this.parentIdx}, session=${this.sessionId}, url=${this.urlSuffix})`;
  }
}

class DetachNonRootFrameCommand implements fc.Command<FrameModel, FrameRegistry> {
  constructor(
    readonly frameIdx: number,
    readonly reason: "remove" | "swap",
  ) {}

  check(model: Readonly<FrameModel>): boolean {
    return model.knownFrames.length > 1;
  }

  run(model: FrameModel, registry: FrameRegistry): void {
    const nonRoots = model.knownFrames.filter((id) => id !== model.rootFrameId);
    if (nonRoots.length === 0) return;
    const frameId = nonRoots[this.frameIdx % nonRoots.length]!;
    registry.onFrameDetached(frameId, this.reason);
    syncModel(model, registry);
    assertFrameRegistryInvariants(registry, this.toString());
  }

  toString(): string {
    return `DetachNonRootFrame(frameIdx=${this.frameIdx}, reason=${this.reason})`;
  }
}

class AdoptChildSessionCommand implements fc.Command<FrameModel, FrameRegistry> {
  constructor(
    readonly frameIdx: number,
    readonly sessionId: SessionId,
  ) {}

  check(model: Readonly<FrameModel>): boolean {
    return model.knownFrames.length > 0;
  }

  run(model: FrameModel, registry: FrameRegistry): void {
    const frameId = model.knownFrames[this.frameIdx % model.knownFrames.length]!;
    registry.adoptChildSession(this.sessionId, frameId);
    syncModel(model, registry);
    assertFrameRegistryInvariants(registry, this.toString());
  }

  toString(): string {
    return `AdoptChildSession(frameIdx=${this.frameIdx}, session=${this.sessionId})`;
  }
}

class SeedFromFrameTreeCommand implements fc.Command<FrameModel, FrameRegistry> {
  constructor(
    readonly anchorIdx: number,
    readonly sessionId: SessionId,
    readonly childCount: number,
    readonly grandchildCount: number,
    readonly omitAnchorParentId: boolean,
  ) {}

  check(model: Readonly<FrameModel>): boolean {
    return model.knownFrames.length > 0;
  }

  run(model: FrameModel, registry: FrameRegistry): void {
    const anchorId = model.knownFrames[this.anchorIdx % model.knownFrames.length]!;
    const anchorParent = this.omitAnchorParentId
      ? undefined
      : (registry.getParent(anchorId) ?? undefined);
    const childFrames: Protocol.Page.FrameTree[] = [];

    for (let i = 0; i < this.childCount; i++) {
      const childId = `frame-${model.nextId++}`;
      const grandChildren: Protocol.Page.FrameTree[] = [];
      if (i === 0) {
        for (let j = 0; j < this.grandchildCount; j++) {
          const grandId = `frame-${model.nextId++}`;
          grandChildren.push({
            frame: makeProtocolFrame(grandId, childId, `https://example.test/${grandId}`, "seed"),
          });
        }
      }
      childFrames.push({
        frame: makeProtocolFrame(childId, anchorId, `https://example.test/${childId}`, "seed"),
        ...(grandChildren.length > 0 ? { childFrames: grandChildren } : {}),
      });
    }

    const tree: Protocol.Page.FrameTree = {
      frame: makeProtocolFrame(anchorId, anchorParent, `https://example.test/${anchorId}`, "seed"),
      ...(childFrames.length > 0 ? { childFrames } : {}),
    };
    registry.seedFromFrameTree(this.sessionId, tree);
    syncModel(model, registry);
    assertFrameRegistryInvariants(registry, this.toString());
  }

  toString(): string {
    return `SeedFromFrameTree(anchorIdx=${this.anchorIdx}, session=${this.sessionId}, children=${this.childCount}, grandchildren=${this.grandchildCount}, omitParent=${this.omitAnchorParentId})`;
  }
}

class SetOwnerBackendNodeIdCommand implements fc.Command<FrameModel, FrameRegistry> {
  constructor(
    readonly frameIdx: number,
    readonly backendNodeId: number,
  ) {}

  check(model: Readonly<FrameModel>): boolean {
    return model.knownFrames.length > 1;
  }

  run(model: FrameModel, registry: FrameRegistry): void {
    const nonRoots = model.knownFrames.filter((id) => id !== model.rootFrameId);
    if (nonRoots.length === 0) return;
    const frameId = nonRoots[this.frameIdx % nonRoots.length]!;
    registry.setOwnerBackendNodeId(frameId, this.backendNodeId);
    syncModel(model, registry);
    assertFrameRegistryInvariants(registry, this.toString());
    expect(registry.getOwnerBackendNodeId(frameId)).toBe(this.backendNodeId);
  }

  toString(): string {
    return `SetOwnerBackendNodeId(frameIdx=${this.frameIdx}, backendNodeId=${this.backendNodeId})`;
  }
}

const sessionArb = fc.constantFrom<SessionId>(...SESSION_POOL);
const idxArb = fc.integer({ min: 0, max: 10 });

describe("FrameRegistry stateful properties", () => {
  it("preserves tree, inverse session map, and listing invariants across valid CDP event sequences", () => {
    const commandsArb = fc.commands(
      [
        fc.tuple(idxArb, sessionArb).map(([p, s]) => new AttachFreshChildCommand(p, s)),
        fc
          .tuple(idxArb, idxArb, sessionArb)
          .map(([c, p, s]) => new ReattachExistingChildCommand(c, p, s)),
        sessionArb.map((s) => new AttachRootSwapCommand(s)),
        fc
          .tuple(idxArb, sessionArb, fc.integer({ min: 0, max: 20 }))
          .map(([f, s, u]) => new NavigateExistingFrameCommand(f, s, u)),
        fc
          .tuple(sessionArb, fc.integer({ min: 0, max: 20 }))
          .map(([s, u]) => new NavigateRootSwapCommand(s, u)),
        fc
          .tuple(idxArb, sessionArb, fc.integer({ min: 0, max: 20 }))
          .map(([p, s, u]) => new NavigateBeforeAttachChildCommand(p, s, u)),
        fc
          .tuple(idxArb, fc.constantFrom<"remove" | "swap">("remove", "swap"))
          .map(([f, r]) => new DetachNonRootFrameCommand(f, r)),
        fc.tuple(idxArb, sessionArb).map(([f, s]) => new AdoptChildSessionCommand(f, s)),
        fc
          .tuple(
            idxArb,
            sessionArb,
            fc.integer({ min: 0, max: 2 }),
            fc.integer({ min: 0, max: 2 }),
            fc.boolean(),
          )
          .map(([a, s, c, g, omitParent]) => new SeedFromFrameTreeCommand(a, s, c, g, omitParent)),
        fc
          .tuple(idxArb, fc.integer({ min: 1, max: 10_000 }))
          .map(([f, nodeId]) => new SetOwnerBackendNodeIdCommand(f, nodeId)),
      ],
      { maxCommands: 40 },
    );

    fc.assert(
      fc.property(commandsArb, (commands) => {
        const setup = () => {
          const registry = new FrameRegistry("target-1", "frame-0");
          const model: FrameModel = {
            rootFrameId: "frame-0",
            knownFrames: ["frame-0"],
            nextId: 1,
          };
          assertFrameRegistryInvariants(registry, "initial");
          return { model, real: registry };
        };
        fc.modelRun(setup, commands);
      }),
      { seed: 20261124, numRuns: 200 },
    );
  });

  it("preserves invariants when onFrameNavigated performs a main-frame root swap", () => {
    const commandsArb = fc.commands(
      [
        fc.tuple(idxArb, sessionArb).map(([p, s]) => new AttachFreshChildCommand(p, s)),
        fc
          .tuple(sessionArb, fc.integer({ min: 0, max: 20 }))
          .map(([s, u]) => new NavigateRootSwapCommand(s, u)),
        fc
          .tuple(idxArb, sessionArb, fc.integer({ min: 0, max: 20 }))
          .map(([f, s, u]) => new NavigateExistingFrameCommand(f, s, u)),
        fc
          .tuple(idxArb, fc.constantFrom<"remove" | "swap">("remove", "swap"))
          .map(([f, r]) => new DetachNonRootFrameCommand(f, r)),
        fc.tuple(idxArb, sessionArb).map(([f, s]) => new AdoptChildSessionCommand(f, s)),
      ],
      { maxCommands: 25 },
    );

    fc.assert(
      fc.property(commandsArb, (commands) => {
        const setup = () => {
          const registry = new FrameRegistry("target-1", "frame-0");
          const model: FrameModel = {
            rootFrameId: "frame-0",
            knownFrames: ["frame-0"],
            nextId: 1,
          };
          return { model, real: registry };
        };
        fc.modelRun(setup, commands);
      }),
      { seed: 20261125, numRuns: 100 },
    );
  });

  it("preserves invariants when an existing child is re-attached under a different parent", () => {
    const commandsArb = fc.commands(
      [
        fc.tuple(idxArb, sessionArb).map(([p, s]) => new AttachFreshChildCommand(p, s)),
        fc
          .tuple(idxArb, idxArb, sessionArb)
          .map(([c, p, s]) => new ReattachExistingChildCommand(c, p, s)),
        fc
          .tuple(idxArb, fc.constantFrom<"remove" | "swap">("remove", "swap"))
          .map(([f, r]) => new DetachNonRootFrameCommand(f, r)),
      ],
      { maxCommands: 25 },
    );

    fc.assert(
      fc.property(commandsArb, (commands) => {
        const setup = () => {
          const registry = new FrameRegistry("target-1", "frame-0");
          const model: FrameModel = {
            rootFrameId: "frame-0",
            knownFrames: ["frame-0"],
            nextId: 1,
          };
          return { model, real: registry };
        };
        fc.modelRun(setup, commands);
      }),
      { seed: 20261126, numRuns: 100 },
    );
  });

  it("preserves invariants when onFrameNavigated arrives before onFrameAttached for a child frame", () => {
    const commandsArb = fc.commands(
      [
        fc.tuple(idxArb, sessionArb).map(([p, s]) => new AttachFreshChildCommand(p, s)),
        fc
          .tuple(idxArb, sessionArb, fc.integer({ min: 0, max: 20 }))
          .map(([p, s, u]) => new NavigateBeforeAttachChildCommand(p, s, u)),
      ],
      { maxCommands: 20 },
    );

    fc.assert(
      fc.property(commandsArb, (commands) => {
        const setup = () => {
          const registry = new FrameRegistry("target-1", "frame-0");
          const model: FrameModel = {
            rootFrameId: "frame-0",
            knownFrames: ["frame-0"],
            nextId: 1,
          };
          return { model, real: registry };
        };
        fc.modelRun(setup, commands);
      }),
      { seed: 20261127, numRuns: 100 },
    );
  });

  it("preserves acyclicity and inverse maps when root swap reuses an existing child frameId", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        sessionArb,
        sessionArb,
        (childCount, initialSession, swapSession) => {
          const registry = new FrameRegistry("target-1", "frame-0");
          for (let i = 1; i <= childCount; i++) {
            registry.onFrameAttached(`frame-${i}`, "frame-0", initialSession);
          }
          registry.onFrameAttached("frame-1", null, swapSession);
          assertFrameRegistryInvariants(registry, "root swap onto existing child frame-1");
        },
      ),
      { seed: 20261128, numRuns: 50 },
    );
  });
});
