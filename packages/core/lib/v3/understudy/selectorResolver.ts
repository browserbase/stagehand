import type { Protocol } from "devtools-protocol";
import type { Frame } from "./frame.js";
import {
  collectClosedShadowRoots,
  releaseRemoteObject,
} from "./cdpClosedRoots.js";

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

const QUERY_CSS_WITH_ROOTS_DECLARATION = `function(selector, limit, ...rootPairs) {
  const closedRoots = new Map();
  for (let i = 0; i < rootPairs.length; i += 2) {
    const host = rootPairs[i];
    const root = rootPairs[i + 1];
    if (host instanceof Element && root instanceof ShadowRoot) {
      closedRoots.set(host, root);
    }
  }

  const composedChildren = (node) => {
    if (!node) return [];
    if (node instanceof Document) {
      return node.documentElement ? [node.documentElement] : [];
    }
    if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
      return Array.from(node.children || []);
    }
    if (!(node instanceof Element)) return [];

    const out = Array.from(node.children || []);
    if (node.shadowRoot) out.push(...Array.from(node.shadowRoot.children || []));
    const closed = closedRoots.get(node);
    if (closed) out.push(...Array.from(closed.children || []));
    return out;
  };

  const results = [];
  const seen = new Set();
  const stack = [...composedChildren(this)].reverse();

  while (stack.length && results.length < limit) {
    const next = stack.pop();
    if (!(next instanceof Element) || seen.has(next)) continue;
    seen.add(next);

    try {
      if (next.matches(selector)) {
        results.push(next);
        if (results.length >= limit) break;
      }
    } catch {
      return [];
    }

    const children = composedChildren(next);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }

  return results;
}`;

const COUNT_CSS_WITH_ROOTS_DECLARATION = `function(selector, ...rootPairs) {
  const matches = (${QUERY_CSS_WITH_ROOTS_DECLARATION}).call(this, selector, Number.MAX_SAFE_INTEGER, ...rootPairs);
  return matches.length;
}`;

const QUERY_TEXT_WITH_ROOTS_DECLARATION = `function(needle, limit, ...rootPairs) {
  const closedRoots = new Map();
  for (let i = 0; i < rootPairs.length; i += 2) {
    const host = rootPairs[i];
    const root = rootPairs[i + 1];
    if (host instanceof Element && root instanceof ShadowRoot) {
      closedRoots.set(host, root);
    }
  }

  const skipTags = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEAD", "TITLE", "LINK", "META", "HTML", "BODY"]);
  const query = String(needle || "").toLowerCase();
  if (!query) return [];

  const composedChildren = (node) => {
    if (!node) return [];
    if (node instanceof Document) {
      return node.documentElement ? [node.documentElement] : [];
    }
    if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
      return Array.from(node.children || []);
    }
    if (!(node instanceof Element)) return [];

    const out = Array.from(node.children || []);
    if (node.shadowRoot) out.push(...Array.from(node.shadowRoot.children || []));
    const closed = closedRoots.get(node);
    if (closed) out.push(...Array.from(closed.children || []));
    return out;
  };

  const extractText = (element) => {
    const tag = element.tagName ? element.tagName.toUpperCase() : "";
    if (skipTags.has(tag)) return "";
    try {
      const inner = element.innerText;
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    } catch {}
    const text = element.textContent;
    return typeof text === "string" ? text.trim() : "";
  };

  const matches = [];
  const seen = new Set();
  const stack = [...composedChildren(this)].reverse();

  while (stack.length) {
    const next = stack.pop();
    if (!(next instanceof Element) || seen.has(next)) continue;
    seen.add(next);

    const text = extractText(next);
    if (text && text.toLowerCase().includes(query)) {
      matches.push(next);
    }

    const children = composedChildren(next);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]);
    }
  }

  const filtered = [];
  for (const candidate of matches) {
    let covered = false;
    for (const other of matches) {
      if (candidate === other) continue;
      try {
        if (candidate.contains(other)) {
          covered = true;
          break;
        }
      } catch {}
    }
    if (!covered) {
      filtered.push(candidate);
      if (filtered.length >= limit) break;
    }
  }

  return filtered;
}`;

const COUNT_TEXT_WITH_ROOTS_DECLARATION = `function(needle, ...rootPairs) {
  const matches = (${QUERY_TEXT_WITH_ROOTS_DECLARATION}).call(this, needle, Number.MAX_SAFE_INTEGER, ...rootPairs);
  return matches.length;
}`;

