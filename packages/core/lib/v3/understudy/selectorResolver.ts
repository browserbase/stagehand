import type { Protocol } from "devtools-protocol";
import {
  locatorScriptBootstrap,
  locatorScriptGlobalRefs,
  type LocatorScriptName,
} from "../dom/build/locatorScripts.generated.js";
import { v3Logger } from "../logger.js";
import type { Frame } from "./frame.js";
import { executionContexts } from "./executionContextRegistry.js";

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
  constructor(private readonly frame: Frame) {}

  public static parseSelector(raw: string): SelectorQuery {
    const trimmed = raw.trim();

    const isText = /^text=/i.test(trimmed);
    const looksLikeXPath =
      /^xpath=/i.test(trimmed) ||
      trimmed.startsWith("/") ||
      trimmed.startsWith("(");
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
  ): Promise<ResolvedNode | null> {
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

  public async resolveAtIndex(
    query: SelectorQuery,
    index: number,
  ): Promise<ResolvedNode | null> {
    if (index < 0 || !Number.isFinite(index)) return null;
    const results = await this.resolveAll(query, { limit: index + 1 });
    return results[index] ?? null;
  }

  private buildLocatorInvocation(
    name: LocatorScriptName,
    args: string[],
  ): string {
    const call = `${locatorScriptGlobalRefs[name]}(${args.join(", ")})`;
    return `(() => { ${locatorScriptBootstrap}; return ${call}; })()`;
  }

  private async resolveCss(
    selector: string,
    limit: number,
  ): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];

    const session = this.frame.session;
    const { executionContextId } = await session.send<{
      executionContextId: Protocol.Runtime.ExecutionContextId;
    }>("Page.createIsolatedWorld", {
      frameId: this.frame.frameId,
      worldName: "v3-world",
    });

    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const results: ResolvedNode[] = [];
    let loggedFallback = false;

    for (let index = 0; index < limit; index += 1) {
      const primaryExpr = this.buildLocatorInvocation("resolveCssSelector", [
        JSON.stringify(selector),
        String(index),
      ]);
      const primary = await this.evaluateElement(
        primaryExpr,
        executionContextId,
      );
      if (primary) {
        results.push(primary);
        continue;
      }

      if (!loggedFallback) {
        v3Logger({
          category: "locator",
          message: "css pierce-fallback",
          level: 2,
          auxiliary: {
            frameId: { value: String(this.frame.frameId), type: "string" },
            selector: { value: selector, type: "string" },
          },
        });
        loggedFallback = true;
      }

      const fallbackExpr = this.buildLocatorInvocation(
        "resolveCssSelectorPierce",
        [JSON.stringify(selector), String(index)],
      );
      const fallback = await this.evaluateElement(fallbackExpr, ctxId);
      if (fallback) {
        results.push(fallback);
        continue;
      }

      break;
    }

    return results;
  }

  private async resolveText(
    value: string,
    limit: number,
  ): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];

    const session = this.frame.session;
    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const results: ResolvedNode[] = [];
    for (let index = 0; index < limit; index += 1) {
      const expr = this.buildLocatorInvocation("resolveTextSelector", [
        JSON.stringify(value),
        String(index),
      ]);
      const resolved = await this.evaluateElement(expr, ctxId);
      if (!resolved) break;
      results.push(resolved);
    }

    return results;
  }

  private async resolveXPath(
    value: string,
    limit: number,
  ): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];

    const session = this.frame.session;
    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const results: ResolvedNode[] = [];
    for (let index = 0; index < limit; index += 1) {
      const expr = this.buildLocatorInvocation("resolveXPathMainWorld", [
        JSON.stringify(value),
        String(index),
      ]);
      const resolved = await this.evaluateElement(expr, ctxId);
      if (!resolved) break;
      results.push(resolved);
    }

    return results;
  }

  private async countCss(selector: string): Promise<number> {
    const session = this.frame.session;

    const { executionContextId } = await session.send<{
      executionContextId: Protocol.Runtime.ExecutionContextId;
    }>("Page.createIsolatedWorld", {
      frameId: this.frame.frameId,
      worldName: "v3-world",
    });

    const primaryExpr = this.buildLocatorInvocation("countCssMatchesPrimary", [
      JSON.stringify(selector),
    ]);
    const primary = await this.evaluateCount(primaryExpr, executionContextId);

    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const fallbackExpr = this.buildLocatorInvocation("countCssMatchesPierce", [
      JSON.stringify(selector),
    ]);
    const fallback = await this.evaluateCount(fallbackExpr, ctxId);

    return Math.max(primary, fallback);
  }

  private async countText(value: string): Promise<number> {
    const session = this.frame.session;
    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const expr = this.buildLocatorInvocation("countTextMatches", [
      JSON.stringify(value),
    ]);

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
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
        v3Logger({
          category: "locator",
          message: "count text evaluate exception",
          level: 0,
          auxiliary: {
            frameId: { value: String(this.frame.frameId), type: "string" },
            selector: { value: value, type: "string" },
            exception: {
              value:
                details.text ??
                String(
                  details.exception?.description ??
                    details.exception?.value ??
                    "",
                ),
              type: "string",
            },
          },
        });
        return 0;
      }

      const data = (evalRes.result.value ?? {}) as {
        count?: unknown;
      };

      const num =
        typeof data.count === "number" ? data.count : Number(data.count);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch {
      return 0;
    }
  }

  private async countXPath(value: string): Promise<number> {
    const session = this.frame.session;

    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const expr = this.buildLocatorInvocation("countXPathMatchesMainWorld", [
      JSON.stringify(value),
    ]);

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
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
    } catch {
      return 0;
    }
  }

  private async resolveFromObjectId(
    objectId: Protocol.Runtime.RemoteObjectId,
  ): Promise<ResolvedNode | null> {
    const session = this.frame.session;
    let nodeId: Protocol.DOM.NodeId | null;
    try {
      const rn = await session.send<{ nodeId: Protocol.DOM.NodeId }>(
        "DOM.requestNode",
        { objectId },
      );
      nodeId = rn.nodeId ?? null;
    } catch {
      nodeId = null;
    }

    return { objectId, nodeId };
  }

  private async evaluateCount(
    expression: string,
    contextId: Protocol.Runtime.ExecutionContextId,
  ): Promise<number> {
    const session = this.frame.session;

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
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
    } catch {
      return 0;
    }
  }

  private async evaluateElement(
    expression: string,
    contextId: Protocol.Runtime.ExecutionContextId,
  ): Promise<ResolvedNode | null> {
    const session = this.frame.session;

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
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

      return this.resolveFromObjectId(evalRes.result.objectId);
    } catch {
      return null;
    }
  }
}
