import type { Protocol } from "devtools-protocol";
import { isCdpClosedError } from "./cdp.js";
import type { Frame } from "./frame.js";
import { Progress, runLocatorStep } from "./progress.js";
import { executionContexts, type ReadinessOptions } from "./executionContextRegistry.js";
import { buildLocatorInvocation } from "./locatorInvocation.js";
import { parseLegacySelector, type SelectorQuery } from "./selectorQuery.js";
import type { SelectorResolution } from "../dom/locatorScripts/resolveQuery.js";

export type { SelectorQuery } from "./selectorQuery.js";

export interface ResolvedNode {
  objectId: Protocol.Runtime.RemoteObjectId;
  nodeId: Protocol.DOM.NodeId | null;
}

/** The caller must release the batch after consuming its handles. */
export interface ResolvedNodeBatch {
  nodes: ResolvedNode[];
  release(): Promise<void>;
}

export interface ResolveManyOptions {
  limit?: number;
  start?: number;
}

export class FrameSelectorResolver {
  constructor(
    readonly frame: Frame,
    private readonly readinessOptions: ReadinessOptions = {},
  ) {}

  public static parseSelector(raw: string): SelectorQuery {
    return parseLegacySelector(raw);
  }

  public async resolveFirst(
    query: SelectorQuery,
    progress?: Progress,
  ): Promise<ResolvedNode | null> {
    return this.resolveAtIndex(query, 0, progress);
  }

