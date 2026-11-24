import type { Protocol } from "devtools-protocol";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "../errors.js";
import type { CDPSessionLike } from "./cdp.js";
import { ExecutionContextRegistry, type LocatorWorld } from "./executionContextRegistry.js";
import { Progress } from "./progress.js";

const FRAME_POOL = ["frame-0", "frame-1", "frame-2"] as const;
type FrameId = (typeof FRAME_POOL)[number];

type FrameProtocol = "https:" | "data:" | "about:" | "blob:";

class SimulatedCdpSession implements CDPSessionLike {
  readonly id = "sim-session";
  private readonly handlers = new Map<string, Set<(params: unknown) => void>>();
  readonly readyExtensionContexts = new Set<number>();
  readonly frameProtocols = new Map<string, FrameProtocol>();
  readonly installedFallbacks = new Set<number>();
  readonly createIsolatedWorldCalls = new Map<string, number>();
  readonly inflightFallbackInstalls = new Map<string, number>();
  readonly maxConcurrentFallbackInstalls = new Map<string, number>();
  readonly staleFallbackExecIds = new Set<number>();
  private clearCount = 0;
  nextFallbackExecId = 10_000;
  closed = false;
  createWorldDelayMs = 0;
  evaluateDelayMs = 0;
  installEvaluateDelayMs = 0;
  rejectFallbackInstallOnClear = false;

