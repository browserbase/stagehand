export type XPathPredicate =
  | { type: "index"; index: number }
  | { type: "attrEquals"; name: string; value: string; normalize?: boolean }
  | { type: "attrExists"; name: string }
  | {
      type: "attrContains";
      name: string;
      value: string;
      normalize?: boolean;
    }
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

export interface XPathStep {
  axis: "child" | "desc";
  tag: string;
  predicates: XPathPredicate[];
}

/**
 * Parse an XPath expression into a list of traversal steps.
 *
 * This is a subset parser designed for composed DOM traversal (including
 * shadow roots). It intentionally does not implement the full XPath spec.
 *
 * Supported:
 *  - Child (`/`) and descendant (`//`) axes
 *  - Tag names and wildcard (`*`)
 *  - Positional indices (`[n]`)
 *  - Attribute equality predicates (`[@attr='value']`, `[@attr="value"]`)
 *  - Attribute existence (`[@attr]`)
 *  - Attribute contains/starts-with (`contains(@attr,'v')`, `starts-with(@attr,'v')`)
 *  - Text equality/contains (`[text()='v']`, `[contains(text(),'v')]`, `[.='v']`)
 *  - normalize-space on text/attributes (`[normalize-space(text())='v']`)
 *  - Basic boolean predicates (`and`, `or`, `not(...)`)
 *  - Multiple predicates per step (`[@class='foo'][2]`)
 *  - Optional `xpath=` prefix
 *
 * Not supported:
 *  - Position functions (`[position() > n]`, `[last()]`)
 *  - Axes beyond child/descendant (`ancestor::`, `parent::`, `self::`,
 *    `preceding-sibling::`, `following-sibling::`)
 *  - Union operator (`|`)
 *  - Grouped expressions (`(//div)[n]`)
 *
 * Unsupported predicates are silently ignored — the step still matches
 * by tag name, but the unrecognized predicate has no filtering effect.
 */
export function parseXPathSteps(input: string): XPathStep[] {
  const path = String(input || "")
    .trim()
    .replace(/^xpath=/i, "");
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
      const ch = path[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
      } else if (ch === "[") {
        bracketDepth++;
      } else if (ch === "]") {
        bracketDepth--;
      } else if (ch === "/" && bracketDepth === 0) {
        break;
      }
      i += 1;
    }
    const rawStep = path.slice(start, i).trim();
    if (!rawStep) continue;

    const { tag, predicates } = parseStep(rawStep);
    steps.push({ axis, tag, predicates });
  }

  return steps;
}

/**
 * Extract predicate contents from a string like `[@attr='val'][2]`.
 * Handles `]` inside quoted attribute values (e.g. `[@title='a[0]']`).
 */
function extractPredicates(str: string): string[] {
  const results: string[] = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] !== "[") {
      i++;
      continue;
    }
    i++; // skip opening [
    const start = i;
    let quote: string | null = null;
    while (i < str.length) {
      const ch = str[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === "'" || ch === '"') {
        quote = ch;
      } else if (ch === "]") {
        break;
      }
      i++;
    }
    results.push(str.slice(start, i).trim());
    i++; // skip closing ]
  }
  return results;
}

function parseStep(raw: string): {
  tag: string;
  predicates: XPathPredicate[];
} {
  const bracketPos = raw.indexOf("[");
  if (bracketPos === -1) {
    const tag = raw === "" ? "*" : raw.toLowerCase();
    return { tag, predicates: [] };
  }

  const tagPart = raw.slice(0, bracketPos).trim();
  const tag = tagPart === "" ? "*" : tagPart.toLowerCase();
  const predicateStr = raw.slice(bracketPos);

  const predicates: XPathPredicate[] = [];

  for (const inner of extractPredicates(predicateStr)) {
    const parsed = parsePredicateExpression(inner);
    if (parsed) predicates.push(parsed);
  }

  return { tag, predicates };
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

function parseAtomicPredicate(input: string): XPathPredicate | null {
  const valueMatch = /^(?:'([^']*)'|"([^"]*)")$/;
  const attrName = "[a-zA-Z_][\\w.-]*";
  const quoted = "(?:'([^']*)'|\"([^\"]*)\")";

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
      name: normalizeAttrMatch[1],
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
      name: attrEqualsMatch[1],
      value: attrEqualsMatch[2] ?? attrEqualsMatch[3] ?? "",
    };
  }

  const attrExistsMatch = input.match(new RegExp(`^@(${attrName})$`));
  if (attrExistsMatch) {
    return { type: "attrExists", name: attrExistsMatch[1] };
  }

  const attrContainsMatch = input.match(
    new RegExp(`^contains\\(\\s*@(${attrName})\\s*,\\s*${quoted}\\s*\\)$`),
  );
  if (attrContainsMatch) {
    return {
      type: "attrContains",
      name: attrContainsMatch[1],
      value: attrContainsMatch[2] ?? attrContainsMatch[3] ?? "",
    };
  }

  const attrStartsMatch = input.match(
    new RegExp(`^starts-with\\(\\s*@(${attrName})\\s*,\\s*${quoted}\\s*\\)$`),
  );
  if (attrStartsMatch) {
    return {
      type: "attrStartsWith",
      name: attrStartsMatch[1],
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

  if (valueMatch.test(input)) {
    return null;
  }

  return null;
}

function splitTopLevel(input: string, keyword: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
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
}

function isKeywordAt(input: string, index: number, keyword: string): boolean {
  if (!input.startsWith(keyword, index)) return false;
  const before = index > 0 ? input[index - 1] : " ";
  if (before === "@") return false;
  const after =
    index + keyword.length < input.length ? input[index + keyword.length] : " ";
  return isBoundary(before) && isBoundary(after);
}

function isBoundary(ch: string): boolean {
  return !/[a-zA-Z0-9_.-]/.test(ch);
}

function unwrapFunctionCall(input: string, name: string): string | null {
  const prefix = `${name}(`;
  if (!input.startsWith(prefix) || !input.endsWith(")")) return null;
  const inner = input.slice(prefix.length, -1);
  return hasBalancedParens(inner) ? inner : null;
}

function hasBalancedParens(input: string): boolean {
  let depth = 0;
  let quote: string | null = null;
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
}

const normalizeSpace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

function textValue(element: Element): string {
  return String(element.textContent ?? "");
}

function normalizeMaybe(value: string, normalize?: boolean): string {
  return normalize ? normalizeSpace(value) : value;
}

export function evaluatePredicate(
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
    case "textEquals": {
      const value = normalizeMaybe(textValue(element), predicate.normalize);
      return value === normalizeMaybe(predicate.value, predicate.normalize);
    }
    case "textContains": {
      const value = normalizeMaybe(textValue(element), predicate.normalize);
      return value.includes(
        normalizeMaybe(predicate.value, predicate.normalize),
      );
    }
    case "index":
      return true;
    default:
      return true;
  }
}

export function applyPredicates(
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
