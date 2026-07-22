import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";

type FrameId = Protocol.Page.FrameId;
type ExecId = Protocol.Runtime.ExecutionContextId;

export type LocatorWorld = {
  contextId: ExecId;
  kind: "extension" | "cdp-fallback";
  capabilities: {
    closedShadowRoots: boolean;
  };
};

const STAGEHAND_FALLBACK_WORLD_NAME = "__stagehand_locator_fallback__";

export const STAGEHAND_EXTENSION_WORLD_HEALTH_EXPRESSION = `
  globalThis.__stagehandExtensionWorld?.name === "stagehand" &&
  globalThis.__stagehandExtensionWorld?.version === "stagehand.v4" &&
  typeof globalThis.chrome?.dom?.openOrClosedShadowRoot === "function"
`;

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
    const onDestroyed = (evt: Protocol.Runtime.ExecutionContextDestroyedEvent): void => {
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
      this.byFrame.delete(session);
      this.byExec.delete(session);
      this.extensionByFrame.delete(session);
      this.extensionByExec.delete(session);
      this.extensionCandidates.delete(session);
      this.fallbackByFrame.delete(session);
      this.fallbackByExec.delete(session);
      this.fallbackCreation.delete(session);
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

  async waitForLocatorWorld(
    session: CDPSessionLike,
    frameId: FrameId,
    timeoutMs: number = 1000,
  ): Promise<LocatorWorld> {
    const extensionContextId = this.getExtensionWorld(session, frameId);
    if (extensionContextId) return this.extensionWorld(extensionContextId);

    const fallbackContextId = this.getFallbackWorld(session, frameId);
    if (fallbackContextId) return this.fallbackWorld(fallbackContextId);

    try {
      return this.extensionWorld(await this.waitForExtensionWorld(session, frameId, timeoutMs));
    } catch (extensionError) {
      if (!(await this.isFallbackEligible(session, frameId))) throw extensionError;
      return this.fallbackWorld(await this.createFallbackWorld(session, frameId));
    }
  }

  async waitForExtensionWorld(
    session: CDPSessionLike,
    frameId: FrameId,
    timeoutMs: number = 1000,
  ): Promise<ExecId> {
    const cached = this.getExtensionWorld(session, frameId);
    if (cached) return cached;

    await session.send("Runtime.enable").catch(() => {});
    const deadline = Date.now() + timeoutMs;
    const checkedContextIds = new Set<ExecId>();
    const diagnostics = new Map<ExecId, string>();

    while (Date.now() <= deadline) {
      const candidates = this.extensionCandidates.get(session)?.get(frameId);
      for (const contextId of candidates ?? []) {
        checkedContextIds.add(contextId);
        const diagnostic = await this.inspectExtensionWorld(session, contextId);
        diagnostics.set(contextId, JSON.stringify(diagnostic));
        if (diagnostic.ready) {
          this.registerExtensionWorld(session, frameId, contextId);
          return contextId;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
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
    timeoutMs: number = 800,
  ): Promise<ExecId> {
    const cached = this.getMainWorld(session, frameId);
    if (cached) return cached;

    await session.send("Runtime.enable").catch(() => {});
    const after = this.getMainWorld(session, frameId);
    if (after) return after;

    return await new Promise<ExecId>((resolve, reject) => {
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
      }, timeoutMs);
      session.on("Runtime.executionContextCreated", onCreated);
    });
  }

  register(session: CDPSessionLike, frameId: FrameId, ctxId: ExecId): void {
    let fwd = this.byFrame.get(session);
    if (!fwd) {
      fwd = new Map<FrameId, ExecId>();
      this.byFrame.set(session, fwd);
    }
    let rev = this.byExec.get(session);
    if (!rev) {
      rev = new Map<ExecId, FrameId>();
      this.byExec.set(session, rev);
    }
    fwd.set(frameId, ctxId);
    rev.set(ctxId, frameId);
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
    let fwd = this.extensionByFrame.get(session);
    if (!fwd) {
      fwd = new Map<FrameId, ExecId>();
      this.extensionByFrame.set(session, fwd);
    }
    let rev = this.extensionByExec.get(session);
    if (!rev) {
      rev = new Map<ExecId, FrameId>();
      this.extensionByExec.set(session, rev);
    }
    fwd.set(frameId, ctxId);
    rev.set(ctxId, frameId);
  }

  registerFallbackWorld(session: CDPSessionLike, frameId: FrameId, ctxId: ExecId): void {
    let forward = this.fallbackByFrame.get(session);
    if (!forward) {
      forward = new Map<FrameId, ExecId>();
      this.fallbackByFrame.set(session, forward);
    }
    let reverse = this.fallbackByExec.get(session);
    if (!reverse) {
      reverse = new Map<ExecId, FrameId>();
      this.fallbackByExec.set(session, reverse);
    }
    forward.set(frameId, ctxId);
    reverse.set(ctxId, frameId);
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

  private async isFallbackEligible(session: CDPSessionLike, frameId: FrameId): Promise<boolean> {
    try {
      const contextId = await this.waitForMainWorld(session, frameId, 800);
      const response = await session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression: "globalThis.location?.protocol ?? ''",
        contextId,
        returnByValue: true,
      });
      const protocol = response.result.value;
      return (
        protocol === "data:" ||
        protocol === "about:" ||
        protocol === "blob:" ||
        protocol === "file:" ||
        protocol === "filesystem:"
      );
    } catch {
      return false;
    }
  }

  private async createFallbackWorld(session: CDPSessionLike, frameId: FrameId): Promise<ExecId> {
    const cached = this.getFallbackWorld(session, frameId);
    if (cached) return cached;

    let pendingByFrame = this.fallbackCreation.get(session);
    if (!pendingByFrame) {
      pendingByFrame = new Map<FrameId, Promise<ExecId>>();
      this.fallbackCreation.set(session, pendingByFrame);
    }
    const existing = pendingByFrame.get(frameId);
    if (existing) return existing;

    const pending = this.installFallbackWorld(session, frameId).finally(() => {
      pendingByFrame?.delete(frameId);
    });
    pendingByFrame.set(frameId, pending);
    return pending;
  }

  private async installFallbackWorld(session: CDPSessionLike, frameId: FrameId): Promise<ExecId> {
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
    const installed = await session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
      expression: `${source}\n;void 0;`,
      contextId: executionContextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (installed.exceptionDetails) {
      throw new Error(
        installed.exceptionDetails.text ??
          `Failed to install Stagehand locator fallback for frame ${frameId}`,
      );
    }
    const diagnostic = await this.inspectLocatorWorld(session, executionContextId);
    if (!diagnostic.ready || diagnostic.kind !== "cdp-fallback" || diagnostic.closedShadowRoots) {
      throw new Error(
        `Stagehand locator fallback failed health check for frame ${frameId}: ${JSON.stringify(diagnostic)}`,
      );
    }
    this.registerFallbackWorld(session, frameId, executionContextId);
    return executionContextId;
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
    } catch {
      return { ready: false, kind: "unavailable", closedShadowRoots: false };
    }
  }

  async isStagehandExtensionWorld(session: CDPSessionLike, contextId: ExecId): Promise<boolean> {
    return (await this.inspectExtensionWorld(session, contextId)).ready;
  }

  async inspectExtensionWorld(
    session: CDPSessionLike,
    contextId: ExecId,
  ): Promise<{ ready: boolean; marker: boolean; domApi: string }> {
    try {
      const response = await session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression: `({
          ready: Boolean(${STAGEHAND_EXTENSION_WORLD_HEALTH_EXPRESSION}),
          marker: globalThis.__stagehandExtensionWorld?.version === "stagehand.v4",
          domApi: typeof globalThis.chrome?.dom?.openOrClosedShadowRoot,
        })`,
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });
      if (response.exceptionDetails) return { ready: false, marker: false, domApi: "exception" };
      const value = response.result.value as
        | { ready?: unknown; marker?: unknown; domApi?: unknown }
        | undefined;
      return {
        ready: value?.ready === true,
        marker: value?.marker === true,
        domApi: typeof value?.domApi === "string" ? value.domApi : "unknown",
      };
    } catch {
      return { ready: false, marker: false, domApi: "unavailable" };
    }
  }
}

export const executionContexts = new ExecutionContextRegistry();
