import type { Protocol } from "devtools-protocol";
import { isCdpClosedError } from "./cdp.js";
import type { Frame } from "./frame.js";
import { type Progress, runLocatorStep } from "./progress.js";
import { executionContexts, type ReadinessOptions } from "./executionContextRegistry.js";
import { buildLocatorInvocation } from "./locatorInvocation.js";
import {
  decodeLocatorQuery,
  type QueryStep,
} from "@browserbasehq/stagehand-protocol/locator-query";
import { splitSelectorHops } from "./selectorParser.js";
import { SelectorEvaluationError } from "./selectorEvaluationError.js";

export type SelectorQuery =
  | { kind: "css"; value: string }
  | { kind: "text"; value: string }
  | { kind: "xpath"; value: string }
  | { kind: "semantic"; steps: QueryStep[] };

const elementResolvers = {
  css: "resolveCssSelector",
  text: "resolveTextSelector",
  xpath: "resolveXPathMainWorld",
  semantic: "resolveSemanticSelector",
} as const;

export interface ResolvedNode {
  objectId: Protocol.Runtime.RemoteObjectId;
  nodeId: Protocol.DOM.NodeId | null;
}

export interface ResolveManyOptions {
  limit?: number;
}

export class FrameSelectorResolver {
  constructor(
    readonly frame: Frame,
    private readonly readinessOptions: ReadinessOptions = {},
  ) {}

  public static parseSelector(raw: string): SelectorQuery {
    const trimmed = raw.trim();
    const steps = decodeLocatorQuery(trimmed);
    if (steps) return { kind: "semantic", steps };

    const isText = /^text=/i.test(trimmed);
    const looksLikeXPath =
      /^xpath=/i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("(");
    const isCssPrefixed = /^css=/i.test(trimmed);

    if (isText) {
      let value = trimmed.replace(/^text=/i, "").trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return { kind: "text", value };
    }

    if (looksLikeXPath) {
      const value = trimmed.replace(/^xpath=/i, "");
      return { kind: "xpath", value };
    }

    let selector = isCssPrefixed ? trimmed.replace(/^css=/i, "") : trimmed;
    if (selector.includes(">>")) {
      selector = splitSelectorHops(selector).join(" ");
    }

    return { kind: "css", value: selector };
  }

  public async resolveFirst(
    query: SelectorQuery,
    progress?: Progress,
  ): Promise<ResolvedNode | null> {
    return this.resolveAtIndex(query, 0, progress);
  }

  public async resolveAll(
    query: SelectorQuery,
    { limit = Infinity }: ResolveManyOptions = {},
    progress?: Progress,
  ): Promise<ResolvedNode[]> {
    return this.resolveElements(query, 0, limit, progress);
  }

  public async count(query: SelectorQuery, progress?: Progress): Promise<number> {
    progress?.throwIfStopped();
    switch (query.kind) {
      case "css":
        return this.countCss(query.value, progress);
      case "text":
        return this.countText(query.value, progress);
      case "xpath":
        return this.countXPath(query.value, progress);
      case "semantic":
        return this.countElements("countSemanticMatches", query.steps, progress, "throw");
    }
  }

  public async resolveAtIndex(
    query: SelectorQuery,
    index: number,
    progress?: Progress,
  ): Promise<ResolvedNode | null> {
    progress?.throwIfStopped();
    if (index < 0 || !Number.isInteger(index)) return null;
    const [selected = null] = await this.resolveElements(query, index, 1, progress);
    if (progress) {
      try {
        progress.throwIfStopped();
      } catch (error) {
        if (selected) void this.releaseNodes([selected], progress);
        throw error;
      }
    }
    return selected;
  }

  private async resolveElements(
    query: SelectorQuery,
    startIndex: number,
    limit: number,
    progress?: Progress,
  ): Promise<ResolvedNode[]> {
    progress?.throwIfStopped();
    if (limit <= 0) return [];
    const { contextId } = await executionContexts.waitForLocatorWorld(
      this.frame.session,
      this.frame.frameId,
      1000,
      progress,
      this.readinessOptions,
    );
    const helper = elementResolvers[query.kind];
    const value = JSON.stringify(query.kind === "semantic" ? query.steps : query.value);
    const results: ResolvedNode[] = [];
    try {
      for (let offset = 0; offset < limit; offset += 1) {
        const expression = buildLocatorInvocation(helper, [value, String(startIndex + offset)]);
        const resolved = await this.evaluateElement(
          expression,
          contextId,
          progress,
          query.kind === "semantic" ? "throw" : "empty",
        );
        if (!resolved) break;
        results.push(resolved);
      }
      progress?.throwIfStopped();
      return results;
    } catch (error) {
      if (progress) await this.releaseNodes(results, progress);
      progress?.throwIfStopped();
      throw error;
    }
  }

  private async releaseNodes(nodes: ResolvedNode[], progress: Progress): Promise<void> {
    if (nodes.length)
      await progress.cleanup(() =>
        Promise.all(
          nodes.map(({ objectId }) =>
            this.frame.session.send("Runtime.releaseObject", { objectId }).catch(() => {}),
          ),
        ),
      );
  }

