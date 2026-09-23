import type { Protocol } from "devtools-protocol";
import type { Frame } from "./frame.js";
import { type Progress, runLocatorStep } from "./progress.js";
import { executionContexts } from "./executionContextRegistry.js";
import { buildLocatorInvocation } from "./locatorInvocation.js";

export type SelectorQuery =
  | { kind: "css"; value: string }
  | { kind: "text"; value: string }
  | { kind: "xpath"; value: string };

export interface ResolvedNode {
  objectId: Protocol.Runtime.RemoteObjectId;
  nodeId: Protocol.DOM.NodeId | null;
}

export interface ResolveManyOptions {
  limit?: number;
}

export class FrameSelectorResolver {
  constructor(readonly frame: Frame) {}

  public static parseSelector(raw: string): SelectorQuery {
    const trimmed = raw.trim();

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
      selector = selector
        .split(">>")
        .map((piece) => piece.trim())
        .filter(Boolean)
        .join(" ");
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
    progress?.throwIfStopped();
    if (limit <= 0) return [];
    switch (query.kind) {
      case "css":
        return this.resolveCss(query.value, limit, progress);
      case "text":
        return this.resolveText(query.value, limit, progress);
      case "xpath":
        return this.resolveXPath(query.value, limit, progress);
      default:
        return [];
    }
  }

  public async count(query: SelectorQuery): Promise<number> {
    switch (query.kind) {
      case "css":
        return this.countCss(query.value);
      case "text":
        return this.countText(query.value);
      case "xpath":
        return this.countXPath(query.value);
      default:
        return 0;
    }
  }

  public async resolveAtIndex(
    query: SelectorQuery,
    index: number,
    progress?: Progress,
  ): Promise<ResolvedNode | null> {
    progress?.throwIfStopped();
    if (index < 0 || !Number.isFinite(index)) return null;
    const results = await this.resolveAll(query, { limit: index + 1 }, progress);
    const selected = results[index] ?? null;
    if (progress) {
      await this.releaseNodes(
        results.filter((node) => node !== selected),
        progress,
      );
      try {
        progress.throwIfStopped();
      } catch (error) {
        if (selected) await this.releaseNodes([selected], progress);
        throw error;
      }
    }
    return selected;
  }

  async resolveCss(selector: string, limit: number, progress?: Progress): Promise<ResolvedNode[]> {
    return this.resolveElements("resolveCssSelector", selector, limit, progress);
  }

  async resolveText(value: string, limit: number, progress?: Progress): Promise<ResolvedNode[]> {
    return this.resolveElements("resolveTextSelector", value, limit, progress);
  }

  async resolveXPath(value: string, limit: number, progress?: Progress): Promise<ResolvedNode[]> {
    return this.resolveElements("resolveXPathMainWorld", value, limit, progress);
  }

  private async resolveElements(
    helper: "resolveCssSelector" | "resolveTextSelector" | "resolveXPathMainWorld",
    value: string,
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
    );
    const results: ResolvedNode[] = [];
    try {
      for (let index = 0; index < limit; index += 1) {
        const expression = buildLocatorInvocation(helper, [JSON.stringify(value), String(index)]);
        const resolved = await this.evaluateElement(expression, contextId, progress);
        if (!resolved) break;
        results.push(resolved);
      }
      return results;
    } catch (error) {
      if (progress) await this.releaseNodes(results, progress);
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

  async countCss(selector: string): Promise<number> {
    const session = this.frame.session;
    const { contextId } = await executionContexts.waitForLocatorWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const primaryExpr = buildLocatorInvocation("countCssMatchesPrimary", [
      JSON.stringify(selector),
    ]);
    return this.evaluateCount(primaryExpr, contextId);
  }

  async countText(value: string): Promise<number> {
    const session = this.frame.session;
    const { contextId: ctxId } = await executionContexts.waitForLocatorWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const expr = buildLocatorInvocation("countTextMatches", [JSON.stringify(value)]);

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression: expr,
        contextId: ctxId,
        returnByValue: true,
        awaitPromise: true,
      });

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
    } catch {
      return 0;
    }
  }

  async countXPath(value: string): Promise<number> {
    const session = this.frame.session;

    const { contextId: ctxId } = await executionContexts.waitForLocatorWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const expr = buildLocatorInvocation("countXPathMatchesMainWorld", [JSON.stringify(value)]);

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression: expr,
        contextId: ctxId,
        returnByValue: true,
        awaitPromise: true,
      });

      if (evalRes.exceptionDetails) {
        return 0;
      }

      const num =
        typeof evalRes.result.value === "number"
          ? evalRes.result.value
          : Number(evalRes.result.value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch {
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
    } catch {
      progress?.throwIfStopped();
      nodeId = null;
    }

    return { objectId, nodeId };
  }

  async evaluateCount(
    expression: string,
    contextId: Protocol.Runtime.ExecutionContextId,
  ): Promise<number> {
    const session = this.frame.session;

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
        expression,
        contextId,
        returnByValue: true,
        awaitPromise: true,
      });

      if (evalRes.exceptionDetails) {
        return 0;
      }

      const value = evalRes.result.value;
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch {
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
        if (progress && objectId) await progress.cleanup(() => release(objectId!));
        return null;
      }
      return await this.resolveFromObjectId(objectId, progress);
    } catch {
      if (progress && objectId) await progress.cleanup(() => release(objectId!));
      progress?.throwIfStopped();
      return null;
    }
  }
}
