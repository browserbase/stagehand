function buildClosedRootsMap(rootPairs: unknown[]): Map<Element, ShadowRoot> {
  const closedRoots = new Map<Element, ShadowRoot>();
  for (let i = 0; i < rootPairs.length; i += 2) {
    const host = rootPairs[i];
    const root = rootPairs[i + 1];
    if (host instanceof Element && root instanceof ShadowRoot) {
      closedRoots.set(host, root);
    }
  }
  return closedRoots;
}

function composedChildren(
  node: unknown,
  closedRoots: Map<Element, ShadowRoot>,
): Element[] {
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
}

function composedDescendants(
  node: unknown,
  closedRoots: Map<Element, ShadowRoot>,
): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  const stack = [...composedChildren(node, closedRoots)].reverse();

  while (stack.length) {
    const next = stack.pop();
    if (!(next instanceof Element) || seen.has(next)) continue;
    seen.add(next);
    out.push(next);

    const children = composedChildren(next, closedRoots);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]!);
    }
  }

  return out;
}

export function queryCssWithRoots(
  this: Document,
  selector: string,
  limit: number,
  ...rootPairs: unknown[]
): Element[] {
  const closedRoots = buildClosedRootsMap(rootPairs);
  const results: Element[] = [];
  const seen = new Set<Element>();
  const stack = [...composedChildren(this, closedRoots)].reverse();

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

    const children = composedChildren(next, closedRoots);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]!);
    }
  }

  return results;
}

export function countCssWithRoots(
  this: Document,
  selector: string,
  ...rootPairs: unknown[]
): number {
  return queryCssWithRoots.call(
    this,
    selector,
    Number.MAX_SAFE_INTEGER,
    ...rootPairs,
  ).length;
}

export function queryTextWithRoots(
  this: Document,
  needle: string,
  limit: number,
  ...rootPairs: unknown[]
): Element[] {
  const closedRoots = buildClosedRootsMap(rootPairs);
  const skipTags = new Set([
    "SCRIPT",
    "STYLE",
    "TEMPLATE",
    "NOSCRIPT",
    "HEAD",
    "TITLE",
    "LINK",
    "META",
    "HTML",
    "BODY",
  ]);
  const query = String(needle || "").toLowerCase();
  if (!query) return [];

  const extractText = (element: Element): string => {
    const tag = element.tagName ? element.tagName.toUpperCase() : "";
    if (skipTags.has(tag)) return "";
    try {
      const inner = (element as HTMLElement).innerText;
      if (typeof inner === "string" && inner.trim()) return inner.trim();
    } catch {
      // ignore
    }
    const text = element.textContent;
    return typeof text === "string" ? text.trim() : "";
  };

  const matches: Element[] = [];
  const seen = new Set<Element>();
  const stack = [...composedChildren(this, closedRoots)].reverse();

  while (stack.length) {
    const next = stack.pop();
    if (!(next instanceof Element) || seen.has(next)) continue;
    seen.add(next);

    const text = extractText(next);
    if (text && text.toLowerCase().includes(query)) {
      matches.push(next);
    }

    const children = composedChildren(next, closedRoots);
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i]!);
    }
  }

  const filtered: Element[] = [];
  for (const candidate of matches) {
    let covered = false;
    for (const other of matches) {
      if (candidate === other) continue;
      try {
        if (candidate.contains(other)) {
          covered = true;
          break;
        }
      } catch {
        // ignore
      }
    }
    if (!covered) {
      filtered.push(candidate);
      if (filtered.length >= limit) break;
    }
  }

  return filtered;
}

export function countTextWithRoots(
  this: Document,
  needle: string,
  ...rootPairs: unknown[]
): number {
  return queryTextWithRoots.call(
    this,
    needle,
    Number.MAX_SAFE_INTEGER,
    ...rootPairs,
  ).length;
}

type XPathPredicate =
  | { type: "index"; index: number }
  | { type: "attrEquals"; name: string; value: string; normalize?: boolean }
  | { type: "attrExists"; name: string }
  | { type: "attrContains"; name: string; value: string; normalize?: boolean }
  | {
      type: "attrStartsWith";
      name: string;
      value: string;
      normalize?: boolean;
    }
  | { type: "textEquals"; value: string; normalize?: boolean }
  | { type: "textContains"; value: string; normalize?: boolean }
  | { type: "and"; predicates: XPathPredicate[] }
  | { type: "or"; predicates: XPathPredicate[] }
  | { type: "not"; predicate: XPathPredicate };

type XPathStep = {
  axis: "child" | "desc";
  tag: string;
  predicates: XPathPredicate[];
};

function normalizeXPath(selector: string): string {
  const raw = String(selector || "").trim();
  if (!raw) return "";
  return raw.replace(/^xpath=/i, "").trim();
}

function extractPredicates(str: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] !== "[") {
      i += 1;
      continue;
    }
    i += 1;
    const start = i;
    let quote: string | null = null;
    while (i < str.length) {
      const ch = str[i]!;
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
}

