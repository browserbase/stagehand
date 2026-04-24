import type { Protocol } from "devtools-protocol";
import type { Frame } from "./frame.js";
import {
  collectClosedShadowRoots,
  releaseRemoteObject,
} from "./cdpClosedRoots.js";
import {
  selectorRuntimeBootstrap,
  selectorRuntimeGlobalRefs,
} from "../dom/build/selectorRuntime.generated.js";

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

const wrapSelectorRuntimeCall = (
  globalRef: string,
  argsExpression = "...arguments",
) =>
  `function() { ${selectorRuntimeBootstrap}; return ${globalRef}.call(this, ${argsExpression}); }`;

const selectorRuntimeDeclarations = {
  queryCssWithRoots: wrapSelectorRuntimeCall(
    selectorRuntimeGlobalRefs.queryCssWithRoots,
  ),
  countCssWithRoots: wrapSelectorRuntimeCall(
    selectorRuntimeGlobalRefs.countCssWithRoots,
  ),
  queryTextWithRoots: wrapSelectorRuntimeCall(
    selectorRuntimeGlobalRefs.queryTextWithRoots,
  ),
  countTextWithRoots: wrapSelectorRuntimeCall(
    selectorRuntimeGlobalRefs.countTextWithRoots,
  ),
  queryXPathWithRoots: wrapSelectorRuntimeCall(
    selectorRuntimeGlobalRefs.queryXPathWithRoots,
  ),
  countXPathWithRoots: wrapSelectorRuntimeCall(
    selectorRuntimeGlobalRefs.countXPathWithRoots,
  ),
  queryXPathNative: wrapSelectorRuntimeCall(
    selectorRuntimeGlobalRefs.queryXPathNative,
  ),
  countXPathNative: wrapSelectorRuntimeCall(
    selectorRuntimeGlobalRefs.countXPathNative,
  ),
  hasOpenShadowRoots: wrapSelectorRuntimeCall(
    selectorRuntimeGlobalRefs.hasOpenShadowRoots,
  ),
} as const;

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

  private async resolveCss(
    selector: string,
    limit: number,
  ): Promise<ResolvedNode[]> {
    const objectIds = await this.queryElementsAcrossRoots(
      selectorRuntimeDeclarations.queryCssWithRoots,
      selector,
      limit,
    );
    return this.resolveObjectIds(objectIds);
  }

  private async resolveText(
    value: string,
    limit: number,
  ): Promise<ResolvedNode[]> {
    const objectIds = await this.queryElementsAcrossRoots(
      selectorRuntimeDeclarations.queryTextWithRoots,
      value,
      limit,
    );
    return this.resolveObjectIds(objectIds);
  }

  private async resolveXPath(
    value: string,
    limit: number,
  ): Promise<ResolvedNode[]> {
    const objectIds = await this.queryXPath(value, limit);
    return this.resolveObjectIds(objectIds);
  }

  private async countCss(selector: string): Promise<number> {
    return this.countAcrossRoots(
      selectorRuntimeDeclarations.countCssWithRoots,
      selector,
    );
  }

  private async countText(value: string): Promise<number> {
    return this.countAcrossRoots(
      selectorRuntimeDeclarations.countTextWithRoots,
      value,
    );
  }

  private async countXPath(value: string): Promise<number> {
    return this.countXPathMatches(value);
  }

  private async queryXPath(
    query: string,
    limit: number,
  ): Promise<Protocol.Runtime.RemoteObjectId[]> {
    if (limit <= 0) return [];

    let bundle:
      | Awaited<ReturnType<typeof collectClosedShadowRoots>>
      | undefined;
    let resultArrayId: Protocol.Runtime.RemoteObjectId | undefined;
    try {
      bundle = await collectClosedShadowRoots(this.frame);
      const hasOpenShadowRoots = await this.hasOpenShadowRoots(
        bundle.documentObjectId,
      );
      const shouldUseComposed = bundle.roots.length > 0 || hasOpenShadowRoots;

      const pairArgs = bundle.roots.flatMap((pair) => [
        { objectId: pair.hostObjectId },
        { objectId: pair.rootObjectId },
      ]);

      const called =
        await this.frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
          "Runtime.callFunctionOn",
          {
            objectId: bundle.documentObjectId,
            functionDeclaration: shouldUseComposed
              ? selectorRuntimeDeclarations.queryXPathWithRoots
              : selectorRuntimeDeclarations.queryXPathNative,
            arguments: shouldUseComposed
              ? [{ value: query }, { value: limit }, ...pairArgs]
              : [{ value: query }, { value: limit }],
            returnByValue: false,
            awaitPromise: true,
          },
        );
      resultArrayId = called.result.objectId;
      if (!resultArrayId) return [];
      return await this.getArrayElementObjectIds(resultArrayId);
    } catch {
      return [];
    } finally {
      await releaseRemoteObject(this.frame, resultArrayId);
      if (bundle) {
        await this.releaseClosedRootBundle(bundle);
      }
    }
  }

  private async countXPathMatches(query: string): Promise<number> {
    let bundle:
      | Awaited<ReturnType<typeof collectClosedShadowRoots>>
      | undefined;
    try {
      bundle = await collectClosedShadowRoots(this.frame);
      const hasOpenShadowRoots = await this.hasOpenShadowRoots(
        bundle.documentObjectId,
      );
      const shouldUseComposed = bundle.roots.length > 0 || hasOpenShadowRoots;
      const pairArgs = bundle.roots.flatMap((pair) => [
        { objectId: pair.hostObjectId },
        { objectId: pair.rootObjectId },
      ]);

      const called =
        await this.frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
          "Runtime.callFunctionOn",
          {
            objectId: bundle.documentObjectId,
            functionDeclaration: shouldUseComposed
              ? selectorRuntimeDeclarations.countXPathWithRoots
              : selectorRuntimeDeclarations.countXPathNative,
            arguments: shouldUseComposed
              ? [{ value: query }, ...pairArgs]
              : [{ value: query }],
            returnByValue: true,
            awaitPromise: true,
          },
        );
      const value = called.result.value;
      const count = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(count)) return 0;
      return Math.max(0, Math.floor(count));
    } catch {
      return 0;
    } finally {
      if (bundle) {
        await this.releaseClosedRootBundle(bundle);
      }
    }
  }

  private async hasOpenShadowRoots(
    documentObjectId: Protocol.Runtime.RemoteObjectId,
  ): Promise<boolean> {
    try {
      const result =
        await this.frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
          "Runtime.callFunctionOn",
          {
            objectId: documentObjectId,
            functionDeclaration: selectorRuntimeDeclarations.hasOpenShadowRoots,
            returnByValue: true,
            awaitPromise: true,
          },
        );
      return result.result.value === true;
    } catch {
      return false;
    }
  }

  private async releaseClosedRootBundle(
    bundle: Awaited<ReturnType<typeof collectClosedShadowRoots>>,
  ): Promise<void> {
    await releaseRemoteObject(this.frame, bundle.documentObjectId);
    for (const pair of bundle.roots) {
      await releaseRemoteObject(this.frame, pair.hostObjectId);
      await releaseRemoteObject(this.frame, pair.rootObjectId);
    }
  }

  private async queryElementsAcrossRoots(
    functionDeclaration: string,
    query: string,
    limit: number,
  ): Promise<Protocol.Runtime.RemoteObjectId[]> {
    if (limit <= 0) return [];
    const safeLimit = Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : Number.MAX_SAFE_INTEGER;

    let bundle:
      | Awaited<ReturnType<typeof collectClosedShadowRoots>>
      | undefined;
    let resultArrayId: Protocol.Runtime.RemoteObjectId | undefined;
    try {
      bundle = await collectClosedShadowRoots(this.frame);
      const pairArgs = bundle.roots.flatMap((pair) => [
        { objectId: pair.hostObjectId },
        { objectId: pair.rootObjectId },
      ]);

      const called =
        await this.frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
          "Runtime.callFunctionOn",
          {
            objectId: bundle.documentObjectId,
            functionDeclaration,
            arguments: [{ value: query }, { value: safeLimit }, ...pairArgs],
            returnByValue: false,
            awaitPromise: true,
          },
        );
      resultArrayId = called.result.objectId;
      if (!resultArrayId) return [];
      return await this.getArrayElementObjectIds(resultArrayId);
    } catch {
      return [];
    } finally {
      await releaseRemoteObject(this.frame, resultArrayId);
      if (bundle) {
        await this.releaseClosedRootBundle(bundle);
      }
    }
  }

  private async countAcrossRoots(
    functionDeclaration: string,
    query: string,
  ): Promise<number> {
    let bundle:
      | Awaited<ReturnType<typeof collectClosedShadowRoots>>
      | undefined;
    try {
      bundle = await collectClosedShadowRoots(this.frame);
      const pairArgs = bundle.roots.flatMap((pair) => [
        { objectId: pair.hostObjectId },
        { objectId: pair.rootObjectId },
      ]);

      const called =
        await this.frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
          "Runtime.callFunctionOn",
          {
            objectId: bundle.documentObjectId,
            functionDeclaration,
            arguments: [{ value: query }, ...pairArgs],
            returnByValue: true,
            awaitPromise: true,
          },
        );
      const value = called.result.value;
      const count = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(count)) return 0;
      return Math.max(0, Math.floor(count));
    } catch {
      return 0;
    } finally {
      if (bundle) {
        await this.releaseClosedRootBundle(bundle);
      }
    }
  }

  private async getArrayElementObjectIds(
    arrayObjectId: Protocol.Runtime.RemoteObjectId,
  ): Promise<Protocol.Runtime.RemoteObjectId[]> {
    const properties =
      await this.frame.session.send<Protocol.Runtime.GetPropertiesResponse>(
        "Runtime.getProperties",
        {
          objectId: arrayObjectId,
          ownProperties: true,
        },
      );

    return properties.result
      .filter(
        (property) => /^\d+$/.test(property.name) && !!property.value?.objectId,
      )
      .sort((a, b) => Number(a.name) - Number(b.name))
      .map((property) => property.value!.objectId!);
  }

  private async resolveObjectIds(
    objectIds: Protocol.Runtime.RemoteObjectId[],
  ): Promise<ResolvedNode[]> {
    const results: ResolvedNode[] = [];
    for (const objectId of objectIds) {
      const resolved = await this.resolveFromObjectId(objectId);
      if (!resolved) {
        await releaseRemoteObject(this.frame, objectId);
        continue;
      }
      results.push(resolved);
    }
    return results;
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
}