  async send<R = unknown>(method: string, params?: object): Promise<R> {
    if (this.closed) {
      throw new Error("CDP connection closed: simulated disconnect");
    }

    if (method === "Runtime.enable") {
      return {} as R;
    }

    if (method === "Page.createIsolatedWorld") {
      const frameId = (params as { frameId: string }).frameId;
      const startClearCount = this.clearCount;
      this.createIsolatedWorldCalls.set(
        frameId,
        (this.createIsolatedWorldCalls.get(frameId) ?? 0) + 1,
      );
      const current = (this.inflightFallbackInstalls.get(frameId) ?? 0) + 1;
      this.inflightFallbackInstalls.set(frameId, current);
      const prevMax = this.maxConcurrentFallbackInstalls.get(frameId) ?? 0;
      if (current > prevMax) this.maxConcurrentFallbackInstalls.set(frameId, current);

      try {
        if (this.createWorldDelayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, this.createWorldDelayMs));
        }
        if (this.closed) {
          throw new Error("CDP connection closed: simulated disconnect during createIsolatedWorld");
        }
        const executionContextId = this.nextFallbackExecId++;
        if (this.clearCount !== startClearCount) {
          this.staleFallbackExecIds.add(executionContextId);
        }
        return { executionContextId } as R;
      } finally {
        this.inflightFallbackInstalls.set(
          frameId,
          Math.max(0, (this.inflightFallbackInstalls.get(frameId) ?? 1) - 1),
        );
      }
    }

    if (method === "Runtime.evaluate") {
      const { expression = "", contextId } = (params ?? {}) as {
        expression?: string;
        contextId?: number;
      };
      const startClearCount = this.clearCount;
      // Snapshot readiness before transport latency (models response already computed on renderer wire).
      const readyAtDispatch =
        typeof contextId === "number" && this.readyExtensionContexts.has(contextId);
      const isFallbackInstall = expression.startsWith("install locator runtime");
      const delayMs =
        isFallbackInstall && this.installEvaluateDelayMs > 0
          ? this.installEvaluateDelayMs
          : this.evaluateDelayMs;
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      if (this.closed) {
        throw new Error("CDP connection closed: simulated disconnect during evaluate");
      }

      if (expression.includes("location?.protocol")) {
        const protocol = this.protocolForContext(contextId);
        return { result: { type: "string", value: protocol } } as R;
      }

      if (isFallbackInstall) {
        if (this.rejectFallbackInstallOnClear && this.clearCount !== startClearCount) {
          throw new Error("-32000 Cannot find context with specified id");
        }
        if (typeof contextId === "number") this.installedFallbacks.add(contextId);
        return { result: { type: "undefined" } } as R;
      }

      if (expression.includes("__stagehandLocatorScripts")) {
        const ready = typeof contextId === "number" && this.installedFallbacks.has(contextId);
        return {
          result: {
            type: "object",
            value: {
              ready,
              kind: ready ? "cdp-fallback" : "unknown",
              closedShadowRoots: false,
            },
          },
        } as R;
      }

      const ready = readyAtDispatch;
      return {
        result: {
          type: "object",
          value: {
            ready,
            marker: ready,
            domApi: ready ? "function" : "undefined",
            runtimeId: ready ? "string" : "undefined",
          },
        },
      } as R;
    }

    return {} as R;
  }

  private readonly contextFrame = new Map<number, string>();

  private protocolForContext(contextId: number | undefined): FrameProtocol {
    if (contextId === undefined) return "https:";
    const frameId = this.contextFrame.get(contextId);
    return (frameId ? this.frameProtocols.get(frameId) : undefined) ?? "https:";
  }

  emitContextCreated(
    id: number,
    frameId: string,
    isDefault: boolean,
    readyExtension: boolean,
  ): void {
    this.contextFrame.set(id, frameId);
    if (readyExtension) this.readyExtensionContexts.add(id);
    else this.readyExtensionContexts.delete(id);

    const evt: Protocol.Runtime.ExecutionContextCreatedEvent = {
      context: {
        id,
        origin: isDefault ? "https://example.test" : "chrome-extension://stagehand",
        name: isDefault ? "" : "Stagehand",
        uniqueId: `ctx-${id}`,
        auxData: { frameId, isDefault },
      },
    };
    this.emit("Runtime.executionContextCreated", evt);
  }

  emitContextDestroyed(executionContextId: number): void {
    this.readyExtensionContexts.delete(executionContextId);
    this.installedFallbacks.delete(executionContextId);
    this.contextFrame.delete(executionContextId);
    this.emit("Runtime.executionContextDestroyed", {
      executionContextId,
      executionContextUniqueId: `ctx-${executionContextId}`,
    });
  }

  emitContextsCleared(): void {
    this.clearCount++;
    this.readyExtensionContexts.clear();
    this.installedFallbacks.clear();
    this.contextFrame.clear();
    this.emit("Runtime.executionContextsCleared", {});
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.handlers.get(event) ?? new Set<(params: unknown) => void>();
    set.add(handler as (params: unknown) => void);
    this.handlers.set(event, set);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    this.handlers.get(event)?.delete(handler as (params: unknown) => void);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  emit(event: string, params: unknown): void {
    for (const handler of Array.from(this.handlers.get(event) ?? [])) {
      handler(params);
    }
  }
}

function assertBijectiveMaps(
  fwd: Map<string, number> | undefined,
  rev: Map<number, string> | undefined,
  label: string,
): void {
  const f = fwd ?? new Map<string, number>();
  const r = rev ?? new Map<number, string>();

  for (const [frameId, execId] of f.entries()) {
    expect(r.get(execId), `${label}: reverse[${execId}] must equal "${frameId}"`).toBe(frameId);
  }
  for (const [execId, frameId] of r.entries()) {
    expect(f.get(frameId), `${label}: forward["${frameId}"] must equal ${execId}`).toBe(execId);
  }
  expect(r.size, `${label}: reverse.size (${r.size}) must equal forward.size (${f.size})`).toBe(
    f.size,
  );
}