function isBoundary(ch: string): boolean {
  return !/[a-zA-Z0-9_.-]/.test(ch);
}

function isKeywordAt(input: string, index: number, keyword: string): boolean {
  if (!input.startsWith(keyword, index)) return false;
  const before = index > 0 ? input[index - 1]! : " ";
  if (before === "@") return false;
  const after =
    index + keyword.length < input.length
      ? input[index + keyword.length]!
      : " ";
  return isBoundary(before) && isBoundary(after);
}

function splitTopLevel(input: string, keyword: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;
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
}

function hasBalancedParens(input: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
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
}

function unwrapFunctionCall(input: string, name: string): string | null {
  const prefix = `${name}(`;
  if (!input.startsWith(prefix) || !input.endsWith(")")) return null;
  const inner = input.slice(prefix.length, -1);
  return hasBalancedParens(inner) ? inner : null;
}

function parseAtomicPredicate(input: string): XPathPredicate | null {
  const attrName = "[a-zA-Z_][\\w.-]*";
  const quoted = `(?:'([^']*)'|"([^"]*)")`;

  if (/^\d+$/.test(input)) {
    return { type: "index", index: Math.max(1, Number(input)) };
  }

  const normalizeAttrMatch = input.match(
    new RegExp(
      `^normalize-space\\(\\s*@(${attrName})\\s*\\)\\s*=\\s*${quoted}$`,
    ),
  );
  if (normalizeAttrMatch) {
    return {
      type: "attrEquals",
      name: normalizeAttrMatch[1]!,
      value: normalizeAttrMatch[2] ?? normalizeAttrMatch[3] ?? "",
      normalize: true,
    };
  }

  const normalizeTextMatch = input.match(
    new RegExp(
      `^normalize-space\\(\\s*(?:text\\(\\)|\\.)\\s*\\)\\s*=\\s*${quoted}$`,
    ),
  );
  if (normalizeTextMatch) {
    return {
      type: "textEquals",
      value: normalizeTextMatch[1] ?? normalizeTextMatch[2] ?? "",
      normalize: true,
    };
  }

  const attrEqualsMatch = input.match(
    new RegExp(`^@(${attrName})\\s*=\\s*${quoted}$`),
  );
  if (attrEqualsMatch) {
    return {
      type: "attrEquals",
      name: attrEqualsMatch[1]!,
      value: attrEqualsMatch[2] ?? attrEqualsMatch[3] ?? "",
    };
  }

  const attrExistsMatch = input.match(new RegExp(`^@(${attrName})$`));
  if (attrExistsMatch) {
    return { type: "attrExists", name: attrExistsMatch[1]! };
  }

  const attrContainsMatch = input.match(
    new RegExp(`^contains\\(\\s*@(${attrName})\\s*,\\s*${quoted}\\s*\\)$`),
  );
  if (attrContainsMatch) {
    return {
      type: "attrContains",
      name: attrContainsMatch[1]!,
      value: attrContainsMatch[2] ?? attrContainsMatch[3] ?? "",
    };
  }

  const attrStartsMatch = input.match(
    new RegExp(`^starts-with\\(\\s*@(${attrName})\\s*,\\s*${quoted}\\s*\\)$`),
  );
  if (attrStartsMatch) {
    return {
      type: "attrStartsWith",
      name: attrStartsMatch[1]!,
      value: attrStartsMatch[2] ?? attrStartsMatch[3] ?? "",
    };
  }

  const textEqualsMatch = input.match(
    new RegExp(`^(?:text\\(\\)|\\.)\\s*=\\s*${quoted}$`),
  );
  if (textEqualsMatch) {
    return {
      type: "textEquals",
      value: textEqualsMatch[1] ?? textEqualsMatch[2] ?? "",
    };
  }

  const textContainsMatch = input.match(
    new RegExp(`^contains\\(\\s*(?:text\\(\\)|\\.)\\s*,\\s*${quoted}\\s*\\)$`),
  );
  if (textContainsMatch) {
    return {
      type: "textContains",
      value: textContainsMatch[1] ?? textContainsMatch[2] ?? "",
    };
  }

  return null;
}

function parsePredicateExpression(input: string): XPathPredicate | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const orParts = splitTopLevel(trimmed, "or");
  if (orParts.length > 1) {
    const preds = orParts
      .map((part) => parsePredicateExpression(part))
      .filter(Boolean) as XPathPredicate[];
    if (preds.length !== orParts.length) return null;
    return { type: "or", predicates: preds };
  }

  const andParts = splitTopLevel(trimmed, "and");
  if (andParts.length > 1) {
    const preds = andParts
      .map((part) => parsePredicateExpression(part))
      .filter(Boolean) as XPathPredicate[];
    if (preds.length !== andParts.length) return null;
    return { type: "and", predicates: preds };
  }

  const notInner = unwrapFunctionCall(trimmed, "not");
  if (notInner != null) {
    const predicate = parsePredicateExpression(notInner);
    return predicate ? { type: "not", predicate } : null;
  }

  return parseAtomicPredicate(trimmed);
}

