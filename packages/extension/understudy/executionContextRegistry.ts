import type { Protocol } from "devtools-protocol";
import { type CDPSessionLike, isCdpClosedError } from "./cdp.js";
import { type Progress, runLocatorStep } from "./progress.js";

type FrameId = Protocol.Page.FrameId;
type ExecId = Protocol.Runtime.ExecutionContextId;

export type ReadinessOptions = {
  /** Retry failed readiness attempts within progress, or return after one attempt. */
  readinessRetries?: "until-deadline" | "none";
};

export type LocatorWorld = {
  contextId: ExecId;
  kind: "extension" | "cdp-fallback";
  capabilities: {
    closedShadowRoots: boolean;
  };
};

const STAGEHAND_FALLBACK_WORLD_NAME = "__stagehand_locator_fallback__";

// A world left in an open tab by an unloaded copy of the extension keeps chrome.dom but loses chrome.runtime.id.
export const STAGEHAND_EXTENSION_WORLD_HEALTH_EXPRESSION = `
  globalThis.__stagehandExtensionWorld?.name === "stagehand" &&
  globalThis.__stagehandExtensionWorld?.version === "stagehand.v4" &&
  typeof globalThis.chrome?.dom?.openOrClosedShadowRoot === "function" &&
  typeof globalThis.chrome?.runtime?.id === "string"
`;

class FallbackClearedError extends Error {
  constructor(frameId: FrameId) {
    super(`Execution contexts cleared while installing locator fallback for frame ${frameId}`);
  }
}

export class ExecutionContextRegistry {
  readonly byFrame = new WeakMap<CDPSessionLike, Map<FrameId, ExecId>>();
  readonly byExec = new WeakMap<CDPSessionLike, Map<ExecId, FrameId>>();
  readonly extensionByFrame = new WeakMap<CDPSessionLike, Map<FrameId, ExecId>>();
  readonly extensionByExec = new WeakMap<CDPSessionLike, Map<ExecId, FrameId>>();
  readonly extensionCandidates = new WeakMap<CDPSessionLike, Map<FrameId, Set<ExecId>>>();
  readonly fallbackByFrame = new WeakMap<CDPSessionLike, Map<FrameId, ExecId>>();
  readonly fallbackByExec = new WeakMap<CDPSessionLike, Map<ExecId, FrameId>>();
  readonly fallbackCreation = new WeakMap<CDPSessionLike, Map<FrameId, Promise<ExecId>>>();
  readonly fallbackInstallerSource = new WeakMap<CDPSessionLike, string>();
  private readonly clearEpoch = new WeakMap<CDPSessionLike, number>();
  private readonly inFlightChecks = new WeakMap<
    CDPSessionLike,
    Set<{ contextId: ExecId; invalidated: boolean }>
  >();

  setFallbackInstallerSource(session: CDPSessionLike, source: string): void {
    this.fallbackInstallerSource.set(session, source);
  }

  /** Wire listeners for this session. Call BEFORE Runtime.enable. */
  attachSession(session: CDPSessionLike): void {
    const onCreated = (evt: Protocol.Runtime.ExecutionContextCreatedEvent): void => {
      const aux = (evt.context.auxData ?? {}) as {
        frameId?: string;
        isDefault?: boolean;
      };
      if (aux.isDefault === true && typeof aux.frameId === "string") {
        this.register(session, aux.frameId as FrameId, evt.context.id);
        // The packaged extension blank page loads the locator bundle directly,
        // so its privileged Stagehand context is also its main world.
        this.registerExtensionCandidate(session, aux.frameId as FrameId, evt.context.id);
      } else if (typeof aux.frameId === "string") {
        this.registerExtensionCandidate(session, aux.frameId as FrameId, evt.context.id);
      }
    };
    const onDestroyed = (evt: { executionContextId: ExecId }): void => {
      const checks = this.inFlightChecks.get(session);
      if (checks) {
        for (const check of checks) {
          if (check.contextId === evt.executionContextId) check.invalidated = true;
        }
      }
      const rev = this.byExec.get(session);
      const fwd = this.byFrame.get(session);
      const frameId = rev?.get(evt.executionContextId);
      if (frameId) {
        rev?.delete(evt.executionContextId);
        if (fwd?.get(frameId) === evt.executionContextId) fwd.delete(frameId);
      }
      this.unregisterExtensionContext(session, evt.executionContextId);
      this.unregisterFallbackContext(session, evt.executionContextId);
    };
    const onCleared = (): void => {
      this.clearEpoch.set(session, this.getClearEpoch(session) + 1);
      const checks = this.inFlightChecks.get(session);
      if (checks) {
        for (const check of checks) check.invalidated = true;
      }
      this.byFrame.delete(session);
      this.byExec.delete(session);
      this.extensionByFrame.delete(session);
      this.extensionByExec.delete(session);
      this.extensionCandidates.delete(session);
      this.fallbackByFrame.delete(session);
      this.fallbackByExec.delete(session);
    };

    session.on("Runtime.executionContextCreated", onCreated);
    session.on("Runtime.executionContextDestroyed", onDestroyed);
    session.on("Runtime.executionContextsCleared", onCleared);
  }

