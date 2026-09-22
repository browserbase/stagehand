import { sendCdpCommand, isClosedSessionError, type LocatorOperation } from "./locatorOperation.js";
import type { CDPSessionLike } from "./cdp.js";
import type { Protocol } from "devtools-protocol";
import type { Frame } from "./frame.js";
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
  constructor(
    readonly frame: Frame,
    readonly operation?: LocatorOperation,
  ) {}

  private send<R = unknown>(session: CDPSessionLike, method: string, params?: object): Promise<R> {
    return sendCdpCommand(session, this.operation?.budget, method, params);
  }

  private locatorWorld() {
    return this.operation
      ? executionContexts.waitForLocatorWorldReady(
          () => this.frame.session,
          this.frame.frameId,
          this.operation.budget,
        )
      : executionContexts.waitForLocatorWorld(this.frame.session, this.frame.frameId);
  }

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

  public async resolveFirst(query: SelectorQuery): Promise<ResolvedNode | null> {
    return this.resolveAtIndex(query, 0);
  }

  public async resolveAll(
    query: SelectorQuery,
    { limit = Infinity }: ResolveManyOptions = {},
  ): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];
    switch (query.kind) {
      case "css":
        return this.resolveCss(query.value, limit);
      case "text":
        return this.resolveText(query.value, limit);
      case "xpath":
        return this.resolveXPath(query.value, limit);
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

  public async resolveAtIndex(query: SelectorQuery, index: number): Promise<ResolvedNode | null> {
    if (index < 0 || !Number.isFinite(index)) return null;
    const results = await this.resolveAll(query, { limit: index + 1 });
    return results[index] ?? null;
  }

  async resolveCss(selector: string, limit: number): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];

    const { contextId: ctxId } = await this.locatorWorld();

    const results: ResolvedNode[] = [];

    for (let index = 0; index < limit; index += 1) {
      const expression = buildLocatorInvocation("resolveCssSelector", [
        JSON.stringify(selector),
        String(index),
      ]);
      const resolved = await this.evaluateElement(expression, ctxId);
      if (!resolved) break;
      results.push(resolved);
    }

    return results;
  }

  async resolveText(value: string, limit: number): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];

    const { contextId: ctxId } = await this.locatorWorld();

    const results: ResolvedNode[] = [];
    for (let index = 0; index < limit; index += 1) {
      const expr = buildLocatorInvocation("resolveTextSelector", [
        JSON.stringify(value),
        String(index),
      ]);
      const resolved = await this.evaluateElement(expr, ctxId);
      if (!resolved) break;
      results.push(resolved);
    }

    return results;
  }

  async resolveXPath(value: string, limit: number): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];

    const { contextId: ctxId } = await this.locatorWorld();

    const results: ResolvedNode[] = [];
    for (let index = 0; index < limit; index += 1) {
      const expr = buildLocatorInvocation("resolveXPathMainWorld", [
        JSON.stringify(value),
        String(index),
      ]);
      const resolved = await this.evaluateElement(expr, ctxId);
      if (!resolved) break;
      results.push(resolved);
    }

    return results;
  }

  async countCss(selector: string): Promise<number> {
    const { contextId } = await this.locatorWorld();

    const primaryExpr = buildLocatorInvocation("countCssMatchesPrimary", [
      JSON.stringify(selector),
    ]);
    return this.evaluateCount(primaryExpr, contextId);
  }

  async countText(value: string): Promise<number> {
    const { contextId: ctxId } = await this.locatorWorld();
    const session = this.frame.session;

    const expr = buildLocatorInvocation("countTextMatches", [JSON.stringify(value)]);

    try {
      const evalRes = await this.send<Protocol.Runtime.EvaluateResponse>(
        session,
        "Runtime.evaluate",
        {
          expression: expr,
          contextId: ctxId,
          returnByValue: true,
          awaitPromise: true,
        },
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
      this.operation?.budget.throwIfExpired();
      if (isClosedSessionError(error)) throw error;
      return 0;
    }
  }

  async countXPath(value: string): Promise<number> {
    const { contextId: ctxId } = await this.locatorWorld();
    const session = this.frame.session;

    const expr = buildLocatorInvocation("countXPathMatchesMainWorld", [JSON.stringify(value)]);

    try {
      const evalRes = await this.send<Protocol.Runtime.EvaluateResponse>(
        session,
        "Runtime.evaluate",
        {
          expression: expr,
          contextId: ctxId,
          returnByValue: true,
          awaitPromise: true,
        },
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
      this.operation?.budget.throwIfExpired();
      if (isClosedSessionError(error)) throw error;
      return 0;
    }
  }

  async resolveFromObjectId(
    objectId: Protocol.Runtime.RemoteObjectId,
  ): Promise<ResolvedNode | null> {
    const session = this.frame.session;
    let nodeId: Protocol.DOM.NodeId | null;
    try {
      const rn = await this.send<{ nodeId: Protocol.DOM.NodeId }>(session, "DOM.requestNode", {
        objectId,
      });
      nodeId = rn.nodeId ?? null;
    } catch (error) {
      this.operation?.budget.throwIfExpired();
      if (isClosedSessionError(error)) throw error;
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
      const evalRes = await this.send<Protocol.Runtime.EvaluateResponse>(
        session,
        "Runtime.evaluate",
        {
          expression,
          contextId,
          returnByValue: true,
          awaitPromise: true,
        },
      );

      if (evalRes.exceptionDetails) {
        return 0;
      }

      const value = evalRes.result.value;
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch (error) {
      this.operation?.budget.throwIfExpired();
      if (isClosedSessionError(error)) throw error;
      return 0;
    }
  }

  async evaluateElement(
    expression: string,
    contextId: Protocol.Runtime.ExecutionContextId,
  ): Promise<ResolvedNode | null> {
    const session = this.frame.session;

    try {
      const evalRes = await this.send<Protocol.Runtime.EvaluateResponse>(
        session,
        "Runtime.evaluate",
        {
          expression,
          contextId,
          returnByValue: false,
          awaitPromise: true,
        },
      );

      if (evalRes.exceptionDetails || !evalRes.result.objectId) {
        return null;
      }

      try {
        return await this.resolveFromObjectId(evalRes.result.objectId);
      } catch (error) {
        void this.send(session, "Runtime.releaseObject", {
          objectId: evalRes.result.objectId,
        }).catch(() => {});
        throw error;
      }
    } catch (error) {
      this.operation?.budget.throwIfExpired();
      if (isClosedSessionError(error)) throw error;
      return null;
    }
  }
}