const QUERY_XPATH_WITH_ROOTS_DECLARATION = `function(rawXPath, limit, ...rootPairs) {
  const closedRoots = new Map();
  for (let i = 0; i < rootPairs.length; i += 2) {
    const host = rootPairs[i];
    const root = rootPairs[i + 1];
    if (host instanceof Element && root instanceof ShadowRoot) {
      closedRoots.set(host, root);
    }
  }

  const normalizeXPath = (selector) => {
    const raw = String(selector || "").trim();
    if (!raw) return "";
    return raw.replace(/^xpath=/i, "").trim();
  };

  const extractPredicates = (str) => {
    const results = [];
    let i = 0;
    while (i < str.length) {
      if (str[i] !== "[") {
        i += 1;
        continue;
      }
      i += 1;
      const start = i;
      let quote = null;
      while (i < str.length) {
        const ch = str[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"') {
          quote = ch;
        } else if (ch === "]") {
          break;
        }
        i += 1;
      }
      results.push(str.slice(start, i).trim());
      i += 1;
    }
    return results;
  };

  const isBoundary = (ch) => !/[a-zA-Z0-9_.-]/.test(ch);
  const isKeywordAt = (input, index, keyword) => {
    if (!input.startsWith(keyword, index)) return false;
    const before = index > 0 ? input[index - 1] : " ";
    if (before === "@") return false;
    const after =
      index + keyword.length < input.length ? input[index + keyword.length] : " ";
    return isBoundary(before) && isBoundary(after);
  };

  const splitTopLevel = (input, keyword) => {
    const parts = [];
    let start = 0;
    let depth = 0;
    let quote = null;
    let i = 0;

    while (i < input.length) {
      const ch = input[i];
      if (quote) {
        if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        i += 1;
        continue;
      }
      if (ch === "(") {
        depth += 1;
        i += 1;
        continue;
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1);
        i += 1;
        continue;
      }
      if (depth === 0 && isKeywordAt(input, i, keyword)) {
        parts.push(input.slice(start, i).trim());
        i += keyword.length;
        start = i;
        continue;
      }
      i += 1;
    }

    parts.push(input.slice(start).trim());
    return parts.filter((part) => part.length > 0);
  };

  const hasBalancedParens = (input) => {
    let depth = 0;
    let quote = null;
    for (let i = 0; i < input.length; i += 1) {
      const ch = input[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      if (depth < 0) return false;
    }
    return depth === 0;
  };

  const unwrapFunctionCall = (input, name) => {
    const prefix = name + "(";
    if (!input.startsWith(prefix) || !input.endsWith(")")) return null;
    const inner = input.slice(prefix.length, -1);
    return hasBalancedParens(inner) ? inner : null;
  };

  const parseAtomicPredicate = (input) => {
    const attrName = "[a-zA-Z_][\\w.-]*";
    const quoted = "(?:'([^']*)'|\\\"([^\\\"]*)\\\")";

    if (/^\\d+$/.test(input)) {
      return { type: "index", index: Math.max(1, Number(input)) };
    }

    const normalizeAttrMatch = input.match(
      new RegExp("^normalize-space\\\\(\\\\s*@(" + attrName + ")\\\\s*\\\\)\\\\s*=\\\\s*" + quoted + "$"),
    );
    if (normalizeAttrMatch) {
      return {
        type: "attrEquals",
        name: normalizeAttrMatch[1],
        value: normalizeAttrMatch[2] || normalizeAttrMatch[3] || "",
        normalize: true,
      };
    }

    const normalizeTextMatch = input.match(
      new RegExp("^normalize-space\\\\(\\\\s*(?:text\\\\(\\\\)|\\\\.)\\\\s*\\\\)\\\\s*=\\\\s*" + quoted + "$"),
    );
    if (normalizeTextMatch) {
      return {
        type: "textEquals",
        value: normalizeTextMatch[1] || normalizeTextMatch[2] || "",
        normalize: true,
      };
    }

    const attrEqualsMatch = input.match(
      new RegExp("^@(" + attrName + ")\\\\s*=\\\\s*" + quoted + "$"),
    );
    if (attrEqualsMatch) {
      return {
        type: "attrEquals",
        name: attrEqualsMatch[1],
        value: attrEqualsMatch[2] || attrEqualsMatch[3] || "",
      };
    }

    const attrExistsMatch = input.match(new RegExp("^@(" + attrName + ")$"));
    if (attrExistsMatch) {
      return { type: "attrExists", name: attrExistsMatch[1] };
    }

    const attrContainsMatch = input.match(
      new RegExp("^contains\\\\(\\\\s*@(" + attrName + ")\\\\s*,\\\\s*" + quoted + "\\\\s*\\\\)$"),
    );
    if (attrContainsMatch) {
      return {
        type: "attrContains",
        name: attrContainsMatch[1],
        value: attrContainsMatch[2] || attrContainsMatch[3] || "",
      };
    }

    const attrStartsMatch = input.match(
      new RegExp("^starts-with\\\\(\\\\s*@(" + attrName + ")\\\\s*,\\\\s*" + quoted + "\\\\s*\\\\)$"),
    );
    if (attrStartsMatch) {
      return {
        type: "attrStartsWith",
        name: attrStartsMatch[1],
        value: attrStartsMatch[2] || attrStartsMatch[3] || "",
      };
    }

    const textEqualsMatch = input.match(
      new RegExp("^(?:text\\\\(\\\\)|\\\\.)\\\\s*=\\\\s*" + quoted + "$"),
    );
    if (textEqualsMatch) {
      return {
        type: "textEquals",
        value: textEqualsMatch[1] || textEqualsMatch[2] || "",
      };
    }

    const textContainsMatch = input.match(
      new RegExp("^contains\\\\(\\\\s*(?:text\\\\(\\\\)|\\\\.)\\\\s*,\\\\s*" + quoted + "\\\\s*\\\\)$"),
    );
    if (textContainsMatch) {
      return {
        type: "textContains",
        value: textContainsMatch[1] || textContainsMatch[2] || "",
      };
    }

    return null;
  };

  const parsePredicateExpression = (input) => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const orParts = splitTopLevel(trimmed, "or");
    if (orParts.length > 1) {
      const preds = orParts.map(parsePredicateExpression).filter(Boolean);
      if (preds.length !== orParts.length) return null;
      return { type: "or", predicates: preds };
    }

    const andParts = splitTopLevel(trimmed, "and");
    if (andParts.length > 1) {
      const preds = andParts.map(parsePredicateExpression).filter(Boolean);
      if (preds.length !== andParts.length) return null;
      return { type: "and", predicates: preds };
    }

    const notInner = unwrapFunctionCall(trimmed, "not");
    if (notInner != null) {
      const predicate = parsePredicateExpression(notInner);
      return predicate ? { type: "not", predicate } : null;
    }

    return parseAtomicPredicate(trimmed);
  };

  const parseStep = (raw) => {
    const bracketPos = raw.indexOf("[");
    if (bracketPos === -1) {
      const tag = raw === "" ? "*" : raw.toLowerCase();
      return { tag, predicates: [] };
    }

    const tagPart = raw.slice(0, bracketPos).trim();
    const tag = tagPart === "" ? "*" : tagPart.toLowerCase();
    const predicateStr = raw.slice(bracketPos);
    const predicates = [];
    for (const inner of extractPredicates(predicateStr)) {
      const parsed = parsePredicateExpression(inner);
      if (parsed) predicates.push(parsed);
    }
    return { tag, predicates };
  };

  const parseXPathSteps = (input) => {
    const path = normalizeXPath(input);
    if (!path) return [];

    const steps = [];
    let i = 0;
    while (i < path.length) {
      let axis = "child";
      if (path.startsWith("//", i)) {
        axis = "desc";
        i += 2;
      } else if (path[i] === "/") {
        axis = "child";
        i += 1;
      }

      const start = i;
      let bracketDepth = 0;
      let quote = null;
      while (i < path.length) {
        const ch = path[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"') {
          quote = ch;
        } else if (ch === "[") {
          bracketDepth += 1;
        } else if (ch === "]") {
          bracketDepth -= 1;
        } else if (ch === "/" && bracketDepth === 0) {
          break;
        }
        i += 1;
      }
      const rawStep = path.slice(start, i).trim();
      if (!rawStep) continue;
      const parsed = parseStep(rawStep);
      steps.push({ axis, tag: parsed.tag, predicates: parsed.predicates });
    }
    return steps;
  };

  const normalizeSpace = (value) => String(value || "").replace(/s+/g, " ").trim();
  const normalizeMaybe = (value, normalize) => (normalize ? normalizeSpace(value) : String(value || ""));
  const textValue = (element) => String(element && element.textContent ? element.textContent : "");

  const evaluatePredicate = (element, predicate) => {
    switch (predicate.type) {
      case "and":
        return predicate.predicates.every((p) => evaluatePredicate(element, p));
      case "or":
        return predicate.predicates.some((p) => evaluatePredicate(element, p));
      case "not":
        return !evaluatePredicate(element, predicate.predicate);
      case "attrExists":
        return element.getAttribute(predicate.name) !== null;
      case "attrEquals": {
        const attr = element.getAttribute(predicate.name);
        if (attr === null) return false;
        return normalizeMaybe(attr, predicate.normalize) === normalizeMaybe(predicate.value, predicate.normalize);
      }
      case "attrContains": {
        const attr = element.getAttribute(predicate.name);
        if (attr === null) return false;
        return normalizeMaybe(attr, predicate.normalize).includes(normalizeMaybe(predicate.value, predicate.normalize));
      }
      case "attrStartsWith": {
        const attr = element.getAttribute(predicate.name);
        if (attr === null) return false;
        return normalizeMaybe(attr, predicate.normalize).startsWith(normalizeMaybe(predicate.value, predicate.normalize));
      }
      case "textEquals":
        return normalizeMaybe(textValue(element), predicate.normalize) === normalizeMaybe(predicate.value, predicate.normalize);
      case "textContains":
        return normalizeMaybe(textValue(element), predicate.normalize).includes(normalizeMaybe(predicate.value, predicate.normalize));
      case "index":
        return true;
      default:
        return true;
    }
  };

  const applyPredicates = (elements, predicates) => {
    let current = elements;
    for (const predicate of predicates) {
      if (!current.length) return [];
      if (predicate.type === "index") {
        const idx = predicate.index - 1;
        current = idx >= 0 && idx < current.length ? [current[idx]] : [];
        continue;
      }
      current = current.filter((el) => evaluatePredicate(el, predicate));
    }
    return current;
  };

  const composedChildren = (node) => {
    if (!node) return [];
    if (node instanceof Document) {
      return node.documentElement ? [node.documentElement] : [];
    }
    if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
      return Array.from(node.children || []);
    }
    if (!(node instanceof Element)) return [];

    const out = Array.from(node.children || []);
    if (node.shadowRoot) out.push(...Array.from(node.shadowRoot.children || []));
    const closed = closedRoots.get(node);
    if (closed) out.push(...Array.from(closed.children || []));
    return out;
  };

  const composedDescendants = (node) => {
    const out = [];
    const seen = new Set();
    const stack = [...composedChildren(node)].reverse();
    while (stack.length) {
      const next = stack.pop();
      if (!(next instanceof Element) || seen.has(next)) continue;
      seen.add(next);
      out.push(next);
      const children = composedChildren(next);
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push(children[i]);
      }
    }
    return out;
  };

  const matchesTag = (element, step) => {
    if (step.tag === "*") return true;
    return element.localName === step.tag;
  };

  const steps = parseXPathSteps(rawXPath);
  if (!steps.length) return [];

  let current = [this];
  for (const step of steps) {
    const next = [];
    const seen = new Set();
    for (const root of current) {
      const pool = step.axis === "child" ? composedChildren(root) : composedDescendants(root);
      const tagMatches = pool.filter((candidate) => matchesTag(candidate, step));
      const matches = applyPredicates(tagMatches, step.predicates);
      for (const candidate of matches) {
        if (!seen.has(candidate)) {
          seen.add(candidate);
          next.push(candidate);
          if (next.length >= limit && step === steps[steps.length - 1]) {
            break;
          }
        }
      }
    }
    if (!next.length) return [];
    current = next;
  }

  return current.slice(0, limit);
}`;