  getMainWorld(session: CDPSessionLike, frameId: FrameId): ExecId | null {
    return this.byFrame.get(session)?.get(frameId) ?? null;
  }

  getExtensionWorld(session: CDPSessionLike, frameId: FrameId): ExecId | null {
    return this.extensionByFrame.get(session)?.get(frameId) ?? null;
  }

  getFallbackWorld(session: CDPSessionLike, frameId: FrameId): ExecId | null {
    return this.fallbackByFrame.get(session)?.get(frameId) ?? null;
  }

  /** With progress, timeout limits each extension probe, not the whole wait.
   * Callers that handle failure themselves can disable retries without losing
   * the caller's deadline. Without progress, readiness makes a single attempt.
   */
  async waitForLocatorWorld(
    session: CDPSessionLike,
    frameId: FrameId,
    timeout: number = 1000,
    progress?: Progress,
    { readinessRetries = "until-deadline" }: ReadinessOptions = {},
  ): Promise<LocatorWorld> {
    while (true) {
      progress?.throwIfStopped();
      const extensionContextId = this.getExtensionWorld(session, frameId);
      if (extensionContextId) return this.extensionWorld(extensionContextId);

      const fallbackContextId = this.getFallbackWorld(session, frameId);
      if (fallbackContextId) return this.fallbackWorld(fallbackContextId);

      try {
        return this.extensionWorld(
          await this.waitForExtensionWorld(session, frameId, timeout, progress),
        );
      } catch (extensionError) {
        progress?.throwIfStopped();
        if (progress && isCdpClosedError(extensionError)) throw extensionError;
        if (await this.isFallbackEligible(session, frameId, progress)) {
          // Installation is shared. Only this caller's wait belongs to its progress.
          return this.fallbackWorld(
            await runLocatorStep(progress, "installing locator helpers", () =>
              this.createFallbackWorld(session, frameId),
            ),
          );
        }
        if (!progress || readinessRetries === "none") throw extensionError;
      }
    }
  }