function parseXPathSteps(input: string): XPathStep[] {
  const path = normalizeXPath(input);
  if (!path) return [];

  const steps: XPathStep[] = [];
  let i = 0;
  while (i < path.length) {
    let axis: "child" | "desc" = "child";
    if (path.startsWith("//", i)) {
      axis = "desc";
      i += 2;
    } else if (path[i] === "/") {
      axis = "child";
      i += 1;
    }

    const start = i;
    let bracketDepth = 0;
    let quote: string | null = null;
    while (i < path.length) {
      const ch = path[i]!;
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

    const bracketPos = rawStep.indexOf("[");
    if (bracketPos === -1) {
      steps.push({
        axis,
        tag: rawStep === "" ? "*" : rawStep.toLowerCase(),
        predicates: [],
      });
      continue;
    }

    const tagPart = rawStep.slice(0, bracketPos).trim();
    const predicateStr = rawStep.slice(bracketPos);
    const predicates: XPathPredicate[] = [];
    for (const inner of extractPredicates(predicateStr)) {
      const parsed = parsePredicateExpression(inner);
      if (parsed) predicates.push(parsed);
    }
    steps.push({
      axis,
      tag: tagPart === "" ? "*" : tagPart.toLowerCase(),
      predicates,
    });
  }

  return steps;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMaybe(value: string, normalize?: boolean): string {
  return normalize ? normalizeSpace(value) : value;
}

function textValue(element: Element): string {
  return String(element.textContent ?? "");
}

function evaluatePredicate(
  element: Element,
  predicate: XPathPredicate,
): boolean {
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
      return (
        normalizeMaybe(attr, predicate.normalize) ===
        normalizeMaybe(predicate.value, predicate.normalize)
      );
    }
    case "attrContains": {
      const attr = element.getAttribute(predicate.name);
      if (attr === null) return false;
      return normalizeMaybe(attr, predicate.normalize).includes(
        normalizeMaybe(predicate.value, predicate.normalize),
      );
    }
    case "attrStartsWith": {
      const attr = element.getAttribute(predicate.name);
      if (attr === null) return false;
      return normalizeMaybe(attr, predicate.normalize).startsWith(
        normalizeMaybe(predicate.value, predicate.normalize),
      );
    }
    case "textEquals":
      return (
        normalizeMaybe(textValue(element), predicate.normalize) ===
        normalizeMaybe(predicate.value, predicate.normalize)
      );
    case "textContains":
      return normalizeMaybe(textValue(element), predicate.normalize).includes(
        normalizeMaybe(predicate.value, predicate.normalize),
      );
    case "index":
      return true;
    default:
      return true;
  }
}

function applyPredicates(
  elements: Element[],
  predicates: XPathPredicate[],
): Element[] {
  let current = elements;
  for (const predicate of predicates) {
    if (!current.length) return [];

    if (predicate.type === "index") {
      const idx = predicate.index - 1;
      current = idx >= 0 && idx < current.length ? [current[idx]!] : [];
      continue;
    }

    current = current.filter((el) => evaluatePredicate(el, predicate));
  }
  return current;
}

function matchesTag(element: Element, step: XPathStep): boolean {
  if (step.tag === "*") return true;
  return element.localName === step.tag;
}

export function queryXPathWithRoots(
  this: Document,
  rawXPath: string,
  limit: number,
  ...rootPairs: unknown[]
): Element[] {
  const closedRoots = buildClosedRootsMap(rootPairs);
  const steps = parseXPathSteps(rawXPath);
  if (!steps.length) return [];

  let current: Array<Document | Element | ShadowRoot | DocumentFragment> = [
    this,
  ];

  for (const step of steps) {
    const next: Element[] = [];
    const seen = new Set<Element>();

    for (const root of current) {
      const pool =
        step.axis === "child"
          ? composedChildren(root, closedRoots)
          : composedDescendants(root, closedRoots);
      const tagMatches = pool.filter((candidate) =>
        matchesTag(candidate, step),
      );
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

  return current.slice(0, limit) as Element[];
}

export function countXPathWithRoots(
  this: Document,
  rawXPath: string,
  ...rootPairs: unknown[]
): number {
  return queryXPathWithRoots.call(
    this,
    rawXPath,
    Number.MAX_SAFE_INTEGER,
    ...rootPairs,
  ).length;
}

export function queryXPathNative(
  this: Document,
  rawXPath: string,
  limit: number,
): Element[] {
  const xpath = normalizeXPath(rawXPath);
  if (!xpath || !Number.isFinite(limit) || limit <= 0) return [];
  try {
    const snapshot = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const matches: Element[] = [];
    const max = Math.min(snapshot.snapshotLength, Math.floor(limit));
    for (let i = 0; i < max; i += 1) {
      const node = snapshot.snapshotItem(i);
      if (node instanceof Element) matches.push(node);
    }
    return matches;
  } catch {
    return [];
  }
}

export function countXPathNative(this: Document, rawXPath: string): number {
  const xpath = normalizeXPath(rawXPath);
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
}

export function hasOpenShadowRoots(this: Document): boolean {
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
}
