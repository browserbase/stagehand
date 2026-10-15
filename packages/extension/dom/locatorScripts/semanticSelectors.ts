import type { QueryStep, TextPattern } from "../../types/private/semanticLocator.js";
import {
  beginAriaCaches,
  endAriaCaches,
  getAriaChecked,
  getAriaDisabled,
  getAriaExpanded,
  getAriaLevel,
  getAriaPressed,
  getAriaRole,
  getAriaSelected,
  getElementAccessibleDescription,
  getElementAccessibleNameText,
  isElementHiddenForAria,
  kAriaCheckedRoles,
  kAriaExpandedRoles,
  kAriaLevelRoles,
  kAriaPressedRoles,
  kAriaSelectedRoles,
} from "./vendor/playwright/roleUtils.js";
import {
  elementMatchesText,
  matchesAttributePart,
  type ElementText,
  type TextMatcher,
} from "./vendor/playwright/selectorUtils.js";
import { normalizeWhiteSpace } from "./vendor/playwright/stringUtils.js";
import type { AttributeSelectorPart } from "./vendor/playwright/types.js";
import { queryLegacyCssSelector, queryLegacyTextSelector } from "./selectors.js";
import { queryXPathMatches } from "./xpathResolver.js";

type SelectorRoot = Document | Element | ShadowRoot;
type RoleStep = Extract<QueryStep, { kind: "role" }>;
type TextStep = Extract<QueryStep, { kind: "text" }>;

export interface SemanticQueryOptions {
  pierceShadow?: boolean;
}

/** Resolve a locator afresh, keeping all DOM/ARIA caches inside this synchronous query. */
export function querySemanticSelector(
  steps: readonly QueryStep[],
  root: SelectorRoot = document,
  { pierceShadow = true }: SemanticQueryOptions = {},
): Element[] {
  let roots: SelectorRoot[] = [root];
  const textCache = new Map<Element | ShadowRoot, ElementText>();
  beginAriaCaches();
  try {
    for (const [stepIndex, step] of steps.entries()) {
      if (step.kind === "nth") {
        roots = roots[step.index] ? [roots[step.index]] : [];
        continue;
      }

      const query =
        step.kind === "role"
          ? roleQuery(step, pierceShadow)
          : step.kind === "text"
            ? textQuery(step, textCache, pierceShadow)
            : (scope: SelectorRoot) =>
                selectorQuery(step.selector, scope, pierceShadow, stepIndex === 0);
      const matches = new Set<Element>();
      for (const scope of roots) {
        for (const element of query(scope)) matches.add(element);
      }
      roots = [...matches];
    }
    return roots.filter((node): node is Element => node instanceof Element);
  } finally {
    endAriaCaches();
  }
}

export function resolveSemanticSelector(
  steps: readonly QueryStep[],
  index = 0,
  options?: SemanticQueryOptions,
): Element | null {
  return querySemanticSelector(steps, document, options)[index] ?? null;
}

export function countSemanticMatches(
  steps: readonly QueryStep[],
  options?: SemanticQueryOptions,
): number {
  return querySemanticSelector(steps, document, options).length;
}

function roleQuery(step: RoleStep, pierceShadow: boolean) {
  const { role, options = {} } = step;
  const supportedStates = [
    ["checked", kAriaCheckedRoles],
    ["pressed", kAriaPressedRoles],
    ["selected", kAriaSelectedRoles],
    ["expanded", kAriaExpandedRoles],
    ["level", kAriaLevelRoles],
  ] as const;
  for (const [state, roles] of supportedStates) {
    if (options[state] !== undefined && !roles.includes(role)) {
      throw new Error(
        `"${state}" attribute is only supported for roles: ${roles
          .slice()
          .sort()
          .map((value) => `"${value}"`)
          .join(", ")}`,
      );
    }
  }
  const nameMatcher =
    options.name === undefined ? undefined : accessibleTextMatcher(options.name, !!options.exact);
  const descriptionMatcher =
    options.description === undefined
      ? undefined
      : accessibleTextMatcher(options.description, !!options.exact);

  return (scope: SelectorRoot): Element[] =>
    queryElements(scope, "*", pierceShadow).filter((element) => {
      if (getAriaRole(element) !== role) return false;
      if (options.checked !== undefined && getAriaChecked(element) !== options.checked)
        return false;
      if (options.pressed !== undefined && getAriaPressed(element) !== options.pressed)
        return false;
      if (options.selected !== undefined && getAriaSelected(element) !== options.selected)
        return false;
      if (options.expanded !== undefined && getAriaExpanded(element) !== options.expanded)
        return false;
      if (options.level !== undefined && getAriaLevel(element) !== options.level) return false;
      if (options.disabled !== undefined && getAriaDisabled(element) !== options.disabled)
        return false;
      if (!options.includeHidden && isElementHiddenForAria(element)) return false;
      if (
        nameMatcher &&
        !nameMatcher(
          normalizeWhiteSpace(getElementAccessibleNameText(element, !!options.includeHidden)),
        )
      )
        return false;
      return (
        !descriptionMatcher ||
        descriptionMatcher(
          normalizeWhiteSpace(
            getElementAccessibleDescription(element, !!options.includeHidden).text,
          ),
        )
      );
    });
}