  async waitForExtensionWorld(
    session: CDPSessionLike,
    frameId: FrameId,
    timeout: number = 1000,
    progress?: Progress,
  ): Promise<ExecId> {
    progress?.throwIfStopped();
    const cached = this.getExtensionWorld(session, frameId);
    if (cached) return cached;

    await runLocatorStep(progress, "enabling runtime", () =>
      session.send("Runtime.enable").catch((error) => {
        if (progress && isCdpClosedError(error)) throw error;
      }),
    );
    const now = () => (progress ? performance.now() : Date.now());
    const deadline = now() + Math.min(timeout, progress?.remainingMs() ?? Infinity);
    const checkedContextIds = new Set<ExecId>();
    const diagnostics = new Map<ExecId, string>();

    while (now() <= deadline) {
      progress?.throwIfStopped();
      const candidates = [...(this.extensionCandidates.get(session)?.get(frameId) ?? [])];
      for (const contextId of candidates) {
        if (!this.extensionCandidates.get(session)?.get(frameId)?.has(contextId)) continue;
        const startEpoch = this.getClearEpoch(session);
        checkedContextIds.add(contextId);
        const diagnostic = await runLocatorStep(progress, "inspecting locator helpers", () =>
          this.inspectExtensionWorld(session, contextId, progress),
        );
        diagnostics.set(contextId, JSON.stringify(diagnostic));
        if (
          diagnostic.ready &&
          this.getClearEpoch(session) === startEpoch &&
          this.extensionCandidates.get(session)?.get(frameId)?.has(contextId)
        ) {
          this.registerExtensionWorld(session, frameId, contextId);
          return contextId;
        }
      }

      if (progress) await progress.delay(Math.min(25, Math.max(1, deadline - now())));
      else await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(
      `Stagehand extension world not ready for frame ${frameId}; checked contexts: ${
        checkedContextIds.size ? [...checkedContextIds].join(", ") : "none"
      }; diagnostics: ${[...diagnostics.entries()]
        .map(([contextId, diagnostic]) => `${contextId}=${diagnostic}`)
        .join(", ")}`,
    );
  }

  async waitForMainWorld(
    session: CDPSessionLike,
    frameId: FrameId,
    timeout: number = 800,
    progress?: Progress,
  ): Promise<ExecId> {
    progress?.throwIfStopped();
    const cached = this.getMainWorld(session, frameId);
    if (cached) return cached;

    await runLocatorStep(progress, "enabling runtime", () =>
      session.send("Runtime.enable").catch((error) => {
        if (progress && isCdpClosedError(error)) throw error;
      }),
    );
    const after = this.getMainWorld(session, frameId);
    if (after) return after;

    let dispose = () => {};
    try {
      return await runLocatorStep(
        progress,
        "waiting for main world",
        () =>
          new Promise<ExecId>((resolve, reject) => {
            let done = false;
            const onCreated = (evt: Protocol.Runtime.ExecutionContextCreatedEvent): void => {
              const aux = (evt.context.auxData ?? {}) as {
                frameId?: string;
                isDefault?: boolean;
              };
              if (aux.isDefault === true && aux.frameId === frameId) {
                this.register(session, frameId, evt.context.id);
                if (!done) {
                  done = true;
                  clearTimeout(timer);
                  session.off("Runtime.executionContextCreated", onCreated);
                  resolve(evt.context.id);
                }
              }
            };
            const timer = setTimeout(() => {
              if (!done) {
                done = true;
                session.off("Runtime.executionContextCreated", onCreated);
                reject(new Error(`main world not ready for frame ${frameId}`));
              }
            }, timeout);
            session.on("Runtime.executionContextCreated", onCreated);
            dispose = () => {
              done = true;
              clearTimeout(timer);
              session.off("Runtime.executionContextCreated", onCreated);
            };
          }),
      );
    } finally {
      dispose();
    }
  }

  register(session: CDPSessionLike, frameId: FrameId, ctxId: ExecId): void {
    this.setBijectiveMapping(this.byFrame, this.byExec, session, frameId, ctxId);
  }

  registerExtensionCandidate(session: CDPSessionLike, frameId: FrameId, ctxId: ExecId): void {
    let byFrame = this.extensionCandidates.get(session);
    if (!byFrame) {
      byFrame = new Map<FrameId, Set<ExecId>>();
      this.extensionCandidates.set(session, byFrame);
    }
    let candidates = byFrame.get(frameId);
    if (!candidates) {
      candidates = new Set<ExecId>();
      byFrame.set(frameId, candidates);
    }
    candidates.add(ctxId);
  }

  registerExtensionWorld(session: CDPSessionLike, frameId: FrameId, ctxId: ExecId): void {
    this.setBijectiveMapping(this.extensionByFrame, this.extensionByExec, session, frameId, ctxId);
  }

  registerFallbackWorld(session: CDPSessionLike, frameId: FrameId, ctxId: ExecId): void {
    this.setBijectiveMapping(this.fallbackByFrame, this.fallbackByExec, session, frameId, ctxId);
  }

  private setBijectiveMapping(
    forwardBySession: WeakMap<CDPSessionLike, Map<FrameId, ExecId>>,
    reverseBySession: WeakMap<CDPSessionLike, Map<ExecId, FrameId>>,
    session: CDPSessionLike,
    frameId: FrameId,
    ctxId: ExecId,
  ): void {
    let forward = forwardBySession.get(session);
    if (!forward) {
      forward = new Map<FrameId, ExecId>();
      forwardBySession.set(session, forward);
    }
    let reverse = reverseBySession.get(session);
    if (!reverse) {
      reverse = new Map<ExecId, FrameId>();
      reverseBySession.set(session, reverse);
    }
    const previousExecId = forward.get(frameId);
    if (previousExecId !== undefined && previousExecId !== ctxId) {
      reverse.delete(previousExecId);
    }
    const previousFrameId = reverse.get(ctxId);
    if (
      previousFrameId !== undefined &&
      previousFrameId !== frameId &&
      forward.get(previousFrameId) === ctxId
    ) {
      forward.delete(previousFrameId);
    }
    forward.set(frameId, ctxId);
    reverse.set(ctxId, frameId);
  }

  private getClearEpoch(session: CDPSessionLike): number {
    return this.clearEpoch.get(session) ?? 0;
  }

  private trackInFlightCheck(
    session: CDPSessionLike,
    contextId: ExecId,
  ): { token: { contextId: ExecId; invalidated: boolean }; release: () => void } {
    const token = { contextId, invalidated: false };
    let checks = this.inFlightChecks.get(session);
    if (!checks) {
      checks = new Set();
      this.inFlightChecks.set(session, checks);
    }
    checks.add(token);
    return {
      token,
      release: () => {
        checks.delete(token);
        if (checks.size === 0 && this.inFlightChecks.get(session) === checks) {
          this.inFlightChecks.delete(session);
        }
      },
    };
  }

  unregisterExtensionContext(session: CDPSessionLike, ctxId: ExecId): void {
    const reverse = this.extensionByExec.get(session);
    const selectedFrameId = reverse?.get(ctxId);
    if (selectedFrameId) {
      reverse?.delete(ctxId);
      const selected = this.extensionByFrame.get(session);
      if (selected?.get(selectedFrameId) === ctxId) selected.delete(selectedFrameId);
    }

    const candidatesByFrame = this.extensionCandidates.get(session);
    if (!candidatesByFrame) return;
    for (const [frameId, candidates] of candidatesByFrame) {
      candidates.delete(ctxId);
      if (candidates.size === 0) candidatesByFrame.delete(frameId);
    }
  }

  unregisterFallbackContext(session: CDPSessionLike, ctxId: ExecId): void {
    const reverse = this.fallbackByExec.get(session);
    const frameId = reverse?.get(ctxId);
    if (!frameId) return;
    reverse?.delete(ctxId);
    const forward = this.fallbackByFrame.get(session);
    if (forward?.get(frameId) === ctxId) forward.delete(frameId);
  }

  unregisterLocatorContext(session: CDPSessionLike, ctxId: ExecId): void {
    this.unregisterExtensionContext(session, ctxId);
    this.unregisterFallbackContext(session, ctxId);
  }

  private extensionWorld(contextId: ExecId): LocatorWorld {
    return {
      contextId,
      kind: "extension",
      capabilities: { closedShadowRoots: true },
    };
  }

  private fallbackWorld(contextId: ExecId): LocatorWorld {
    return {
      contextId,
      kind: "cdp-fallback",
      capabilities: { closedShadowRoots: false },
    };
  }

  private async isFallbackEligible(
    session: CDPSessionLike,
    frameId: FrameId,
    progress?: Progress,
  ): Promise<boolean> {
    try {
      const contextId = await this.waitForMainWorld(session, frameId, 800, progress);
      const response = await runLocatorStep(progress, "checking locator fallback", () =>
        session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
          expression: "globalThis.location?.protocol ?? ''",
          contextId,
          returnByValue: true,
        }),
      );
      const protocol = response.result.value;
      return (
        protocol === "data:" ||
        protocol === "about:" ||
        protocol === "blob:" ||
        protocol === "file:" ||
        protocol === "filesystem:"
      );
    } catch (error) {
      progress?.throwIfStopped();
      if (progress && isCdpClosedError(error)) throw error;
      return false;
    }
  }

  private async createFallbackWorld(session: CDPSessionLike, frameId: FrameId): Promise<ExecId> {
    const callerEpoch = this.getClearEpoch(session);

    while (true) {
      const cached = this.getFallbackWorld(session, frameId);
      if (cached) return cached;

      let pendingByFrame = this.fallbackCreation.get(session);
      if (!pendingByFrame) {
        pendingByFrame = new Map<FrameId, Promise<ExecId>>();
        this.fallbackCreation.set(session, pendingByFrame);
      }
      const existing = pendingByFrame.get(frameId);
      if (existing) {
        try {
          const execId = await existing;
          if (this.getClearEpoch(session) === callerEpoch) return execId;
        } catch (error) {
          if (
            this.getClearEpoch(session) !== callerEpoch ||
            !(error instanceof FallbackClearedError)
          ) {
            throw error;
          }
        }
        continue;
      }

      if (this.getClearEpoch(session) !== callerEpoch) {
        throw new FallbackClearedError(frameId);
      }

      const pending = this.installFallbackWorld(session, frameId, callerEpoch).finally(() => {
        if (pendingByFrame.get(frameId) === pending) {
          pendingByFrame.delete(frameId);
        }
      });
      pendingByFrame.set(frameId, pending);
      return pending;
    }
  }

  private async installFallbackWorld(
    session: CDPSessionLike,
    frameId: FrameId,
    startEpoch: number,
  ): Promise<ExecId> {
    const source = this.fallbackInstallerSource.get(session);
    if (!source) {
      throw new Error(`Stagehand locator fallback source is unavailable for frame ${frameId}`);
    }
    const { executionContextId } = await session.send<{ executionContextId: ExecId }>(
      "Page.createIsolatedWorld",
      {
        frameId,
        worldName: STAGEHAND_FALLBACK_WORLD_NAME,
        grantUniveralAccess: false,
      },
    );
    if (this.getClearEpoch(session) !== startEpoch) {
      throw new FallbackClearedError(frameId);
    }

    const { token, release } = this.trackInFlightCheck(session, executionContextId);
    try {
      const installed = await session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression: `${source}\n;void 0;`,
        contextId: executionContextId,
        returnByValue: true,
        awaitPromise: true,
      });
      if (token.invalidated || this.getClearEpoch(session) !== startEpoch) {
        throw new FallbackClearedError(frameId);
      }
      if (installed.exceptionDetails) {
        throw new Error(
          installed.exceptionDetails.text ??
            `Failed to install Stagehand locator fallback for frame ${frameId}`,
        );
      }
      const diagnostic = await this.inspectLocatorWorld(session, executionContextId);
      if (token.invalidated || this.getClearEpoch(session) !== startEpoch) {
        throw new FallbackClearedError(frameId);
      }
      if (!diagnostic.ready || diagnostic.kind !== "cdp-fallback" || diagnostic.closedShadowRoots) {
        throw new Error(
          `Stagehand locator fallback failed health check for frame ${frameId}: ${JSON.stringify(diagnostic)}`,
        );
      }
      this.registerFallbackWorld(session, frameId, executionContextId);
      return executionContextId;
    } finally {
      release();
    }
  }

  private async inspectLocatorWorld(
    session: CDPSessionLike,
    contextId: ExecId,
  ): Promise<{ ready: boolean; kind: string; closedShadowRoots: boolean }> {
    try {
      const response = await session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression: `({
          ready: Boolean(globalThis.__stagehandLocatorScripts),
          kind: globalThis.__stagehandLocatorWorld?.kind ?? "unknown",
          closedShadowRoots: globalThis.__stagehandLocatorWorld?.closedShadowRoots === true,
        })`,
        contextId,
        returnByValue: true,
      });
      const value = response.result.value as
        | { ready?: unknown; kind?: unknown; closedShadowRoots?: unknown }
        | undefined;
      return {
        ready: value?.ready === true,
        kind: typeof value?.kind === "string" ? value.kind : "unknown",
        closedShadowRoots: value?.closedShadowRoots === true,
      };
    } catch (error) {
      // Shared installation must retain closure errors for every waiting caller.
      if (isCdpClosedError(error)) throw error;
      return { ready: false, kind: "unavailable", closedShadowRoots: false };
    }
  }

  async isStagehandExtensionWorld(session: CDPSessionLike, contextId: ExecId): Promise<boolean> {
    return (await this.inspectExtensionWorld(session, contextId)).ready;
  }

  async inspectExtensionWorld(
    session: CDPSessionLike,
    contextId: ExecId,
    progress?: Progress,
  ): Promise<{ ready: boolean; marker: boolean; domApi: string; runtimeId: string }> {
    const { token, release } = this.trackInFlightCheck(session, contextId);
    try {
      const response = await session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression: `({
          ready: Boolean(${STAGEHAND_EXTENSION_WORLD_HEALTH_EXPRESSION}),
          marker: globalThis.__stagehandExtensionWorld?.version === "stagehand.v4",
          domApi: typeof globalThis.chrome?.dom?.openOrClosedShadowRoot,
          runtimeId: typeof globalThis.chrome?.runtime?.id,
        })`,
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      if (token.invalidated) {
        return { ready: false, marker: false, domApi: "unavailable", runtimeId: "unavailable" };
      }
      if (response.exceptionDetails) {
        return { ready: false, marker: false, domApi: "exception", runtimeId: "exception" };
      }
      const value = response.result.value as
        | { ready?: unknown; marker?: unknown; domApi?: unknown; runtimeId?: unknown }
        | undefined;
      return {
        ready: value?.ready === true,
        marker: value?.marker === true,
        domApi: typeof value?.domApi === "string" ? value.domApi : "unknown",
        runtimeId: typeof value?.runtimeId === "string" ? value.runtimeId : "unknown",
      };
    } catch (error) {
      progress?.throwIfStopped();
      if (progress && isCdpClosedError(error)) throw error;
      return { ready: false, marker: false, domApi: "unavailable", runtimeId: "unavailable" };
    } finally {
      release();
    }
  }
}

export const executionContexts = new ExecutionContextRegistry();