function assertRegistryInvariants(
  registry: ExecutionContextRegistry,
  session: CDPSessionLike,
  label: string,
): void {
  assertBijectiveMaps(
    registry.byFrame.get(session),
    registry.byExec.get(session),
    `${label} [byFrame<->byExec]`,
  );
  assertBijectiveMaps(
    registry.extensionByFrame.get(session),
    registry.extensionByExec.get(session),
    `${label} [extensionByFrame<->extensionByExec]`,
  );
  assertBijectiveMaps(
    registry.fallbackByFrame.get(session),
    registry.fallbackByExec.get(session),
    `${label} [fallbackByFrame<->fallbackByExec]`,
  );

  const candidates = registry.extensionCandidates.get(session);
  if (candidates) {
    for (const [frameId, set] of candidates.entries()) {
      expect(
        set.size,
        `${label}: extensionCandidates["${frameId}"] must not retain empty sets`,
      ).toBeGreaterThan(0);
    }
  }
}

type EventStep =
  | { kind: "created"; frameId: FrameId; isDefault: boolean; readyExtension: boolean }
  | { kind: "destroyed"; targetIndex: number }
  | { kind: "cleared" }
  | {
      kind: "wait";
      frameId: FrameId;
      mode: "finite-progress" | "unlimited-none" | "no-progress";
      probeTimeoutMs: number;
      progressTimeoutMs: number;
      protocol: FrameProtocol;
    };

const frameIdArb = fc.constantFrom<FrameId>(...FRAME_POOL);
const protocolArb = fc.constantFrom<FrameProtocol>("https:", "data:", "about:", "blob:");

const eventStepArb: fc.Arbitrary<EventStep> = fc.oneof(
  fc
    .record({
      frameId: frameIdArb,
      isDefault: fc.boolean(),
      readyExtension: fc.boolean(),
    })
    .map((r) => ({ kind: "created" as const, ...r })),
  fc
    .integer({ min: 0, max: 10 })
    .map((targetIndex) => ({ kind: "destroyed" as const, targetIndex })),
  fc.constant({ kind: "cleared" as const }),
  fc
    .record({
      frameId: frameIdArb,
      mode: fc.constantFrom<"finite-progress" | "unlimited-none" | "no-progress">(
        "finite-progress",
        "unlimited-none",
        "no-progress",
      ),
      probeTimeoutMs: fc.integer({ min: 5, max: 40 }),
      progressTimeoutMs: fc.integer({ min: 10, max: 80 }),
      protocol: protocolArb,
    })
    .map((r) => ({ kind: "wait" as const, ...r })),
);

const EXTENSION_PROBE_TIMEOUT_MS = 1;
const EXTENSION_PROBE_SETTLE_MS = EXTENSION_PROBE_TIMEOUT_MS + 1;