function accessibleTextMatcher(pattern: TextPattern, exact: boolean) {
  const attribute: AttributeSelectorPart = {
    name: "",
    jsonPath: [],
    op: typeof pattern === "string" && !exact ? "*=" : "=",
    value:
      typeof pattern === "string"
        ? normalizeWhiteSpace(pattern)
        : new RegExp(pattern.source, pattern.flags),
    caseSensitive: typeof pattern !== "string" || exact,
  };
  return (value: string) => matchesAttributePart(value, attribute);
}

function textQuery(
  { text, exact }: TextStep,
  cache: Map<Element | ShadowRoot, ElementText>,
  pierceShadow: boolean,
) {
  let matcher: TextMatcher;
  if (typeof text !== "string") {
    const regex = new RegExp(text.source, text.flags);
    matcher = ({ full }) => {
      regex.lastIndex = 0;
      return regex.test(full);
    };
  } else {
    const expected = normalizeWhiteSpace(text);
    matcher = exact
      ? ({ normalized }) => normalized === expected
      : ({ normalized }) => normalized.toLowerCase().includes(expected.toLowerCase());
  }
  return (scope: SelectorRoot): Element[] => {
    const candidates = queryElements(scope, "*", pierceShadow);
    if (scope instanceof Element) candidates.unshift(scope);
    return candidates.filter((element) => elementMatchesText(cache, element, matcher) === "self");
  };
}

/** Match light DOM before open shadow roots, preserving Playwright's query order. */
function queryElements(scope: SelectorRoot, selector: string, pierceShadow: boolean): Element[] {
  const result = [...scope.querySelectorAll(selector)];
  if (!pierceShadow) return result;
  const shadows: ShadowRoot[] = [];
  if (scope instanceof Element && scope.shadowRoot) shadows.push(scope.shadowRoot);
  for (const element of scope.querySelectorAll("*")) {
    if (element.shadowRoot) shadows.push(element.shadowRoot);
  }
  for (const shadow of shadows) result.push(...queryElements(shadow, selector, true));
  return result;
}

function selectorQuery(
  raw: string,
  scope: SelectorRoot,
  pierceShadow: boolean,
  initial: boolean,
): Element[] {
  const selector = raw.trim();
  if (/^text=/i.test(selector)) {
    if (!initial || !(scope instanceof Document)) {
      throw new Error("Nested text= selectors are not supported; use getByText() instead");
    }
    let text = selector.replace(/^text=/i, "").trim();
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      text = text.slice(1, -1);
    }
    return queryLegacyTextSelector(text, { pierceShadow });
  }
  const isXPath = /^xpath=/i.test(selector) || /^(?:\(|\.\/|\/)/.test(selector);
  if (initial && scope instanceof Document) {
    return isXPath
      ? queryXPathMatches(selector, { pierceShadow })
      : queryLegacyCssSelector(selector.replace(/^css=/i, ""), { pierceShadow });
  }
  if (!isXPath) {
    return queryElements(scope, selector.replace(/^css=/i, ""), pierceShadow);
  }

  let expression = selector.replace(/^xpath=/i, "");
  if (scope instanceof Element && expression.startsWith("/")) expression = "." + expression;
  const owner = scope instanceof Document ? scope : scope.ownerDocument;
  const iterator = owner.evaluate(expression, scope, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE);
  const result: Element[] = [];
  let node: Node | null;
  while ((node = iterator.iterateNext())) {
    if (node instanceof Element) result.push(node);
  }
  return result;
}