  public async resolveAll(
    query: SelectorQuery,
    { limit = Infinity, start = 0 }: ResolveManyOptions = {},
    progress?: Progress,
  ): Promise<ResolvedNodeBatch> {
    progress?.throwIfStopped();
    const empty = (): ResolvedNodeBatch => ({ nodes: [], release: async () => {} });
    if (limit <= 0 || Number.isNaN(limit) || start < 0 || !Number.isInteger(start)) return empty();
    const session = this.frame.session;
    const { contextId } = await executionContexts.waitForLocatorWorld(
      session,
      this.frame.frameId,
      1000,
      progress,
      this.readinessOptions,
    );
    const objectGroup = `stagehand-selector-${contextId}-${crypto.randomUUID()}`;
    // Capture the actual session and context: navigation may change frame ownership.
    const cleanup = progress ?? new Progress("selector cleanup", 0);
    const releaseGroup = () =>
      cleanup.cleanup(() => session.send("Runtime.releaseObjectGroup", { objectGroup }));
    let released: Promise<void> | undefined;
    const release = () => (released ??= releaseGroup());
    const step = <T>(phase: string, work: () => Promise<T>) =>
      runLocatorStep(
        progress,
        phase,
        async () => {
          try {
            return await work();
          } catch (error) {
            // A rejected late command may also have allocated objects before failing.
            if (released) void releaseGroup();
            throw error;
          }
        },
        releaseGroup,
      );
    let handedOff = false;
    try {
      const resolution: SelectorResolution =
        limit === Infinity && start === 0
          ? { mode: "all" }
          : {
              mode: "range",
              start,
              end: limit === Infinity ? Number.MAX_SAFE_INTEGER : start + Math.ceil(limit),
            };
      const expression = buildLocatorInvocation("resolveQuery", [
        JSON.stringify(query),
        JSON.stringify(resolution),
      ]);
      const evaluated = await step("collecting selector matches", () =>
        session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
          expression,
          contextId,
          objectGroup,
          returnByValue: false,
          awaitPromise: true,
        }),
      );
      if (evaluated.exceptionDetails || !evaluated.result.objectId) return empty();
      const properties = await step("exporting selector matches", () =>
        session.send<Protocol.Runtime.GetPropertiesResponse>("Runtime.getProperties", {
          objectId: evaluated.result.objectId!,
          ownProperties: true,
        }),
      );
      if (properties.exceptionDetails) return empty();
      const nodes = properties.result
        .filter((property) => /^(0|[1-9]\d*)$/.test(property.name) && property.value?.objectId)
        .sort((a, b) => Number(a.name) - Number(b.name))
        .map((property) => ({ objectId: property.value!.objectId!, nodeId: null }));
      // Frontend node IDs are unnecessary for masks and snapshot exclusions.
      // Those consumers read geometry/backend IDs while this group is alive.
      progress?.throwIfStopped();
      if (!nodes.length) return empty();
      handedOff = true;
      return { nodes, release };
    } catch (error) {
      progress?.throwIfStopped();
      if (progress && isCdpClosedError(error)) throw error;
      return empty();
    } finally {
      if (!handedOff) {
        await release();
        progress?.throwIfStopped();
      }
    }
  }

  public async resolveAtIndex(
    query: SelectorQuery,
    index: number,
    progress?: Progress,
  ): Promise<ResolvedNode | null> {
    progress?.throwIfStopped();
    if (index < 0 || !Number.isInteger(index)) return null;
    const { contextId } = await executionContexts.waitForLocatorWorld(
      this.frame.session,
      this.frame.frameId,
      1000,
      progress,
      this.readinessOptions,
    );
    const expression = buildLocatorInvocation("resolveQuery", [
      JSON.stringify(query),
      JSON.stringify({ mode: "range", start: index, end: index + 1 }),
    ]);
    // Export only the selected element, outside any temporary group. Action
    // callers already own and release this handle with Runtime.releaseObject.
    return this.evaluateElement(`(${expression})[0] ?? null`, contextId, progress);
  }

  public async count(query: SelectorQuery, progress?: Progress): Promise<number> {
    progress?.throwIfStopped();
    switch (query.kind) {
      case "css":
        return this.countCss(query.value, progress);
      case "text":
        return this.countText(query.value, progress);
      case "textMatch":
        return this.countQuery(query, progress);
      case "xpath":
        return this.countXPath(query.value, progress);
    }
  }

  async countCss(value: string, progress?: Progress): Promise<number> {
    return this.countQuery({ kind: "css", value }, progress);
  }

  async countText(value: string, progress?: Progress): Promise<number> {
    return this.countQuery({ kind: "text", value }, progress);
  }

  async countXPath(value: string, progress?: Progress): Promise<number> {
    return this.countQuery({ kind: "xpath", value }, progress);
  }

  private async countQuery(query: SelectorQuery, progress?: Progress): Promise<number> {
    const { contextId } = await executionContexts.waitForLocatorWorld(
      this.frame.session,
      this.frame.frameId,
      1000,
      progress,
      this.readinessOptions,
    );
    return this.evaluateCount(
      buildLocatorInvocation("resolveQuery", [
        JSON.stringify(query),
        JSON.stringify({ mode: "count" }),
      ]),
      contextId,
      progress,
    );
  }

  async resolveFromObjectId(
    objectId: Protocol.Runtime.RemoteObjectId,
    progress?: Progress,
  ): Promise<ResolvedNode | null> {
    const session = this.frame.session;
    let nodeId: Protocol.DOM.NodeId | null;
    try {
      const rn = await runLocatorStep(progress, "resolving DOM node", () =>
        session.send<{ nodeId: Protocol.DOM.NodeId }>("DOM.requestNode", { objectId }),
      );
      nodeId = rn.nodeId ?? null;
    } catch (error) {
      progress?.throwIfStopped();
      if (progress && isCdpClosedError(error)) throw error;
      nodeId = null;
    }

    return { objectId, nodeId };
  }

  async evaluateCount(
    expression: string,
    contextId: Protocol.Runtime.ExecutionContextId,
    progress?: Progress,
  ): Promise<number> {
    const session = this.frame.session;

    try {
      const evalRes = await runLocatorStep(progress, "counting elements", () =>
        session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
          expression,
          contextId,
          returnByValue: true,
          awaitPromise: true,
        }),
      );

      if (evalRes.exceptionDetails) {
        return 0;
      }

      const value = evalRes.result.value;
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch (error) {
      progress?.throwIfStopped();
      if (progress && isCdpClosedError(error)) throw error;
      return 0;
    }
  }

  async evaluateElement(
    expression: string,
    contextId: Protocol.Runtime.ExecutionContextId,
    progress?: Progress,
  ): Promise<ResolvedNode | null> {
    const session = this.frame.session;
    let objectId: Protocol.Runtime.RemoteObjectId | undefined;
    const cleanup = progress ?? new Progress("selector cleanup", 0);
    const release = (id: string) => session.send("Runtime.releaseObject", { objectId: id });
    try {
      const evalRes = await runLocatorStep(
        progress,
        "evaluating selector",
        () =>
          session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
            expression,
            contextId,
            returnByValue: false,
            awaitPromise: true,
          }),
        (late) => (late.result.objectId ? release(late.result.objectId) : undefined),
      );
      objectId = evalRes.result.objectId;
      if (evalRes.exceptionDetails || !objectId) {
        if (objectId) {
          const discardedId = objectId;
          objectId = undefined;
          await cleanup.cleanup(() => release(discardedId));
        }
        progress?.throwIfStopped();
        return null;
      }
      const resolved = await this.resolveFromObjectId(objectId, progress);
      progress?.throwIfStopped();
      return resolved;
    } catch (error) {
      if (objectId) await cleanup.cleanup(() => release(objectId!));
      progress?.throwIfStopped();
      if (progress && isCdpClosedError(error)) throw error;
      return null;
    }
  }
}