const COUNT_XPATH_WITH_ROOTS_DECLARATION = `function(rawXPath, ...rootPairs) {
  const matches = (${QUERY_XPATH_WITH_ROOTS_DECLARATION}).call(this, rawXPath, Number.MAX_SAFE_INTEGER, ...rootPairs);
  return matches.length;
}`;

const QUERY_XPATH_NATIVE_DECLARATION = `function(rawXPath, limit) {
  const xpath = String(rawXPath || "").trim().replace(/^xpath=/i, "").trim();
  if (!xpath || !Number.isFinite(limit) || limit <= 0) return [];
  try {
    const snapshot = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const matches = [];
    const max = Math.min(snapshot.snapshotLength, Math.floor(limit));
    for (let i = 0; i < max; i += 1) {
      const node = snapshot.snapshotItem(i);
      if (node instanceof Element) matches.push(node);
    }
    return matches;
  } catch {
    return [];
  }
}`;

const COUNT_XPATH_NATIVE_DECLARATION = `function(rawXPath) {
  const xpath = String(rawXPath || "").trim().replace(/^xpath=/i, "").trim();
  if (!xpath) return 0;
  try {
    const snapshot = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    return snapshot.snapshotLength;
  } catch {
    return 0;
  }
}`;

const HAS_OPEN_SHADOW_ROOTS_DECLARATION = `function() {
  try {
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node instanceof Element && node.shadowRoot) return true;
    }
  } catch {
    return false;
  }
  return false;
}`;

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
      QUERY_CSS_WITH_ROOTS_DECLARATION,
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
      QUERY_TEXT_WITH_ROOTS_DECLARATION,
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
    return this.countAcrossRoots(COUNT_CSS_WITH_ROOTS_DECLARATION, selector);
  }

  private async countText(value: string): Promise<number> {
    return this.countAcrossRoots(COUNT_TEXT_WITH_ROOTS_DECLARATION, value);
  }

  private async countXPath(value: string): Promise<number> {
    return this.countXPathMatches(value);
  }

  private async queryXPath(
    query: string,
    limit: number,
  ): Promise<Protocol.Runtime.RemoteObjectId[]> {
    if (limit <= 0) return [];

    const bundle = await collectClosedShadowRoots(this.frame);
    const hasOpenShadowRoots = await this.hasOpenShadowRoots(
      bundle.documentObjectId,
    );
    const shouldUseComposed = bundle.roots.length > 0 || hasOpenShadowRoots;

    const pairArgs = bundle.roots.flatMap((pair) => [
      { objectId: pair.hostObjectId },
      { objectId: pair.rootObjectId },
    ]);

    let resultArrayId: Protocol.Runtime.RemoteObjectId | undefined;
    try {
      const called =
        await this.frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
          "Runtime.callFunctionOn",
          {
            objectId: bundle.documentObjectId,
            functionDeclaration: shouldUseComposed
              ? QUERY_XPATH_WITH_ROOTS_DECLARATION
              : QUERY_XPATH_NATIVE_DECLARATION,
            arguments: shouldUseComposed
              ? [{ value: query }, { value: limit }, ...pairArgs]
              : [{ value: query }, { value: limit }],
            returnByValue: false,
            awaitPromise: true,
          },
        );
      resultArrayId = called.result.objectId;
      if (!resultArrayId) return [];
      return this.getArrayElementObjectIds(resultArrayId);
    } finally {
      await releaseRemoteObject(this.frame, resultArrayId);
      await this.releaseClosedRootBundle(bundle);
    }
  }

  private async countXPathMatches(query: string): Promise<number> {
    const bundle = await collectClosedShadowRoots(this.frame);
    const hasOpenShadowRoots = await this.hasOpenShadowRoots(
      bundle.documentObjectId,
    );
    const shouldUseComposed = bundle.roots.length > 0 || hasOpenShadowRoots;
    const pairArgs = bundle.roots.flatMap((pair) => [
      { objectId: pair.hostObjectId },
      { objectId: pair.rootObjectId },
    ]);

    try {
      const called =
        await this.frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
          "Runtime.callFunctionOn",
          {
            objectId: bundle.documentObjectId,
            functionDeclaration: shouldUseComposed
              ? COUNT_XPATH_WITH_ROOTS_DECLARATION
              : COUNT_XPATH_NATIVE_DECLARATION,
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
      await this.releaseClosedRootBundle(bundle);
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
            functionDeclaration: HAS_OPEN_SHADOW_ROOTS_DECLARATION,
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

    const bundle = await collectClosedShadowRoots(this.frame);
    const pairArgs = bundle.roots.flatMap((pair) => [
      { objectId: pair.hostObjectId },
      { objectId: pair.rootObjectId },
    ]);

    let resultArrayId: Protocol.Runtime.RemoteObjectId | undefined;
    try {
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
      return this.getArrayElementObjectIds(resultArrayId);
    } finally {
      await releaseRemoteObject(this.frame, resultArrayId);
      await releaseRemoteObject(this.frame, bundle.documentObjectId);
      for (const pair of bundle.roots) {
        await releaseRemoteObject(this.frame, pair.hostObjectId);
        await releaseRemoteObject(this.frame, pair.rootObjectId);
      }
    }
  }

  private async countAcrossRoots(
    functionDeclaration: string,
    query: string,
  ): Promise<number> {
    const bundle = await collectClosedShadowRoots(this.frame);
    const pairArgs = bundle.roots.flatMap((pair) => [
      { objectId: pair.hostObjectId },
      { objectId: pair.rootObjectId },
    ]);

    try {
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
      await releaseRemoteObject(this.frame, bundle.documentObjectId);
      for (const pair of bundle.roots) {
        await releaseRemoteObject(this.frame, pair.hostObjectId);
        await releaseRemoteObject(this.frame, pair.rootObjectId);
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