  async countCss(selector: string, progress?: Progress): Promise<number> {
    return this.countElements("countCssMatchesPrimary", selector, progress);
  }

  private async countElements(
    helper: "countCssMatchesPrimary" | "countSemanticMatches",
    value: string | QueryStep[],
    progress?: Progress,
    errorHandling: "empty" | "throw" = "empty",
  ): Promise<number> {
    const session = this.frame.session;
    const { contextId } = await executionContexts.waitForLocatorWorld(
      session,
      this.frame.frameId,
      1000,
      progress,
      this.readinessOptions,
    );

    const expression = buildLocatorInvocation(helper, [JSON.stringify(value)]);
    return this.evaluateCount(expression, contextId, progress, errorHandling);
  }

  async countText(value: string, progress?: Progress): Promise<number> {
    const session = this.frame.session;
    const { contextId: ctxId } = await executionContexts.waitForLocatorWorld(
      session,
      this.frame.frameId,
      1000,
      progress,
      this.readinessOptions,
    );

    const expr = buildLocatorInvocation("countTextMatches", [JSON.stringify(value)]);

    try {
      const evalRes = await runLocatorStep(progress, "counting elements", () =>
        session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
          expression: expr,
          contextId: ctxId,
          returnByValue: true,
          awaitPromise: true,
        }),
      );

      if (evalRes.exceptionDetails) {
        const details = evalRes.exceptionDetails;
        this.frame.logger.error("Count text evaluation failed", {
          category: "locator",
          frameId: String(this.frame.frameId),
          selector: value,
          exception:
            details.text ??
            String(details.exception?.description ?? details.exception?.value ?? ""),
        });
        return 0;
      }

      const data = (evalRes.result.value ?? {}) as {
        count?: unknown;
      };

      const num = typeof data.count === "number" ? data.count : Number(data.count);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch (error) {
      progress?.throwIfStopped();
      if (progress && isCdpClosedError(error)) throw error;
      return 0;
    }
  }

  async countXPath(value: string, progress?: Progress): Promise<number> {
    const session = this.frame.session;

    const { contextId: ctxId } = await executionContexts.waitForLocatorWorld(
      session,
      this.frame.frameId,
      1000,
      progress,
      this.readinessOptions,
    );

    const expr = buildLocatorInvocation("countXPathMatchesMainWorld", [JSON.stringify(value)]);

    try {
      const evalRes = await runLocatorStep(progress, "counting elements", () =>
        session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
          expression: expr,
          contextId: ctxId,
          returnByValue: true,
          awaitPromise: true,
        }),
      );

      if (evalRes.exceptionDetails) {
        return 0;
      }

      const num =
        typeof evalRes.result.value === "number"
          ? evalRes.result.value
          : Number(evalRes.result.value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch (error) {
      progress?.throwIfStopped();
      if (progress && isCdpClosedError(error)) throw error;
      return 0;
    }
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
    errorHandling: "empty" | "throw" = "empty",
  ): Promise<number> {
    const session = this.frame.session;
    const release = (response: Protocol.Runtime.EvaluateResponse) =>
      response.result.objectId
        ? session
            .send("Runtime.releaseObject", { objectId: response.result.objectId })
            .catch(() => {})
        : undefined;

    try {
      const evalRes = await runLocatorStep(
        progress,
        "counting elements",
        () =>
          session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
            expression,
            contextId,
            returnByValue: true,
            awaitPromise: true,
          }),
        release,
      );

      if (evalRes.exceptionDetails) {
        if (errorHandling === "throw") {
          if (progress) await progress.cleanup(() => release(evalRes));
          else await release(evalRes);
          throw new SelectorEvaluationError(evalRes.exceptionDetails);
        }
        return 0;
      }

      const value = evalRes.result.value;
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch (error) {
      progress?.throwIfStopped();
      if (errorHandling === "throw") throw error;
      if (progress && isCdpClosedError(error)) throw error;
      return 0;
    }
  }

  async evaluateElement(
    expression: string,
    contextId: Protocol.Runtime.ExecutionContextId,
    progress?: Progress,
    errorHandling: "empty" | "throw" = "empty",
  ): Promise<ResolvedNode | null> {
    const session = this.frame.session;
    let objectId: Protocol.Runtime.RemoteObjectId | undefined;
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
      if (evalRes.exceptionDetails && errorHandling === "throw") {
        throw new SelectorEvaluationError(evalRes.exceptionDetails);
      }
      if (evalRes.exceptionDetails || !objectId) {
        if (objectId) {
          const discardedId = objectId;
          objectId = undefined;
          if (progress) await progress.cleanup(() => release(discardedId));
          else await release(discardedId).catch(() => {});
        }
        progress?.throwIfStopped();
        return null;
      }
      const resolved = await this.resolveFromObjectId(objectId, progress);
      progress?.throwIfStopped();
      return resolved;
    } catch (error) {
      if (objectId) {
        if (progress) await progress.cleanup(() => release(objectId!));
        else await release(objectId).catch(() => {});
      }
      progress?.throwIfStopped();
      if (errorHandling === "throw") throw error;
      if (progress && isCdpClosedError(error)) throw error;
      return null;
    }
  }
}