async function runEventSteps(
  steps: EventStep[],
  options: { destroyExistingMainBeforeCreate: boolean },
): Promise<void> {
  const registry = new ExecutionContextRegistry();
  const session = new SimulatedCdpSession();
  registry.setFallbackInstallerSource(session, "install locator runtime");
  registry.attachSession(session);

  let nextExecId = 1;
  const activeExecIds: number[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    switch (step.kind) {
      case "created": {
        if (options.destroyExistingMainBeforeCreate && step.isDefault) {
          const existingMain = registry.getMainWorld(session, step.frameId);
          if (existingMain !== null) {
            session.emitContextDestroyed(existingMain);
            const idx = activeExecIds.indexOf(existingMain);
            if (idx >= 0) activeExecIds.splice(idx, 1);
          }
        }
        const id = nextExecId++;
        activeExecIds.push(id);
        session.emitContextCreated(id, step.frameId, step.isDefault, step.readyExtension);
        assertRegistryInvariants(
          registry,
          session,
          `step[${i}] created(${id}, ${step.frameId}, default=${step.isDefault})`,
        );
        break;
      }
      case "destroyed": {
        const id =
          activeExecIds.length > 0
            ? activeExecIds.splice(step.targetIndex % activeExecIds.length, 1)[0]!
            : 999_999;
        session.emitContextDestroyed(id);
        assertRegistryInvariants(registry, session, `step[${i}] destroyed(${id})`);
        break;
      }
      case "cleared": {
        activeExecIds.length = 0;
        session.emitContextsCleared();
        assertRegistryInvariants(registry, session, `step[${i}] cleared`);
        break;
      }
      case "wait": {
        session.frameProtocols.set(step.frameId, step.protocol);
        let settled = false;
        let progress: Progress | undefined;

        let promise: Promise<LocatorWorld>;
        switch (step.mode) {
          case "finite-progress": {
            progress = new Progress("prop.wait", step.progressTimeoutMs);
            promise = registry.waitForLocatorWorld(
              session,
              step.frameId,
              step.probeTimeoutMs,
              progress,
            );
            break;
          }
          case "unlimited-none": {
            progress = new Progress("prop.wait.unlimited", 0);
            promise = registry.waitForLocatorWorld(
              session,
              step.frameId,
              step.probeTimeoutMs,
              progress,
              { readinessRetries: "none" },
            );
            break;
          }
          case "no-progress": {
            promise = registry.waitForLocatorWorld(session, step.frameId, step.probeTimeoutMs);
            break;
          }
          default: {
            const _exhaustive: never = step.mode;
            throw new Error(`Unhandled mode: ${String(_exhaustive)}`);
          }
        }

        const outcome = promise
          .then((world) => ({ ok: true as const, world }))
          .catch((error: unknown) => ({ ok: false as const, error }))
          .finally(() => {
            settled = true;
          });

        const maxBudget =
          step.mode === "finite-progress" ? step.progressTimeoutMs + 50 : step.probeTimeoutMs + 900;
        await vi.advanceTimersByTimeAsync(maxBudget);
        const result = await outcome;
        progress?.dispose();

        expect(settled, `step[${i}] wait(${step.mode}) must terminate within bound`).toBe(true);
        if (result.ok) {
          expect(result.world.contextId).toBeGreaterThan(0);
          if (result.world.kind === "extension") {
            expect(result.world.capabilities.closedShadowRoots).toBe(true);
          } else {
            expect(result.world.capabilities.closedShadowRoots).toBe(false);
          }
        }
        assertRegistryInvariants(registry, session, `step[${i}] wait(${step.mode})`);
        break;
      }
      default: {
        const _exhaustive: never = step;
        throw new Error(`Unhandled step: ${String(_exhaustive)}`);
      }
    }
  }

  await vi.advanceTimersByTimeAsync(1_100);
  expect(vi.getTimerCount()).toBe(0);
}

describe("ExecutionContextRegistry stateful properties", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  });

  afterEach(() => {
    try {
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("maintains bidirectional map invariants and bounded termination when prior main worlds are destroyed before replacement", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(eventStepArb, { minLength: 1, maxLength: 25 }), async (steps) => {
        await runEventSteps(steps, { destroyExistingMainBeforeCreate: true });
      }),
      { seed: 20261129, numRuns: 120 },
    );
  });

  it("maintains bidirectional map invariants when a frame receives a second default context without intervening destruction", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(eventStepArb, { minLength: 1, maxLength: 25 }), async (steps) => {
        await runEventSteps(steps, { destroyExistingMainBeforeCreate: false });
      }),
      { seed: 20261130, numRuns: 100 },
    );
  });

  it("enforces single-flight fallbackCreation across arbitrary concurrent callers and staggered deadlines", async () => {
    const scenarioArb = fc.record({
      protocol: fc.constantFrom<FrameProtocol>("data:", "about:", "blob:"),
      installDelayMs: fc.integer({ min: 10, max: 60 }),
      callerDeadlines: fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 5, max: 150 })), {
        minLength: 2,
        maxLength: 6,
      }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ protocol, installDelayMs, callerDeadlines }) => {
        const registry = new ExecutionContextRegistry();
        const session = new SimulatedCdpSession();
        session.frameProtocols.set("frame-0", protocol);
        session.createWorldDelayMs = installDelayMs;
        registry.setFallbackInstallerSource(session, "install locator runtime");
        registry.attachSession(session);
        session.emitContextCreated(1, "frame-0", true, false);

        const progresses = callerDeadlines.map(
          (timeout, idx) => new Progress(`caller-${idx}`, timeout),
        );

        const calls = progresses.map((progress) =>
          registry
            .waitForLocatorWorld(session, "frame-0", EXTENSION_PROBE_TIMEOUT_MS, progress, {
              readinessRetries: "none",
            })
            .then((world) => ({ ok: true as const, world }))
            .catch((error: unknown) => ({ ok: false as const, error })),
        );

        const maxTime = Math.max(200, installDelayMs + 100, ...callerDeadlines) + 50;
        await vi.advanceTimersByTimeAsync(maxTime);
        const results = await Promise.all(calls);
        for (const p of progresses) p.dispose();

        expect(session.maxConcurrentFallbackInstalls.get("frame-0") ?? 0).toBeLessThanOrEqual(1);
        expect(session.createIsolatedWorldCalls.get("frame-0") ?? 0).toBeLessThanOrEqual(1);

        const succeeded = results.filter((r): r is { ok: true; world: LocatorWorld } => r.ok);
        const distinctIds = new Set(succeeded.map((r) => r.world.contextId));
        expect(distinctIds.size).toBeLessThanOrEqual(1);
        for (const s of succeeded) {
          expect(s.world.kind).toBe("cdp-fallback");
          expect(s.world.capabilities.closedShadowRoots).toBe(false);
        }

        for (let i = 0; i < callerDeadlines.length; i++) {
          const deadline = callerDeadlines[i]!;
          const res = results[i]!;
          if (deadline === 0 || deadline > installDelayMs + 30) {
            expect(
              res.ok,
              `caller ${i} (deadline=${deadline}, install=${installDelayMs}) should succeed`,
            ).toBe(true);
          } else if (!res.ok) {
            expect(res.error).toBeInstanceOf(TimeoutError);
          }
        }

        expect(registry.fallbackCreation.get(session)?.size ?? 0).toBe(0);
        assertRegistryInvariants(registry, session, "after single-flight fallback");
        await vi.advanceTimersByTimeAsync(1_100);
        expect(vi.getTimerCount()).toBe(0);
      }),
      { seed: 20261131, numRuns: 100 },
    );
  });

  it("bounded termination with unlimited Progress when readinessRetries is 'until-deadline' and extension arrives or CDP closes", async () => {
    const scenarioArb = fc.record({
      resolution: fc.constantFrom<"extension-arrives" | "cdp-closes">(
        "extension-arrives",
        "cdp-closes",
      ),
      probeTimeoutMs: fc.integer({ min: 5, max: 30 }),
      triggerDelayMs: fc.integer({ min: 1, max: 90 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ resolution, probeTimeoutMs, triggerDelayMs }) => {
        const registry = new ExecutionContextRegistry();
        const session = new SimulatedCdpSession();
        session.frameProtocols.set("frame-0", "https:");
        registry.attachSession(session);
        session.emitContextCreated(1, "frame-0", true, false);

        const progress = new Progress("unlimited-until-deadline", 0);
        let settled = false;

        const waiter = registry
          .waitForLocatorWorld(session, "frame-0", probeTimeoutMs, progress, {
            readinessRetries: "until-deadline",
          })
          .then((world) => ({ ok: true as const, world }))
          .catch((error: unknown) => ({ ok: false as const, error }))
          .finally(() => {
            settled = true;
          });

        await vi.advanceTimersByTimeAsync(triggerDelayMs);
        switch (resolution) {
          case "extension-arrives": {
            session.emitContextCreated(42, "frame-0", false, true);
            break;
          }
          case "cdp-closes": {
            await session.close();
            break;
          }
          default: {
            const _exhaustive: never = resolution;
            throw new Error(`Unhandled resolution: ${String(_exhaustive)}`);
          }
        }

        await vi.advanceTimersByTimeAsync(probeTimeoutMs + 100);
        const result = await waiter;
        progress.dispose();

        expect(settled).toBe(true);
        if (resolution === "extension-arrives") {
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.world).toStrictEqual({
              contextId: 42,
              kind: "extension",
              capabilities: { closedShadowRoots: true },
            });
          }
        } else {
          expect(result.ok).toBe(false);
        }

        assertRegistryInvariants(registry, session, `unlimited-${resolution}`);
        expect(vi.getTimerCount()).toBe(0);
      }),
      { seed: 20261132, numRuns: 80 },
    );
  });

  it("does not register a destroyed or cleared extension context when destruction races with inspectExtensionWorld", async () => {
    const scenarioArb = fc.record({
      invalidation: fc.constantFrom<"destroyed" | "cleared">("destroyed", "cleared"),
      evalDelayMs: fc.integer({ min: 5, max: 30 }),
      invalidateAtMs: fc.integer({ min: 1, max: 29 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ invalidation, evalDelayMs, invalidateAtMs }) => {
        fc.pre(invalidateAtMs < evalDelayMs);
        const registry = new ExecutionContextRegistry();
        const session = new SimulatedCdpSession();
        session.evaluateDelayMs = evalDelayMs;
        registry.attachSession(session);
        session.emitContextCreated(7, "frame-0", false, true);

        const progress = new Progress("race-ext", 100);
        const pending = registry
          .waitForExtensionWorld(session, "frame-0", 50, progress)
          .then((id) => ({ ok: true as const, id }))
          .catch((error: unknown) => ({ ok: false as const, error }));

        await vi.advanceTimersByTimeAsync(invalidateAtMs);
        switch (invalidation) {
          case "destroyed":
            session.emitContextDestroyed(7);
            break;
          case "cleared":
            session.emitContextsCleared();
            break;
          default: {
            const _exhaustive: never = invalidation;
            throw new Error(`Unhandled invalidation: ${String(_exhaustive)}`);
          }
        }

        await vi.advanceTimersByTimeAsync(200);
        await pending;
        progress.dispose();

        expect(
          registry.getExtensionWorld(session, "frame-0"),
          `destroyed/cleared context 7 must not be cached after ${invalidation}`,
        ).toBeNull();
        assertRegistryInvariants(registry, session, `race-ext-${invalidation}`);
        expect(vi.getTimerCount()).toBe(0);
      }),
      { seed: 20261133, numRuns: 50 },
    );
  });

  it("maintains single-flight fallbackCreation and bijective fallback maps even if Runtime.executionContextsCleared fires mid-install", async () => {
    const scenarioArb = fc.record({
      createDelayMs: fc.integer({ min: 10, max: 40 }),
      clearAtMs: fc.integer({ min: 1, max: 35 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ createDelayMs, clearAtMs }) => {
        fc.pre(clearAtMs < createDelayMs);
        const registry = new ExecutionContextRegistry();
        const session = new SimulatedCdpSession();
        session.frameProtocols.set("frame-0", "data:");
        session.createWorldDelayMs = createDelayMs;
        registry.setFallbackInstallerSource(session, "install locator runtime");
        registry.attachSession(session);
        session.emitContextCreated(1, "frame-0", true, false);

        const p1 = new Progress("caller-1", 200);
        const w1 = registry
          .waitForLocatorWorld(session, "frame-0", EXTENSION_PROBE_TIMEOUT_MS, p1, {
            readinessRetries: "none",
          })
          .catch(() => null);

        await vi.advanceTimersByTimeAsync(EXTENSION_PROBE_SETTLE_MS + clearAtMs);
        session.emitContextsCleared();
        session.emitContextCreated(2, "frame-0", true, false);

        const p2 = new Progress("caller-2", 200);
        const w2 = registry
          .waitForLocatorWorld(session, "frame-0", EXTENSION_PROBE_TIMEOUT_MS, p2, {
            readinessRetries: "none",
          })
          .catch(() => null);

        await vi.advanceTimersByTimeAsync(300);
        const [firstResult, secondResult] = await Promise.all([w1, w2]);
        p1.dispose();
        p2.dispose();

        expect(session.maxConcurrentFallbackInstalls.get("frame-0") ?? 0).toBeLessThanOrEqual(1);
        expect(firstResult).toBeNull();
        const registeredFallback = registry.getFallbackWorld(session, "frame-0");
        expect(registeredFallback).not.toBeNull();
        expect(session.staleFallbackExecIds.has(registeredFallback!)).toBe(false);
        expect(secondResult).toStrictEqual({
          contextId: registeredFallback,
          kind: "cdp-fallback",
          capabilities: { closedShadowRoots: false },
        });
        expect(registry.fallbackCreation.get(session)?.size ?? 0).toBe(0);
        assertRegistryInvariants(registry, session, "cleared-mid-fallback-install");
        expect(vi.getTimerCount()).toBe(0);
      }),
      { seed: 20261134, numRuns: 50 },
    );
  });

  it("retries cleanly for post-clear callers when Runtime.evaluate rejects during a Runtime.executionContextsCleared race", async () => {
    const scenarioArb = fc.record({
      installEvaluateDelayMs: fc.integer({ min: 15, max: 50 }),
      clearAtMs: fc.integer({ min: 1, max: 10 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ installEvaluateDelayMs, clearAtMs }) => {
        fc.pre(clearAtMs + EXTENSION_PROBE_SETTLE_MS < installEvaluateDelayMs);
        const registry = new ExecutionContextRegistry();
        const session = new SimulatedCdpSession();
        session.frameProtocols.set("frame-0", "data:");
        session.installEvaluateDelayMs = installEvaluateDelayMs;
        session.rejectFallbackInstallOnClear = true;
        registry.setFallbackInstallerSource(session, "install locator runtime");
        registry.attachSession(session);
        session.emitContextCreated(1, "frame-0", true, false);

        const p1 = new Progress("caller-1", 200);
        const w1 = registry
          .waitForLocatorWorld(session, "frame-0", EXTENSION_PROBE_TIMEOUT_MS, p1, {
            readinessRetries: "none",
          })
          .then((world) => ({ ok: true as const, world }))
          .catch((error: unknown) => ({ ok: false as const, error }));

        await vi.advanceTimersByTimeAsync(EXTENSION_PROBE_SETTLE_MS + clearAtMs);
        session.emitContextsCleared();
        session.emitContextCreated(2, "frame-0", true, false);

        const p2 = new Progress("caller-2", 200);
        const w2 = registry
          .waitForLocatorWorld(session, "frame-0", EXTENSION_PROBE_TIMEOUT_MS, p2, {
            readinessRetries: "none",
          })
          .then((world) => ({ ok: true as const, world }))
          .catch((error: unknown) => ({ ok: false as const, error }));

        await vi.advanceTimersByTimeAsync(300);
        const [firstResult, secondResult] = await Promise.all([w1, w2]);
        p1.dispose();
        p2.dispose();

        expect(firstResult.ok).toBe(false);
        expect(secondResult.ok).toBe(true);
        const registeredFallback = registry.getFallbackWorld(session, "frame-0");
        expect(registeredFallback).not.toBeNull();
        expect(session.staleFallbackExecIds.has(registeredFallback!)).toBe(false);
        if (secondResult.ok) {
          expect(secondResult.world).toStrictEqual({
            contextId: registeredFallback,
            kind: "cdp-fallback",
            capabilities: { closedShadowRoots: false },
          });
        }
        expect(session.createIsolatedWorldCalls.get("frame-0")).toBe(2);
        expect(registry.fallbackCreation.get(session)?.size ?? 0).toBe(0);
        assertRegistryInvariants(registry, session, "evaluate-rejected-on-clear-race");
        expect(vi.getTimerCount()).toBe(0);
      }),
      { seed: 20261135, numRuns: 50 },
    );
  });
});
