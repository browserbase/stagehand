type JsonMatcher =
  | { kind: "string"; value: string; exact: boolean }
  | { kind: "regexp"; source: string; flags: string };

type QueryStep =
  | { kind: "selector"; value: string }
  | { kind: "text"; matcher: JsonMatcher }
  | { kind: "attribute"; name: string; matcher: JsonMatcher }
  | { kind: "label"; matcher: JsonMatcher }
  | {
      kind: "role";
      role: string;
      name?: JsonMatcher;
      checked?: boolean;
      disabled?: boolean;
      selected?: boolean;
      expanded?: boolean;
      pressed?: boolean;
      includeHidden?: boolean;
      level?: number;
    }
  | {
      kind: "filter";
      hasText?: JsonMatcher;
      hasNotText?: JsonMatcher;
      has?: QueryStep[];
      hasNot?: QueryStep[];
      visible?: boolean;
    }
  | { kind: "nth"; index: number }
  /**
   * A `role` step that was resolved against the browser's accessibility tree.
   * `values` are document-relative XPaths for the nodes whose role and name
   * matched; the state filters are carried over from the original role step.
   */
  | {
      kind: "xpaths";
      values: string[];
      checked?: boolean;
      disabled?: boolean;
      selected?: boolean;
      expanded?: boolean;
      pressed?: boolean;
      level?: number;
    };

type RoleStep = Extract<QueryStep, { kind: "role" }>;

type RawLocator = {
  click(options?: { button?: "left" | "right" | "middle"; clickCount?: number }): Promise<void>;
  hover(): Promise<void>;
  fill(value: string): Promise<void>;
  type(text: string, options?: { delay?: number }): Promise<void>;
  selectOption(values: string | string[]): Promise<string[]>;
  setInputFiles(files: unknown): Promise<void>;
  count(): Promise<number>;
  nth(index: number): RawLocator;
  isVisible(): Promise<boolean>;
  isChecked(): Promise<boolean>;
  inputValue(): Promise<string>;
  innerText(): Promise<string>;
  innerHtml(): Promise<string>;
  textContent(): Promise<string>;
  scrollTo(percent: number): Promise<void>;
};

type CompatSelectOption =
  | string
  | { value?: string; label?: string; index?: number }
  | Array<string | { value?: string; label?: string; index?: number }>;

type RawPage = {
  readonly pageId?: string;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  reload(options?: Record<string, unknown>): Promise<unknown>;
  goBack(options?: Record<string, unknown>): Promise<unknown>;
  goForward(options?: Record<string, unknown>): Promise<unknown>;
  evaluate<Result = unknown, Arg = unknown>(
    expression: string | ((arg: Arg) => Result | Promise<Result>),
    arg?: Arg,
  ): Promise<Result>;
  screenshot(options?: Record<string, unknown>): Promise<Uint8Array>;
  setViewportSize(width: number, height: number): Promise<void>;
  waitForLoadState(state: string, timeout?: number): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<boolean>;
  url(): Promise<string>;
  title(): Promise<string>;
  close(): Promise<void>;
  locator(selector: string): RawLocator;
  type(text: string, options?: { delay?: number }): Promise<void>;
  keyPress(key: string, options?: { delay?: number }): Promise<void>;
  click(x: number, y: number, options?: Record<string, unknown>): Promise<void>;
  hover(x: number, y: number): Promise<void>;
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  addInitScript(script: string | ((arg: unknown) => unknown), arg?: unknown): Promise<void>;
  snapshot(options?: Record<string, unknown>): Promise<unknown>;
  on(
    event: "console" | "download" | "request" | "response" | "requestfailed",
    listener: (event: any) => unknown,
  ): Promise<{ unsubscribe(): Promise<void> }>;
  onCDP(
    method: string,
    listener: (event: any) => unknown,
  ): Promise<{ unsubscribe(): Promise<void> }>;
  sendCDP<Result = unknown>(method: string, params?: Record<string, unknown>): Promise<Result>;
};

type RawContext = {
  pages(): Promise<RawPage[]>;
  newPage(url?: string): Promise<RawPage>;
  setActivePage(page: RawPage): Promise<void>;
  cookies(urls?: string | string[]): Promise<unknown[]>;
  addCookies(cookies: unknown[]): Promise<void>;
  clearCookies(options?: Record<string, unknown>): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  addInitScript(script: string | ((arg: unknown) => unknown), arg?: unknown): Promise<void>;
  request?: {
    fetch(url: string, options?: Record<string, unknown>): Promise<unknown>;
    get(url: string, options?: Record<string, unknown>): Promise<unknown>;
    post(url: string, options?: Record<string, unknown>): Promise<unknown>;
  };
};

type BatchStagehandRuntime = { page: RawPage; context: RawContext };

export type PlaywrightCompatTelemetry = {
  calls: Record<string, number>;
  misses: Record<string, number>;
};

export type PlaywrightCompatRuntime = {
  page: unknown;
  context: unknown;
  browser: unknown;
  telemetry: () => PlaywrightCompatTelemetry;
  artifacts: () => Array<{ path: string; base64: string }>;
  closeRequested: () => boolean;
};

/**
 * Builds a Playwright-shaped facade entirely inside a Stagehand callback batch.
 * Keep this function self-contained: its source is serialized into the
 * extension service worker with Function#toString.
 */
export async function createPlaywrightCompatRuntime(
  stagehand: BatchStagehandRuntime,
): Promise<PlaywrightCompatRuntime> {
  type CompatStats = PlaywrightCompatTelemetry;
  type QueryResult = {
    count: number;
    value?: unknown;
    values?: unknown[];
    visible?: boolean;
    token?: string;
    handleKind?: "element" | "value";
    error?: { name: string; message: string; stack?: string };
  };

  const stats: CompatStats = { calls: {}, misses: {} };
  const record = (bucket: "calls" | "misses", method: string): void => {
    stats[bucket][method] = (stats[bucket][method] ?? 0) + 1;
  };

  const matcher = (value: unknown, exact = false): JsonMatcher =>
    value instanceof RegExp
      ? { kind: "regexp", source: value.source, flags: value.flags }
      : { kind: "string", value: String(value), exact };

  // ---------------------------------------------------------------------------
  // getByRole fallback through the accessibility tree.
  //
  // The in-page role matcher reimplements accessible-name computation and
  // disagrees with Chrome's on real sites (descendant aria-label / alt / svg
  // titles, labelledby across shadow roots, custom elements). When a plan that
  // contains a role step matches nothing in the DOM, resolve the role step
  // against `page.snapshot()` — the same accessibility tree the `snapshot`
  // tool shows the agent — and re-run the plan with those nodes' XPaths.
  // ---------------------------------------------------------------------------

  /** Playwright role → roles as they appear in Stagehand's formatted tree. */
  const ACCESSIBILITY_ROLE_ALIASES: Record<string, string[]> = {
    img: ["image", "img"],
    image: ["image", "img"],
    textbox: ["textbox", "searchbox"],
    cell: ["cell", "gridcell"],
    gridcell: ["gridcell", "cell"],
  };

  const ACCESSIBILITY_FALLBACK_CACHE_TTL_MS = 750;

  type AccessibilityTreeNode = { id: string; role: string; name: string };

  const parseAccessibilityTree = (formattedTree: string): AccessibilityTreeNode[] => {
    const nodes: AccessibilityTreeNode[] = [];
    for (const rawLine of formattedTree.split("\n")) {
      const line = rawLine.match(/^\s*\[([^\]]+)\]\s+(.*)$/u);
      if (!line) continue;
      let rest = line[2] ?? "";
      // Trailing state flags rendered by formatStateFlags.
      rest = rest.replace(/(?:\s\[(?:selected|checked)\])+$/u, "");
      const separator = rest.indexOf(": ");
      const roleToken = separator === -1 ? rest : rest.slice(0, separator);
      const name = separator === -1 ? "" : rest.slice(separator + 2);
      // "scrollable, html" style lines carry the role before the comma.
      const role = roleToken.split(",")[0]?.trim() ?? "";
      if (!role) continue;
      nodes.push({ id: line[1] ?? "", role, name });
    }
    return nodes;
  };

  const matchesAccessibleName = (value: string, expected: JsonMatcher): boolean => {
    const normalized = value.replace(/\s+/gu, " ").trim();
    if (expected.kind === "regexp") {
      return new RegExp(expected.source, expected.flags).test(normalized);
    }
    const target = expected.value.replace(/\s+/gu, " ").trim();
    return expected.exact
      ? normalized === target
      : normalized.toLocaleLowerCase().includes(target.toLocaleLowerCase());
  };

  const planHasRoleStep = (plan: QueryStep[]): boolean =>
    plan.some(
      (step) =>
        step.kind === "role" ||
        (step.kind === "filter" &&
          ((step.has && planHasRoleStep(step.has)) ||
            (step.hasNot && planHasRoleStep(step.hasNot)))),
    );

  const resolveRoleStepWithTree = (
    step: RoleStep,
    nodes: AccessibilityTreeNode[],
    xpathMap: Record<string, string>,
  ): QueryStep | null => {
    const roles = new Set(ACCESSIBILITY_ROLE_ALIASES[step.role] ?? [step.role]);
    const values = nodes
      .filter(
        (node) =>
          roles.has(node.role) && (!step.name || matchesAccessibleName(node.name, step.name)),
      )
      .map((node) => xpathMap[node.id])
      .filter((xpath): xpath is string => typeof xpath === "string" && xpath.length > 0);
    if (values.length === 0) return null;
    const { kind: _kind, role: _role, name: _name, includeHidden: _hidden, ...state } = step;
    return { kind: "xpaths", values, ...state };
  };

  /**
   * Returns a copy of `plan` whose top-level role steps are replaced by
   * accessibility-tree resolved XPath steps, or null when the tree has no
   * candidate for at least one of them (or no tree is available).
   */
  const resolvePlanWithAccessibilityTree = async (
    page: RawPage,
    plan: QueryStep[],
  ): Promise<QueryStep[] | null> => {
    if (typeof page.snapshot !== "function") {
      record("misses", "getByRole.accessibilityTree:snapshotUnavailable");
      return null;
    }
    let snapshot: unknown;
    try {
      snapshot = await page.snapshot({ includeIframes: false });
    } catch {
      record("misses", "getByRole.accessibilityTree:snapshotError");
      return null;
    }
    const tree = snapshot as { formattedTree?: unknown; xpathMap?: unknown } | null;
    if (
      !tree ||
      typeof tree.formattedTree !== "string" ||
      !tree.xpathMap ||
      typeof tree.xpathMap !== "object"
    ) {
      record("misses", "getByRole.accessibilityTree:noTree");
      return null;
    }
    const nodes = parseAccessibilityTree(tree.formattedTree);
    const xpathMap = tree.xpathMap as Record<string, string>;
    let replaced = false;
    const resolved: QueryStep[] = [];
    for (const step of plan) {
      if (step.kind !== "role") {
        resolved.push(step);
        continue;
      }
      const fallback = resolveRoleStepWithTree(step, nodes, xpathMap);
      if (!fallback) {
        record("misses", "getByRole.accessibilityTree:noCandidates");
        return null;
      }
      resolved.push(fallback);
      replaced = true;
    }
    return replaced ? resolved : null;
  };

  const unsupported = (surface: string, method: PropertyKey): never => {
    const name = `${surface}.${String(method)}`;
    record("misses", name);
    throw new Error(`Playwright compatibility facade does not implement ${name}`);
  };

  const guard = <Target extends object>(surface: string, target: Target): Target =>
    new Proxy(target, {
      get(current, property, receiver) {
        if (property === "then") return undefined;
        if (Reflect.has(current, property)) return Reflect.get(current, property, receiver);
        return (..._args: unknown[]) => unsupported(surface, property);
      },
    });

  // This function is serialized independently by Stagehand page.evaluate, so
  // every query helper must remain nested inside it rather than closing over
  // the callback-batch scope.
  async function executeQueryInPage(input: {
    plan?: QueryStep[];
    operation:
      | "inspect"
      | "describe"
      | "tag"
      | "tagAll"
      | "untag"
      | "textContent"
      | "innerText"
      | "innerHTML"
      | "inputValue"
      | "isChecked"
      | "isDisabled"
      | "isEnabled"
      | "getAttribute"
      | "boundingBox"
      | "focus"
      | "blur"
      | "selectText"
      | "domClick"
      | "scrollIntoView"
      | "allTextContents"
      | "allInnerTexts"
      | "evaluate"
      | "evaluateAll"
      | "pageContent"
      | "pageEvaluateHandle"
      | "elementEvaluateHandle";
    token?: string;
    attribute?: string;
    functionSource?: string;
    argument?: unknown;
  }): Promise<QueryResult> {
    type QueryRoot = Document | Element | ShadowRoot;

    const normalize = (value: string): string => value.replace(/\s+/gu, " ").trim();
    const matches = (value: string, expected: JsonMatcher): boolean => {
      const normalized = normalize(value);
      if (expected.kind === "regexp") {
        return new RegExp(expected.source, expected.flags).test(normalized);
      }
      const target = normalize(expected.value);
      return expected.exact
        ? normalized === target
        : normalized.toLocaleLowerCase().includes(target.toLocaleLowerCase());
    };
    const visible = (element: Element): boolean => {
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") return false;
      const rect = element.getBoundingClientRect?.();
      return Boolean(rect && rect.width > 0 && rect.height > 0);
    };
    const dedupe = (elements: Element[]): Element[] => {
      const seen = new Set<Element>();
      return elements.filter((element) => {
        if (seen.has(element)) return false;
        seen.add(element);
        return true;
      });
    };
    const queryCssDeep = (root: QueryRoot, selector: string): Element[] => {
      const direct = [...root.querySelectorAll(selector)];
      const ownShadow =
        root instanceof Element && root.shadowRoot ? queryCssDeep(root.shadowRoot, selector) : [];
      const nested = [...root.querySelectorAll("*")].flatMap((element) =>
        element.shadowRoot ? queryCssDeep(element.shadowRoot, selector) : [],
      );
      return dedupe([...direct, ...ownShadow, ...nested]);
    };
    const smallestTextMatches = (elements: Element[], expected: JsonMatcher): Element[] =>
      elements.filter(
        (element) =>
          matches(element.textContent ?? "", expected) &&
          ![...element.children].some((child) => matches(child.textContent ?? "", expected)),
      );
    const queryXPath = (root: QueryRoot, expression: string): Element[] => {
      const documentNode = root instanceof Document ? root : root.ownerDocument;
      const result = documentNode.evaluate(
        expression,
        root,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null,
      );
      const elements: Element[] = [];
      for (let index = 0; index < result.snapshotLength; index += 1) {
        const node = result.snapshotItem(index);
        if (node instanceof Element) elements.push(node);
      }
      return elements;
    };
    /**
     * Resolve an XPath produced by Stagehand's accessibility snapshot. Those
     * paths are positional (`/html[1]/body[1]/x-host[1]//div[2]/button[1]`)
     * and encode a shadow-root boundary as `//`, which native
     * `document.evaluate` cannot follow. Mirrors the extension's
     * resolveStagehandShadowHopMatches: child steps walk light-DOM children,
     * a `//` step after the first walks into the host's (open) shadow root.
     */
    const resolveStagehandXPath = (expression: string): Element[] => {
      const path = expression.trim().replace(/^xpath=/iu, "");
      if (!path) return [];
      type Step = { hop: boolean; tag: string; index?: number };
      const steps: Step[] = [];
      let cursor = 0;
      while (cursor < path.length) {
        let hop = false;
        if (path.startsWith("//", cursor)) {
          hop = true;
          cursor += 2;
        } else if (path[cursor] === "/") {
          cursor += 1;
        }
        const start = cursor;
        while (cursor < path.length && path[cursor] !== "/") cursor += 1;
        const raw = path.slice(start, cursor).trim();
        if (!raw) continue;
        const parsed = raw.match(/^([^[]+)(?:\[(\d+)\])?$/u);
        if (!parsed) return queryXPath(document, path);
        steps.push({
          hop,
          tag: (parsed[1] ?? "*").toLowerCase(),
          ...(parsed[2] ? { index: Number(parsed[2]) } : {}),
        });
      }
      const hasShadowHop = steps.some((step, position) => step.hop && position > 0);
      if (!hasShadowHop) {
        try {
          return queryXPath(document, path);
        } catch {
          return [];
        }
      }
      let current: Array<Document | Element | ShadowRoot> = [document];
      for (const [position, step] of steps.entries()) {
        const next: Element[] = [];
        for (const root of current) {
          let pool: Element[];
          if (root instanceof Document) {
            pool = root.documentElement ? [root.documentElement] : [];
          } else if (step.hop && position > 0) {
            pool = root instanceof Element ? [...(root.shadowRoot?.children ?? [])] : [];
          } else {
            pool = [...root.children];
          }
          const tagged = pool.filter(
            (element) => step.tag === "*" || element.localName.toLowerCase() === step.tag,
          );
          const picked =
            step.index === undefined ? tagged : [tagged[step.index - 1]!].filter(Boolean);
          for (const element of picked) if (!next.includes(element)) next.push(element);
        }
        if (!next.length) return [];
        current = next;
      }
      return current as Element[];
    };
    const splitSelectorList = (selector: string): string[] => {
      const parts: string[] = [];
      let start = 0;
      let depth = 0;
      let quote = "";
      for (let index = 0; index < selector.length; index += 1) {
        const character = selector[index]!;
        if (quote) {
          if (character === quote && selector[index - 1] !== "\\") quote = "";
          continue;
        }
        if (character === '"' || character === "'") {
          quote = character;
        } else if (character === "(" || character === "[") {
          depth += 1;
        } else if (character === ")" || character === "]") {
          depth = Math.max(0, depth - 1);
        } else if (character === "," && depth === 0) {
          parts.push(selector.slice(start, index));
          start = index + 1;
        }
      }
      parts.push(selector.slice(start));
      return parts;
    };
    const querySelector = (root: QueryRoot, rawSelector: string): Element[] => {
      const selector = rawSelector.trim();
      if (selector === "..") {
        return root instanceof Element && root.parentElement ? [root.parentElement] : [];
      }
      if (/^(?:xpath=|\/|\()/u.test(selector)) {
        return queryXPath(root, selector.replace(/^xpath=/u, ""));
      }
      if (/^text=/iu.test(selector)) {
        const text = selector.replace(/^text=/iu, "").replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2");
        const regexp = text.match(/^\/(.*)\/([dgimsuvy]*)$/u);
        return smallestTextMatches(
          queryCssDeep(root, "*"),
          regexp
            ? { kind: "regexp", source: regexp[1] ?? "", flags: regexp[2] ?? "" }
            : { kind: "string", value: text, exact: false },
        );
      }
      return dedupe(
        splitSelectorList(selector).flatMap((rawPart) => {
          let part = rawPart.trim().replace(/^css=/u, "");
          if (/^text=/iu.test(part)) {
            const text = part.replace(/^text=/iu, "").replace(/^(?:"(.*)"|'(.*)')$/u, "$1$2");
            const regexp = text.match(/^\/(.*)\/([dgimsuvy]*)$/u);
            return smallestTextMatches(
              queryCssDeep(root, "*"),
              regexp
                ? { kind: "regexp", source: regexp[1] ?? "", flags: regexp[2] ?? "" }
                : { kind: "string", value: text, exact: false },
            );
          }
          const requireVisible = /:visible\b/u.test(part);
          part = part.replace(/:visible\b/gu, "").replace(/\s*>>>?\s*/gu, " ");
          const pseudo = part.match(/^(.*?):(has-text|text-is|text)\((['"])(.*?)\3\)(.*)$/u);
          let elements: Element[];
          if (pseudo) {
            const anchors = queryCssDeep(root, pseudo[1]?.trim() || "*").filter((element) =>
              matches(element.textContent ?? "", {
                kind: "string",
                value: pseudo[4] ?? "",
                exact: pseudo[2] === "text-is",
              }),
            );
            const suffix = pseudo[5]?.trim();
            elements = suffix
              ? dedupe(anchors.flatMap((anchor) => queryCssDeep(anchor, suffix)))
              : anchors;
          } else {
            elements = queryCssDeep(root, part || "*");
          }
          return requireVisible ? elements.filter(visible) : elements;
        }),
      );
    };
    const implicitRole = (element: Element): string | undefined => {
      const explicit = element.getAttribute("role")?.trim().split(/\s+/u)[0];
      if (explicit) return explicit;
      const tag = element.tagName.toLocaleLowerCase();
      if (tag === "button") return "button";
      if (tag === "a" && element.hasAttribute("href")) return "link";
      if (tag === "img") return "img";
      if (/^h[1-6]$/u.test(tag)) return "heading";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return element.hasAttribute("multiple") ? "listbox" : "combobox";
      if (tag === "option") return "option";
      if (tag === "ul" || tag === "ol") return "list";
      if (tag === "li") return "listitem";
      if (tag === "table") return "table";
      if (tag === "tr") return "row";
      if (tag === "th") return "columnheader";
      if (tag === "td") return "cell";
      if (tag === "nav") return "navigation";
      if (tag === "main") return "main";
      if (tag === "form") return "form";
      if (tag === "input") {
        const type = (element.getAttribute("type") || "text").toLocaleLowerCase();
        if (["button", "submit", "reset", "image"].includes(type)) return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        if (type === "search") return "searchbox";
        if (!["hidden", "file"].includes(type)) return "textbox";
      }
      return undefined;
    };
    const labelText = (element: Element): string => {
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/u)
          .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
          .join(" ");
        if (normalize(text)) return text;
      }
      const htmlElement = element as HTMLElement & { labels?: NodeListOf<HTMLLabelElement> };
      if (htmlElement.labels?.length) {
        return [...htmlElement.labels].map((label) => label.textContent ?? "").join(" ");
      }
      return "";
    };
    const accessibleName = (element: Element): string => {
      const ariaLabel = element.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel;
      const label = labelText(element);
      if (normalize(label)) return label;
      if (element instanceof HTMLImageElement && element.alt) return element.alt;
      if (
        element instanceof HTMLInputElement &&
        ["button", "submit", "reset"].includes(element.type)
      ) {
        return element.value;
      }
      return element.textContent || element.getAttribute("title") || "";
    };
    const descendants = (roots: QueryRoot[]): Element[] =>
      dedupe(roots.flatMap((root) => queryCssDeep(root, "*")));

    const resolve = (steps: QueryStep[], initialRoots: QueryRoot[] = [document]): Element[] => {
      let current: Element[] = [];
      let roots = initialRoots;
      for (const step of steps) {
        if (step.kind === "selector") {
          current = dedupe(roots.flatMap((root) => querySelector(root, step.value)));
        } else if (step.kind === "text") {
          current = smallestTextMatches(descendants(roots), step.matcher);
        } else if (step.kind === "attribute") {
          current = descendants(roots).filter((element) =>
            matches(element.getAttribute(step.name) ?? "", step.matcher),
          );
        } else if (step.kind === "label") {
          current = descendants(roots).filter((element) =>
            matches(labelText(element), step.matcher),
          );
        } else if (step.kind === "role") {
          current = descendants(roots).filter((element) => {
            if (implicitRole(element) !== step.role) return false;
            if (!step.includeHidden && !visible(element)) return false;
            if (step.name && !matches(accessibleName(element), step.name)) return false;
            if (
              step.checked !== undefined &&
              (element as HTMLInputElement).checked !== step.checked
            )
              return false;
            if (
              step.disabled !== undefined &&
              (element as HTMLInputElement).disabled !== step.disabled
            )
              return false;
            if (
              step.selected !== undefined &&
              (element as HTMLOptionElement).selected !== step.selected
            )
              return false;
            if (
              step.expanded !== undefined &&
              element.getAttribute("aria-expanded") !== String(step.expanded)
            )
              return false;
            if (
              step.pressed !== undefined &&
              element.getAttribute("aria-pressed") !== String(step.pressed)
            )
              return false;
            if (step.level !== undefined && Number(element.tagName.slice(1)) !== step.level)
              return false;
            return true;
          });
        } else if (step.kind === "xpaths") {
          // Candidates come from the accessibility tree, so role, name, and
          // visibility are already settled; only scope and state remain.
          const scoped = dedupe(
            step.values.flatMap((expression) => {
              try {
                return resolveStagehandXPath(expression);
              } catch {
                return [];
              }
            }),
          ).filter((element) =>
            roots.some((root) => root instanceof Document || root.contains(element)),
          );
          current = scoped.filter((element) => {
            if (
              step.checked !== undefined &&
              (element as HTMLInputElement).checked !== step.checked
            )
              return false;
            if (
              step.disabled !== undefined &&
              (element as HTMLInputElement).disabled !== step.disabled
            )
              return false;
            if (
              step.selected !== undefined &&
              (element as HTMLOptionElement).selected !== step.selected
            )
              return false;
            if (
              step.expanded !== undefined &&
              element.getAttribute("aria-expanded") !== String(step.expanded)
            )
              return false;
            if (
              step.pressed !== undefined &&
              element.getAttribute("aria-pressed") !== String(step.pressed)
            )
              return false;
            if (step.level !== undefined && Number(element.tagName.slice(1)) !== step.level)
              return false;
            return true;
          });
        } else if (step.kind === "filter") {
          current = current.filter((element) => {
            const text = element.textContent ?? "";
            if (step.hasText && !matches(text, step.hasText)) return false;
            if (step.hasNotText && matches(text, step.hasNotText)) return false;
            if (step.visible !== undefined && visible(element) !== step.visible) return false;
            if (step.has && resolve(step.has, [element]).length === 0) return false;
            if (step.hasNot && resolve(step.hasNot, [element]).length > 0) return false;
            return true;
          });
        } else if (step.kind === "nth") {
          const index = step.index < 0 ? current.length + step.index : step.index;
          current = index >= 0 && index < current.length ? [current[index]!] : [];
        }
        roots = current;
      }
      return current;
    };

    if (input.operation === "pageContent") {
      return { count: 1, value: document.documentElement.outerHTML };
    }
    if (input.operation === "pageEvaluateHandle") {
      const fn = (0, eval)(`(${input.functionSource})`) as (arg: unknown) => unknown;
      const result = await fn(input.argument);
      if (result instanceof Element) {
        const token = input.token!;
        result.setAttribute("data-stagehand-pw-compat", token);
        return { count: 1, token, handleKind: "element" };
      }
      return { count: 1, value: result, handleKind: "value" };
    }

    const elements = resolve(input.plan ?? []);
    const first = elements[0];
    if (input.operation === "inspect") {
      return { count: elements.length, visible: first ? visible(first) : false };
    }
    if (input.operation === "describe") {
      const describe = (element: Element): string => {
        const id = element.id ? `#${element.id}` : "";
        const classes = element.classList.length
          ? `.${[...element.classList].slice(0, 2).join(".")}`
          : "";
        const text = ((element as HTMLElement).innerText ?? element.textContent ?? "")
          .replace(/\s+/gu, " ")
          .trim();
        const snippet = text.length > 40 ? `${text.slice(0, 40)}…` : text;
        return `<${element.localName}${id}${classes}>${snippet ? ` "${snippet}"` : ""} (${visible(element) ? "visible" : "hidden"})`;
      };
      return { count: elements.length, values: elements.slice(0, 5).map(describe) };
    }
    if (input.operation === "untag") {
      document
        .querySelectorAll(`[data-stagehand-pw-compat="${CSS.escape(input.token ?? "")}"]`)
        .forEach((element) => element.removeAttribute("data-stagehand-pw-compat"));
      return { count: 0 };
    }
    if (input.operation === "tag") {
      if (!first) return { count: 0 };
      first.setAttribute("data-stagehand-pw-compat", input.token!);
      return { count: elements.length, token: input.token };
    }
    if (input.operation === "tagAll") {
      const prefix = input.token!;
      const tokens = elements.map((element, index) => {
        const token = `${prefix}-${index}`;
        element.setAttribute("data-stagehand-pw-compat", token);
        return token;
      });
      return { count: elements.length, values: tokens };
    }
    if (input.operation === "allTextContents") {
      return {
        count: elements.length,
        values: elements.map((element) => element.textContent ?? ""),
      };
    }
    if (input.operation === "allInnerTexts") {
      return {
        count: elements.length,
        values: elements.map((element) => (element as HTMLElement).innerText),
      };
    }
    if (input.operation === "evaluateAll") {
      const fn = (0, eval)(`(${input.functionSource})`) as (
        elements: Element[],
        arg: unknown,
      ) => unknown;
      return { count: elements.length, value: await fn(elements, input.argument) };
    }
    if (!first) return { count: 0 };
    if (input.operation === "textContent")
      return { count: elements.length, value: first.textContent };
    if (input.operation === "innerText")
      return { count: elements.length, value: (first as HTMLElement).innerText };
    if (input.operation === "innerHTML") return { count: elements.length, value: first.innerHTML };
    if (input.operation === "inputValue")
      return { count: elements.length, value: (first as HTMLInputElement).value };
    if (input.operation === "isChecked")
      return { count: elements.length, value: Boolean((first as HTMLInputElement).checked) };
    if (input.operation === "isDisabled")
      return {
        count: elements.length,
        value:
          first.matches(":disabled") ||
          first.getAttribute("aria-disabled")?.toLocaleLowerCase() === "true",
      };
    if (input.operation === "isEnabled")
      return {
        count: elements.length,
        value:
          !first.matches(":disabled") &&
          first.getAttribute("aria-disabled")?.toLocaleLowerCase() !== "true",
      };
    if (input.operation === "getAttribute")
      return { count: elements.length, value: first.getAttribute(input.attribute!) };
    if (input.operation === "boundingBox") {
      const rect = first.getBoundingClientRect?.();
      return {
        count: elements.length,
        value: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      };
    }
    if (input.operation === "focus") {
      (first as HTMLElement).focus();
      return { count: elements.length };
    }
    if (input.operation === "blur") {
      (first as HTMLElement).blur();
      return { count: elements.length };
    }
    if (input.operation === "selectText") {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(first);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return { count: elements.length };
    }
    if (input.operation === "domClick") {
      (first as HTMLElement).click();
      return { count: elements.length };
    }
    if (input.operation === "scrollIntoView") {
      first.scrollIntoView({ block: "center", inline: "center" });
      return { count: elements.length };
    }
    if (input.operation === "evaluate" || input.operation === "elementEvaluateHandle") {
      const fn = (0, eval)(`(${input.functionSource})`) as (
        element: Element,
        arg: unknown,
      ) => unknown;
      const result = await fn(first, input.argument);
      if (input.operation === "elementEvaluateHandle" && result instanceof Element) {
        const token = input.token!;
        result.setAttribute("data-stagehand-pw-compat", token);
        return { count: elements.length, token, handleKind: "element" };
      }
      return { count: elements.length, value: result, handleKind: "value" };
    }
    return { count: elements.length };
  }

  const buildQueryEvaluationExpression = (
    query: Parameters<typeof executeQueryInPage>[0],
  ): string => {
    const functionSource = JSON.stringify(Function.prototype.toString.call(executeQueryInPage));
    const querySource = JSON.stringify(query);
    return `(async () => {
      const identity = (target) => target;
      for (let index = 0; index <= 32; index += 1) {
        globalThis[index === 0 ? "__name" : "__name" + index] = identity;
      }
      try {
        const execute = (0, eval)("(" + ${functionSource} + ")");
        return await execute(${querySource});
      } catch (error) {
        return {
          count: 0,
          error: {
            name: typeof error?.name === "string" ? error.name : "Error",
            message: typeof error?.message === "string" ? error.message : String(error),
            ...(typeof error?.stack === "string" ? { stack: error.stack } : {}),
          },
        };
      }
    })()`;
  };

  const rawContext = stagehand.context;
  type PageKey = string | RawPage;
  const pageKey = (page: RawPage): PageKey => page.pageId ?? page;
  const compatPages = new Map<PageKey, unknown>();
  const closedPages = new Set<PageKey>();
  let closeRequested = false;
  const contextPageListeners = new Map<unknown, boolean>();
  const screenshotArtifacts: Array<{ path: string; base64: string }> = [];
  const encodeBase64 = (bytes: Uint8Array): string => {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  };

  type PageState = {
    rawPage: RawPage;
    execute: (
      plan: QueryStep[],
      operation: Parameters<typeof executeQueryInPage>[0]["operation"],
      extra?: Record<string, unknown>,
    ) => Promise<QueryResult>;
    refreshUrl: () => Promise<void>;
    cachedUrl: string;
    viewport: { width: number; height: number };
    closed: boolean;
  };

  const strictModeMessage = (method: string, count: number, candidates: string[]): string => {
    const listing = candidates.length
      ? ` Candidates: ${candidates.map((candidate, index) => `[${index}] ${candidate}`).join("; ")}${count > candidates.length ? "; …" : ""}.`
      : "";
    return `${method}: strict mode violation: ${count} elements matched.${listing} Narrow the locator (e.g. .filter({ hasText }), .getByRole(...), a more specific selector) or pick one with .first()/.nth(i).`;
  };

  const LAYOUT_ERROR_RE = /layout object|box model|not rendered/iu;

  /**
   * Stagehand's CDP layer reports a matched-but-unrendered element as a bare
   * "-32000 Node does not have a layout object". After the retry window that
   * is what the agent saw; say what it means instead.
   */
  const describeActionFailure = (method: string, error: unknown, timeout: number): Error => {
    const message = error instanceof Error ? error.message : String(error);
    if (!LAYOUT_ERROR_RE.test(message)) return error instanceof Error ? error : new Error(message);
    const described = new Error(
      `${method}: element matched but is not rendered (no layout box: display:none, zero size, or detached) after ${timeout}ms. Wait for it to become visible, or target the visible element instead. Original: ${message}`,
    );
    described.name = error instanceof Error ? error.name : "Error";
    return described;
  };

  class CompatLocator {
    constructor(
      readonly plan: QueryStep[],
      private readonly state: PageState,
    ) {}

    private derived(step: QueryStep): CompatLocator {
      return locatorProxy(new CompatLocator([...this.plan, step], this.state));
    }

    locator(selector: string, options: Record<string, unknown> = {}): CompatLocator {
      record("calls", "locator.locator");
      const located = this.derived({ kind: "selector", value: selector });
      return Object.keys(options).length > 0 ? located.filter(options) : located;
    }

    getByText(value: unknown, options: { exact?: boolean } = {}): CompatLocator {
      record("calls", "locator.getByText");
      return this.derived({ kind: "text", matcher: matcher(value, options.exact) });
    }

    getByRole(role: string, options: Record<string, unknown> = {}): CompatLocator {
      record("calls", "locator.getByRole");
      return this.derived({
        kind: "role",
        role,
        ...(options.name === undefined
          ? {}
          : { name: matcher(options.name, options.exact === true) }),
        ...(typeof options.checked === "boolean" ? { checked: options.checked } : {}),
        ...(typeof options.disabled === "boolean" ? { disabled: options.disabled } : {}),
        ...(typeof options.selected === "boolean" ? { selected: options.selected } : {}),
        ...(typeof options.expanded === "boolean" ? { expanded: options.expanded } : {}),
        ...(typeof options.pressed === "boolean" ? { pressed: options.pressed } : {}),
        ...(typeof options.includeHidden === "boolean"
          ? { includeHidden: options.includeHidden }
          : {}),
        ...(typeof options.level === "number" ? { level: options.level } : {}),
      });
    }

    getByLabel(value: unknown, options: { exact?: boolean } = {}): CompatLocator {
      record("calls", "locator.getByLabel");
      return this.derived({ kind: "label", matcher: matcher(value, options.exact) });
    }

    private byAttribute(name: string, value: unknown, exact: boolean | undefined): CompatLocator {
      return this.derived({ kind: "attribute", name, matcher: matcher(value, exact) });
    }

    getByPlaceholder(value: unknown, options: { exact?: boolean } = {}): CompatLocator {
      record("calls", "locator.getByPlaceholder");
      return this.byAttribute("placeholder", value, options.exact);
    }

    getByAltText(value: unknown, options: { exact?: boolean } = {}): CompatLocator {
      record("calls", "locator.getByAltText");
      return this.byAttribute("alt", value, options.exact);
    }

    getByTitle(value: unknown, options: { exact?: boolean } = {}): CompatLocator {
      record("calls", "locator.getByTitle");
      return this.byAttribute("title", value, options.exact);
    }

    getByTestId(value: unknown): CompatLocator {
      record("calls", "locator.getByTestId");
      return this.byAttribute("data-testid", value, true);
    }

    filter(options: Record<string, unknown>): CompatLocator {
      record("calls", "locator.filter");
      const has = options.has instanceof CompatLocator ? options.has.plan : undefined;
      const hasNot = options.hasNot instanceof CompatLocator ? options.hasNot.plan : undefined;
      return this.derived({
        kind: "filter",
        ...(options.hasText === undefined ? {} : { hasText: matcher(options.hasText) }),
        ...(options.hasNotText === undefined ? {} : { hasNotText: matcher(options.hasNotText) }),
        ...(has ? { has } : {}),
        ...(hasNot ? { hasNot } : {}),
        ...(typeof options.visible === "boolean" ? { visible: options.visible } : {}),
      });
    }

    frameLocator(selector: string): CompatFrameLocator {
      record("calls", "locator.frameLocator");
      return this.contentFrame().frameLocator(selector);
    }

    /** The iframe element this locator points at, entered as a frame. Only css-selector plans map onto a hop selector. */
    contentFrame(): CompatFrameLocator {
      record("calls", "locator.contentFrame");
      if (this.plan.length === 0 || this.plan.some((step) => step.kind !== "selector")) {
        return frameUnsupported(
          "contentFrame",
          "only css-selector locators can be entered as frames; use page.frameLocator(cssSelector)",
        );
      }
      const hop = this.plan
        .map((step) => (step as { kind: "selector"; value: string }).value.trim())
        .join(" ");
      return frameLocatorProxy(new CompatFrameLocator([hop], this.state));
    }

    first(): CompatLocator {
      record("calls", "locator.first");
      return this.derived({ kind: "nth", index: 0 });
    }

    last(): CompatLocator {
      record("calls", "locator.last");
      return this.derived({ kind: "nth", index: -1 });
    }

    nth(index: number): CompatLocator {
      record("calls", "locator.nth");
      return this.derived({ kind: "nth", index });
    }

    async count(): Promise<number> {
      record("calls", "locator.count");
      return (await this.state.execute(this.plan, "inspect")).count;
    }

    async all(): Promise<CompatLocator[]> {
      record("calls", "locator.all");
      const prefix = crypto.randomUUID();
      const result = await this.state.execute(this.plan, "tagAll", { token: prefix });
      return (result.values as string[]).map((token) =>
        locatorProxy(
          new CompatLocator(
            [
              { kind: "selector", value: `[data-stagehand-pw-compat="${token}"]` },
              { kind: "nth", index: 0 },
            ],
            this.state,
          ),
        ),
      );
    }

    async allTextContents(): Promise<string[]> {
      record("calls", "locator.allTextContents");
      return (await this.state.execute(this.plan, "allTextContents")).values as string[];
    }

    async allInnerTexts(): Promise<string[]> {
      record("calls", "locator.allInnerTexts");
      return (await this.state.execute(this.plan, "allInnerTexts")).values as string[];
    }

    private async singleValue(
      operation: Parameters<typeof executeQueryInPage>[0]["operation"],
      extra: Record<string, unknown> = {},
    ): Promise<unknown> {
      const result = await this.state.execute(this.plan, operation, extra);
      if (result.count === 0) throw new Error(`locator.${operation}: no element matched`);
      return result.value;
    }

    async textContent(): Promise<string | null> {
      record("calls", "locator.textContent");
      return (await this.singleValue("textContent")) as string | null;
    }

    async innerText(): Promise<string> {
      record("calls", "locator.innerText");
      return (await this.singleValue("innerText")) as string;
    }

    async innerHTML(): Promise<string> {
      record("calls", "locator.innerHTML");
      return (await this.singleValue("innerHTML")) as string;
    }

    async inputValue(): Promise<string> {
      record("calls", "locator.inputValue");
      return (await this.singleValue("inputValue")) as string;
    }

    async getAttribute(name: string): Promise<string | null> {
      record("calls", "locator.getAttribute");
      return (await this.singleValue("getAttribute", { attribute: name })) as string | null;
    }

    async isVisible(): Promise<boolean> {
      record("calls", "locator.isVisible");
      const result = await this.state.execute(this.plan, "inspect");
      return result.count > 0 && result.visible === true;
    }

    async isChecked(): Promise<boolean> {
      record("calls", "locator.isChecked");
      return (await this.singleValue("isChecked")) as boolean;
    }

    async isDisabled(): Promise<boolean> {
      record("calls", "locator.isDisabled");
      return (await this.singleValue("isDisabled")) as boolean;
    }

    async isEnabled(): Promise<boolean> {
      record("calls", "locator.isEnabled");
      return (await this.singleValue("isEnabled")) as boolean;
    }

    async boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> {
      record("calls", "locator.boundingBox");
      const result = await this.state.execute(this.plan, "boundingBox");
      return result.count === 0
        ? null
        : (result.value as { x: number; y: number; width: number; height: number });
    }

    getBoundingClientRect(): Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    } | null> {
      record("calls", "locator.getBoundingClientRect");
      return this.boundingBox();
    }

    async evaluate<Result = unknown>(
      fn: (element: Element, arg: unknown) => Result,
      arg?: unknown,
    ): Promise<Result> {
      record("calls", "locator.evaluate");
      return (await this.singleValue("evaluate", {
        functionSource: Function.prototype.toString.call(fn),
        ...(arg === undefined ? {} : { argument: arg }),
      })) as Result;
    }

    async evaluateAll<Result = unknown>(
      fn: (elements: Element[], arg: unknown) => Result,
      arg?: unknown,
    ): Promise<Result> {
      record("calls", "locator.evaluateAll");
      return (
        await this.state.execute(this.plan, "evaluateAll", {
          functionSource: Function.prototype.toString.call(fn),
          ...(arg === undefined ? {} : { argument: arg }),
        })
      ).value as Result;
    }

    async evaluateHandle(
      fn: (element: Element, arg: unknown) => unknown,
      arg?: unknown,
    ): Promise<unknown> {
      record("calls", "locator.evaluateHandle");
      const token = crypto.randomUUID();
      const result = await this.state.execute(this.plan, "elementEvaluateHandle", {
        functionSource: Function.prototype.toString.call(fn),
        ...(arg === undefined ? {} : { argument: arg }),
        token,
      });
      return jsHandle(result, this.state);
    }

    async focus(): Promise<void> {
      record("calls", "locator.focus");
      await this.singleValue("focus");
    }

    async blur(): Promise<void> {
      record("calls", "locator.blur");
      await this.singleValue("blur");
    }

    async selectText(): Promise<void> {
      record("calls", "locator.selectText");
      await this.singleValue("selectText");
    }

    async waitFor(options: { state?: string; timeout?: number } = {}): Promise<void> {
      record("calls", "locator.waitFor");
      const state = options.state ?? "visible";
      const timeout = options.timeout ?? 30_000;
      const deadline = Date.now() + timeout;
      do {
        const result = await this.state.execute(this.plan, "inspect");
        const ready =
          state === "attached"
            ? result.count > 0
            : state === "detached"
              ? result.count === 0
              : state === "hidden"
                ? result.count === 0 || result.visible !== true
                : result.count > 0 && result.visible === true;
        if (ready) return;
        await this.state.rawPage.waitForTimeout(50);
      } while (Date.now() < deadline);
      throw new Error(`locator.waitFor: timed out after ${timeout}ms waiting for ${state}`);
    }

    async scrollIntoViewIfNeeded(): Promise<void> {
      record("calls", "locator.scrollIntoViewIfNeeded");
      await this.singleValue("scrollIntoView");
    }

    private async withTaggedTarget(
      method: string,
      action: (locator: RawLocator) => Promise<void>,
      options: { timeout?: number } = {},
    ): Promise<void> {
      record("calls", method);
      // Playwright's own default is 30 s, but through this facade a miss is a
      // dead wait with no call log: eval traces showed 0.65 such misses per
      // task at 30 s each, with agents treating the silence as "not on the
      // page". 10 s (the original facade default) bounds that tail; callers
      // that genuinely need longer pass `timeout` explicitly.
      const timeout = options.timeout ?? 10_000;
      const deadline = Date.now() + timeout;
      let result: QueryResult = { count: 0 };
      let lastActionError: unknown;
      while (Date.now() <= deadline) {
        result = await this.state.execute(this.plan, "inspect");
        if (result.count > 1) throw await this.strictModeViolation(method, result.count);
        if (result.count === 1) {
          // Playwright actions scroll their target into view. Do this before tagging so
          // Stagehand receives a unique, attached selector without imposing a viewport-
          // visibility precondition that its own locator action can already satisfy.
          await this.state.execute(this.plan, "scrollIntoView").catch((): undefined => undefined);
          const token = crypto.randomUUID();
          await this.state.execute(this.plan, "tag", { token });
          let actionSucceeded = false;
          try {
            await action(this.state.rawPage.locator(`[data-stagehand-pw-compat="${token}"]`));
            actionSucceeded = true;
          } catch (error) {
            lastActionError = error;
            const message = error instanceof Error ? error.message : String(error);
            const retryable =
              /(?:not found|could not find|no (?:element|node)|detached|not visible|(?:box model|layout object)|execution context|session|target closed|timed? out|timeout)/iu.test(
                message,
              );
            if (!retryable || Date.now() >= deadline) throw error;
          } finally {
            await this.state.execute([], "untag", { token }).catch((): undefined => undefined);
          }
          if (actionSucceeded) {
            await this.state.refreshUrl();
            return;
          }
        }
        if (Date.now() < deadline) await this.state.rawPage.waitForTimeout(50);
      }
      if (lastActionError) throw describeActionFailure(method, lastActionError, timeout);
      throw new Error(`${method}: no element matched within ${timeout}ms`);
    }

    /**
     * Playwright lists the competing elements on a strict-mode violation; the
     * bare count left agents re-issuing the same selector. Describe up to five
     * candidates so the next attempt can disambiguate.
     */
    private async strictModeViolation(method: string, count: number): Promise<Error> {
      const candidates = await this.state
        .execute(this.plan, "describe")
        .then((result) => (result.values as string[] | undefined) ?? [])
        .catch((): string[] => []);
      return new Error(strictModeMessage(method, count, candidates));
    }

    async click(options: Record<string, unknown> = {}): Promise<void> {
      return this.clickAs("locator.click", options);
    }

    private async clickAs(method: string, options: Record<string, unknown>): Promise<void> {
      if (options.force === true) {
        record("calls", "locator.click");
        const result = await this.state.execute(this.plan, "inspect");
        if (result.count === 0) throw new Error(`${method}: no element matched`);
        if (result.count > 1) throw await this.strictModeViolation(method, result.count);
        await this.state.execute(this.plan, "domClick");
        await this.state.refreshUrl();
        return;
      }
      await this.withTaggedTarget(
        method,
        (locator) =>
          locator.click({
            ...(typeof options.button === "string"
              ? { button: options.button as "left" | "right" | "middle" }
              : {}),
            ...(typeof options.clickCount === "number" ? { clickCount: options.clickCount } : {}),
          }),
        options,
      );
    }

    async fill(value: string, options: Record<string, unknown> = {}): Promise<void> {
      await this.withTaggedTarget("locator.fill", (locator) => locator.fill(value), options);
    }

    async type(value: string, options: Record<string, unknown> = {}): Promise<void> {
      await this.withTaggedTarget(
        "locator.type",
        (locator) =>
          locator.type(
            value,
            typeof options.delay === "number" ? { delay: options.delay } : undefined,
          ),
        options,
      );
    }

    pressSequentially(value: string, options: Record<string, unknown> = {}): Promise<void> {
      record("calls", "locator.pressSequentially");
      return this.type(value, options);
    }

    async press(key: string, options: Record<string, unknown> = {}): Promise<void> {
      await this.withTaggedTarget(
        "locator.press",
        async (locator) => {
          await locator.click();
          await this.state.rawPage.keyPress(
            key,
            typeof options.delay === "number" ? { delay: options.delay } : undefined,
          );
        },
        options,
      );
    }

    async hover(options: Record<string, unknown> = {}): Promise<void> {
      await this.withTaggedTarget("locator.hover", (locator) => locator.hover(), options);
    }

    async selectOption(
      values: CompatSelectOption,
      options: Record<string, unknown> = {},
    ): Promise<string[]> {
      const requested = Array.isArray(values) ? values : [values];
      const indices = requested
        .map((value, position) =>
          typeof value === "object" && value !== null && typeof value.index === "number"
            ? { position, index: value.index }
            : null,
        )
        .filter((value): value is { position: number; index: number } => value !== null);
      const indexedValues =
        indices.length === 0
          ? []
          : await this.evaluate<Array<string | null>>((element, requestedIndices) => {
              const select = element as HTMLSelectElement;
              return (requestedIndices as Array<{ index: number }>).map(
                ({ index }) => select.options[index]?.value ?? null,
              );
            }, indices);
      const normalized = requested.map((value, position) => {
        if (typeof value === "string") return value;
        if (typeof value.value === "string") return value.value;
        if (typeof value.label === "string") return value.label;
        const indexedPosition = indices.findIndex((entry) => entry.position === position);
        const indexedValue = indexedValues[indexedPosition];
        if (typeof indexedValue === "string") return indexedValue;
        throw new Error(`locator.selectOption: option index ${String(value.index)} did not match`);
      });
      let selected: string[] = [];
      await this.withTaggedTarget(
        "locator.selectOption",
        async (locator) => {
          selected = await locator.selectOption(
            Array.isArray(values) ? normalized : normalized[0]!,
          );
        },
        options,
      );
      return selected;
    }

    async setInputFiles(files: unknown, options: Record<string, unknown> = {}): Promise<void> {
      await this.withTaggedTarget(
        "locator.setInputFiles",
        (locator) => locator.setInputFiles(files),
        options,
      );
    }

    async check(options: Record<string, unknown> = {}): Promise<void> {
      record("calls", "locator.check");
      if (!(await this.isChecked())) await this.clickAs("locator.check", options);
    }

    async uncheck(options: Record<string, unknown> = {}): Promise<void> {
      record("calls", "locator.uncheck");
      if (await this.isChecked()) await this.clickAs("locator.uncheck", options);
    }

    async clear(options: Record<string, unknown> = {}): Promise<void> {
      record("calls", "locator.clear");
      await this.fill("", options);
    }

    async $(selector: string): Promise<CompatLocator | null> {
      record("calls", "element.$");
      const locator = (await this.locator(selector).all())[0];
      return locator ? markElementHandle(locator, this.state) : null;
    }

    async $$(selector: string): Promise<CompatLocator[]> {
      record("calls", "element.$$");
      return (await this.locator(selector).all()).map((locator) =>
        markElementHandle(locator, this.state),
      );
    }

    async $eval<Result = unknown>(
      selector: string,
      fn: (element: Element, arg: unknown) => Result,
      arg?: unknown,
    ): Promise<Result> {
      record("calls", "element.$eval");
      return this.locator(selector).first().evaluate(fn, arg);
    }

    async $$eval<Result = unknown>(
      selector: string,
      fn: (elements: Element[], arg: unknown) => Result,
      arg?: unknown,
    ): Promise<Result> {
      record("calls", "element.$$eval");
      return this.locator(selector).evaluateAll(fn, arg);
    }
  }

  const locatorProxy = (locator: CompatLocator): CompatLocator => guard("locator", locator);

  // ---------------------------------------------------------------------------
  // page.frameLocator(): locators scoped to an <iframe>'s document.
  //
  // The in-page query engine above evaluates in the main frame, so it cannot
  // see into cross-origin frames. Frame-scoped locators instead compile to a
  // Stagehand selector the extension resolves across frames:
  //   - css / xpath / text= tails ride on `hop >> hop >> tail` hop notation;
  //   - role / label / exact-text queries resolve through the accessibility
  //     snapshot (includeIframes), whose deep XPaths cross iframe boundaries,
  //     scoped to the nodes under the first hop's <iframe> element.
  // ---------------------------------------------------------------------------

  type FrameQuery =
    | { kind: "selector"; value: string }
    | { kind: "text"; matcher: JsonMatcher }
    | { kind: "attribute"; name: string; matcher: JsonMatcher }
    | { kind: "label"; matcher: JsonMatcher }
    | { kind: "role"; role: string; name?: JsonMatcher };

  const LABEL_ROLES = new Set([
    "textbox",
    "searchbox",
    "combobox",
    "checkbox",
    "radio",
    "slider",
    "spinbutton",
    "switch",
    "listbox",
    "button",
    "menuitem",
    "option",
    "link",
  ]);

  const frameUnsupported = (method: string, reason: string): never => {
    record("misses", `frameLocator.${method}`);
    throw new Error(
      `Playwright compatibility facade: ${method} is not supported inside frameLocator(): ${reason}`,
    );
  };

  const cssAttributeSelector = (name: string, value: JsonMatcher): string | null => {
    if (value.kind === "regexp") return null;
    const escaped = value.value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
    return value.exact ? `[${name}="${escaped}"]` : `[${name}*="${escaped}" i]`;
  };

  /** Absolute, snapshot-style XPath (`/html[1]/body[1]/div[2]/iframe[1]`) of the first hop's iframe element. */
  const iframeHostXPath = async (state: PageState, hop: string): Promise<string | null> => {
    const expression = `(() => {
      const selector = ${JSON.stringify(hop)};
      let element = null;
      if (/^xpath=/iu.test(selector) || selector.startsWith("/") || selector.startsWith("(")) {
        const path = selector.replace(/^xpath=/iu, "");
        const result = document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        element = result.singleNodeValue;
      } else {
        element = document.querySelector(selector);
      }
      if (!(element instanceof Element)) return null;
      const parts = [];
      let node = element;
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        let index = 1;
        for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
          if (sibling.localName === node.localName) index += 1;
        }
        parts.unshift(node.localName + "[" + index + "]");
        const parent = node.parentNode;
        if (parent && parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE && parent.host) {
          parts.unshift("");
          node = parent.host;
        } else {
          node = parent;
        }
      }
      return "/" + parts.join("/");
    })()`;
    const value = await state.rawPage.evaluate<string | null>(expression);
    return typeof value === "string" ? value : null;
  };

  class CompatFrameLocator {
    constructor(
      readonly hops: string[],
      private readonly state: PageState,
    ) {}

    private scoped(query: FrameQuery): CompatFrameScopedLocator {
      return frameScopedProxy(new CompatFrameScopedLocator(this.hops, [query], this.state));
    }

    frameLocator(selector: string): CompatFrameLocator {
      record("calls", "frameLocator.frameLocator");
      return frameLocatorProxy(new CompatFrameLocator([...this.hops, selector], this.state));
    }

    first(): CompatFrameLocator {
      record("calls", "frameLocator.first");
      return frameLocatorProxy(this);
    }

    nth(index: number): CompatFrameLocator {
      record("calls", "frameLocator.nth");
      if (index === 0) return frameLocatorProxy(this);
      return frameUnsupported(
        "nth",
        "only the first matching iframe can be entered; use a more specific iframe selector",
      );
    }

    last(): CompatFrameLocator {
      return frameUnsupported(
        "last",
        "only the first matching iframe can be entered; use a more specific iframe selector",
      );
    }

    owner(): CompatLocator {
      record("calls", "frameLocator.owner");
      if (this.hops.length !== 1) {
        return frameUnsupported(
          "owner",
          "nested frame owners cannot be located from the main document",
        );
      }
      return locatorProxy(
        new CompatLocator([{ kind: "selector", value: this.hops[0]! }], this.state),
      );
    }

    locator(selector: string, options: Record<string, unknown> = {}): CompatFrameScopedLocator {
      record("calls", "frameLocator.locator");
      const located = this.scoped({ kind: "selector", value: selector });
      return Object.keys(options).length > 0 ? located.filter(options) : located;
    }

    getByText(value: unknown, options: { exact?: boolean } = {}): CompatFrameScopedLocator {
      record("calls", "frameLocator.getByText");
      return this.scoped({ kind: "text", matcher: matcher(value, options.exact) });
    }

    getByRole(role: string, options: Record<string, unknown> = {}): CompatFrameScopedLocator {
      record("calls", "frameLocator.getByRole");
      return this.scoped({
        kind: "role",
        role,
        ...(options.name === undefined
          ? {}
          : { name: matcher(options.name, options.exact === true) }),
      });
    }

    getByLabel(value: unknown, options: { exact?: boolean } = {}): CompatFrameScopedLocator {
      record("calls", "frameLocator.getByLabel");
      return this.scoped({ kind: "label", matcher: matcher(value, options.exact) });
    }

    getByPlaceholder(value: unknown, options: { exact?: boolean } = {}): CompatFrameScopedLocator {
      record("calls", "frameLocator.getByPlaceholder");
      return this.scoped({
        kind: "attribute",
        name: "placeholder",
        matcher: matcher(value, options.exact),
      });
    }

    getByAltText(value: unknown, options: { exact?: boolean } = {}): CompatFrameScopedLocator {
      record("calls", "frameLocator.getByAltText");
      return this.scoped({
        kind: "attribute",
        name: "alt",
        matcher: matcher(value, options.exact),
      });
    }

    getByTitle(value: unknown, options: { exact?: boolean } = {}): CompatFrameScopedLocator {
      record("calls", "frameLocator.getByTitle");
      return this.scoped({
        kind: "attribute",
        name: "title",
        matcher: matcher(value, options.exact),
      });
    }

    getByTestId(value: unknown): CompatFrameScopedLocator {
      record("calls", "frameLocator.getByTestId");
      return this.scoped({ kind: "attribute", name: "data-testid", matcher: matcher(value, true) });
    }
  }

  type FrameResolution = { raw: RawLocator; count: number; candidates: string[] };

  class CompatFrameScopedLocator {
    constructor(
      readonly hops: string[],
      readonly queries: FrameQuery[],
      private readonly state: PageState,
      readonly nthIndex?: number,
    ) {}

    private derived(queries: FrameQuery[], nthIndex = this.nthIndex): CompatFrameScopedLocator {
      return frameScopedProxy(
        new CompatFrameScopedLocator(this.hops, queries, this.state, nthIndex),
      );
    }

    locator(selector: string, options: Record<string, unknown> = {}): CompatFrameScopedLocator {
      record("calls", "frameLocator.locator.locator");
      if (this.nthIndex !== undefined || this.queries.some((query) => query.kind !== "selector")) {
        return frameUnsupported(
          "locator.locator",
          "chaining is only supported under css selectors; combine them into one selector",
        );
      }
      const located = this.derived([...this.queries, { kind: "selector", value: selector }]);
      return Object.keys(options).length > 0 ? located.filter(options) : located;
    }

    filter(_options: Record<string, unknown>): CompatFrameScopedLocator {
      return frameUnsupported(
        "locator.filter",
        "use getByRole/getByText or a more specific css selector instead",
      );
    }

    first(): CompatFrameScopedLocator {
      record("calls", "frameLocator.locator.first");
      return this.derived(this.queries, 0);
    }

    last(): CompatFrameScopedLocator {
      record("calls", "frameLocator.locator.last");
      return this.derived(this.queries, -1);
    }

    nth(index: number): CompatFrameScopedLocator {
      record("calls", "frameLocator.locator.nth");
      return this.derived(this.queries, index);
    }

    /** Stagehand selector tail when every query compiles to css/xpath/text=; null when the a11y route is needed. */
    private selectorTail(): string | null {
      const pieces: string[] = [];
      for (const query of this.queries) {
        if (query.kind === "selector") {
          pieces.push(query.value.trim());
        } else if (query.kind === "attribute") {
          const css = cssAttributeSelector(query.name, query.matcher);
          if (css === null) return null;
          pieces.push(css);
        } else if (
          query.kind === "text" &&
          query.matcher.kind === "string" &&
          !query.matcher.exact
        ) {
          if (pieces.length > 0) return null;
          pieces.push(`text=${query.matcher.value}`);
        } else {
          return null;
        }
      }
      if (pieces.length === 0) return null;
      if (pieces.length === 1) return pieces[0]!;
      const nonCss = pieces.some(
        (piece) => /^(?:xpath=|text=|\/|\()/iu.test(piece) || piece.includes(">>"),
      );
      if (nonCss) return null;
      return pieces.join(" ");
    }

    private matchesAccessibilityNode(node: { role: string; name: string }): boolean {
      for (const query of this.queries) {
        if (query.kind === "role") {
          const roles = new Set(ACCESSIBILITY_ROLE_ALIASES[query.role] ?? [query.role]);
          if (!roles.has(node.role)) return false;
          if (query.name && !matchesAccessibleName(node.name, query.name)) return false;
        } else if (query.kind === "label") {
          if (!LABEL_ROLES.has(node.role) || !matchesAccessibleName(node.name, query.matcher)) {
            return false;
          }
        } else if (query.kind === "text") {
          if (!matchesAccessibleName(node.name, query.matcher)) return false;
        } else {
          return false;
        }
      }
      return true;
    }

    private async resolveThroughAccessibilityTree(): Promise<{
      xpaths: string[];
      names: string[];
    }> {
      const prefix = await iframeHostXPath(this.state, this.hops[0]!);
      if (!prefix) return { xpaths: [], names: [] };
      const snapshot = (await this.state.rawPage.snapshot({ includeIframes: true })) as {
        formattedTree?: unknown;
        xpathMap?: unknown;
      } | null;
      if (
        !snapshot ||
        typeof snapshot.formattedTree !== "string" ||
        !snapshot.xpathMap ||
        typeof snapshot.xpathMap !== "object"
      ) {
        return { xpaths: [], names: [] };
      }
      const xpathMap = snapshot.xpathMap as Record<string, string>;
      const xpaths: string[] = [];
      const names: string[] = [];
      for (const node of parseAccessibilityTree(snapshot.formattedTree)) {
        const xpath = xpathMap[node.id];
        if (!xpath || !xpath.startsWith(`${prefix}/`)) continue;
        if (!this.matchesAccessibilityNode(node)) continue;
        xpaths.push(xpath.replace(/\/text\(\)(\[\d+\])?$/iu, ""));
        names.push(`${node.role}${node.name ? ` "${node.name}"` : ""}`);
      }
      return { xpaths, names };
    }

    private async resolve(): Promise<FrameResolution> {
      const tail = this.selectorTail();
      if (tail !== null) {
        const raw = this.state.rawPage.locator([...this.hops, tail].join(" >> "));
        const count = await raw.count();
        if (this.nthIndex === undefined) return { raw, count, candidates: [] };
        const index = this.nthIndex < 0 ? count + this.nthIndex : this.nthIndex;
        const within = index >= 0 && index < count;
        return { raw: within ? raw.nth(index) : raw, count: within ? 1 : 0, candidates: [] };
      }
      const { xpaths, names } = await this.resolveThroughAccessibilityTree();
      if (xpaths.length > 0) record("calls", "frameLocator.accessibilityTree");
      let picked = xpaths;
      let candidates = names;
      if (this.nthIndex !== undefined) {
        const index = this.nthIndex < 0 ? xpaths.length + this.nthIndex : this.nthIndex;
        picked = index >= 0 && index < xpaths.length ? [xpaths[index]!] : [];
        candidates = [];
      }
      const raw = this.state.rawPage.locator(
        `xpath=${picked[0] ?? "/html[1]/__stagehand_no_match__"}`,
      );
      return { raw, count: picked.length, candidates: candidates.slice(0, 5) };
    }

    private async single(method: string, timeout = 10_000): Promise<RawLocator> {
      const deadline = Date.now() + timeout;
      let resolution: FrameResolution = {
        raw: this.state.rawPage.locator("__none__"),
        count: 0,
        candidates: [],
      };
      while (Date.now() <= deadline) {
        resolution = await this.resolve();
        if (resolution.count > 1) {
          throw new Error(strictModeMessage(method, resolution.count, resolution.candidates));
        }
        if (resolution.count === 1) return resolution.raw;
        if (Date.now() < deadline) await this.state.rawPage.waitForTimeout(100);
      }
      throw new Error(
        `${method}: no element matched inside frame ${this.hops.join(" >> ")} within ${timeout}ms`,
      );
    }

    private async act(
      method: string,
      action: (raw: RawLocator) => Promise<void>,
      options: Record<string, unknown> = {},
    ): Promise<void> {
      record("calls", method);
      const timeout = typeof options.timeout === "number" ? options.timeout : 10_000;
      const deadline = Date.now() + timeout;
      let lastError: unknown;
      while (Date.now() <= deadline) {
        const raw = await this.single(method, Math.max(1, deadline - Date.now()));
        try {
          await action(raw);
          await this.state.refreshUrl();
          return;
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          const retryable =
            LAYOUT_ERROR_RE.test(message) ||
            /(?:not found|could not find|no (?:element|node)|detached|not visible|execution context|content frame)/iu.test(
              message,
            );
          if (!retryable || Date.now() >= deadline)
            throw describeActionFailure(method, error, timeout);
          await this.state.rawPage.waitForTimeout(250);
        }
      }
      throw describeActionFailure(method, lastError ?? new Error(`${method}: timed out`), timeout);
    }

    async click(options: Record<string, unknown> = {}): Promise<void> {
      await this.act(
        "frameLocator.locator.click",
        (raw) =>
          raw.click({
            ...(typeof options.button === "string"
              ? { button: options.button as "left" | "right" | "middle" }
              : {}),
            ...(typeof options.clickCount === "number" ? { clickCount: options.clickCount } : {}),
          }),
        options,
      );
    }

    async dblclick(options: Record<string, unknown> = {}): Promise<void> {
      await this.click({ ...options, clickCount: 2 });
    }

    async hover(options: Record<string, unknown> = {}): Promise<void> {
      await this.act("frameLocator.locator.hover", (raw) => raw.hover(), options);
    }

    async fill(value: string, options: Record<string, unknown> = {}): Promise<void> {
      await this.act("frameLocator.locator.fill", (raw) => raw.fill(value), options);
    }

    async clear(options: Record<string, unknown> = {}): Promise<void> {
      await this.fill("", options);
    }

    async type(value: string, options: Record<string, unknown> = {}): Promise<void> {
      await this.act(
        "frameLocator.locator.type",
        (raw) =>
          raw.type(value, typeof options.delay === "number" ? { delay: options.delay } : undefined),
        options,
      );
    }

    pressSequentially(value: string, options: Record<string, unknown> = {}): Promise<void> {
      return this.type(value, options);
    }

    async press(key: string, options: Record<string, unknown> = {}): Promise<void> {
      await this.act(
        "frameLocator.locator.press",
        async (raw) => {
          await raw.click();
          await this.state.rawPage.keyPress(
            key,
            typeof options.delay === "number" ? { delay: options.delay } : undefined,
          );
        },
        options,
      );
    }

    async selectOption(
      values: CompatSelectOption,
      options: Record<string, unknown> = {},
    ): Promise<string[]> {
      const requested = Array.isArray(values) ? values : [values];
      const normalized = requested.map((value) => {
        if (typeof value === "string") return value;
        if (typeof value.value === "string") return value.value;
        if (typeof value.label === "string") return value.label;
        return frameUnsupported(
          "locator.selectOption",
          "index-based options are not supported inside frames",
        );
      });
      let selected: string[] = [];
      await this.act(
        "frameLocator.locator.selectOption",
        async (raw) => {
          selected = await raw.selectOption(Array.isArray(values) ? normalized : normalized[0]!);
        },
        options,
      );
      return selected;
    }

    async setInputFiles(files: unknown, options: Record<string, unknown> = {}): Promise<void> {
      await this.act(
        "frameLocator.locator.setInputFiles",
        (raw) => raw.setInputFiles(files),
        options,
      );
    }

    async check(options: Record<string, unknown> = {}): Promise<void> {
      if (!(await this.isChecked()))
        await this.act("frameLocator.locator.check", (raw) => raw.click(), options);
    }

    async uncheck(options: Record<string, unknown> = {}): Promise<void> {
      if (await this.isChecked())
        await this.act("frameLocator.locator.uncheck", (raw) => raw.click(), options);
    }

    async scrollIntoViewIfNeeded(options: Record<string, unknown> = {}): Promise<void> {
      await this.act(
        "frameLocator.locator.scrollIntoViewIfNeeded",
        (raw) => raw.scrollTo(0),
        options,
      );
    }

    async focus(options: Record<string, unknown> = {}): Promise<void> {
      await this.act("frameLocator.locator.focus", (raw) => raw.click(), options);
    }

    async count(): Promise<number> {
      record("calls", "frameLocator.locator.count");
      return (await this.resolve()).count;
    }

    async all(): Promise<CompatFrameScopedLocator[]> {
      record("calls", "frameLocator.locator.all");
      const count = await this.count();
      return Array.from({ length: count }, (_, index) => this.nth(index));
    }

    async isVisible(): Promise<boolean> {
      record("calls", "frameLocator.locator.isVisible");
      const resolution = await this.resolve();
      if (resolution.count === 0) return false;
      const raw = resolution.count === 1 ? resolution.raw : resolution.raw.nth(0);
      return await raw.isVisible();
    }

    async isHidden(): Promise<boolean> {
      return !(await this.isVisible());
    }

    async waitFor(options: Record<string, unknown> = {}): Promise<void> {
      record("calls", "frameLocator.locator.waitFor");
      const state = typeof options.state === "string" ? options.state : "visible";
      const timeout = typeof options.timeout === "number" ? options.timeout : 10_000;
      const deadline = Date.now() + timeout;
      while (Date.now() <= deadline) {
        const resolution = await this.resolve();
        const attached = resolution.count > 0;
        const visible =
          attached &&
          (await (resolution.count === 1 ? resolution.raw : resolution.raw.nth(0)).isVisible());
        if (
          (state === "attached" && attached) ||
          (state === "detached" && !attached) ||
          (state === "visible" && visible) ||
          (state === "hidden" && !visible)
        ) {
          return;
        }
        await this.state.rawPage.waitForTimeout(100);
      }
      throw new Error(
        `frameLocator.locator.waitFor: element did not become ${state} within ${timeout}ms`,
      );
    }

    async textContent(): Promise<string | null> {
      record("calls", "frameLocator.locator.textContent");
      return (await this.single("frameLocator.locator.textContent")).textContent();
    }

    async innerText(): Promise<string> {
      record("calls", "frameLocator.locator.innerText");
      return (await this.single("frameLocator.locator.innerText")).innerText();
    }

    async innerHTML(): Promise<string> {
      record("calls", "frameLocator.locator.innerHTML");
      return (await this.single("frameLocator.locator.innerHTML")).innerHtml();
    }

    async inputValue(): Promise<string> {
      record("calls", "frameLocator.locator.inputValue");
      return (await this.single("frameLocator.locator.inputValue")).inputValue();
    }

    async isChecked(): Promise<boolean> {
      record("calls", "frameLocator.locator.isChecked");
      return (await this.single("frameLocator.locator.isChecked")).isChecked();
    }

    async allTextContents(): Promise<string[]> {
      record("calls", "frameLocator.locator.allTextContents");
      const results: string[] = [];
      for (const locator of await this.all()) results.push((await locator.textContent()) ?? "");
      return results;
    }

    async allInnerTexts(): Promise<string[]> {
      record("calls", "frameLocator.locator.allInnerTexts");
      const results: string[] = [];
      for (const locator of await this.all()) results.push(await locator.innerText());
      return results;
    }

    evaluate(): never {
      return frameUnsupported(
        "locator.evaluate",
        "page functions cannot run inside a cross-origin frame from the facade; use textContent/inputValue/isVisible or page.screenshot",
      );
    }

    evaluateAll(): never {
      return frameUnsupported(
        "locator.evaluateAll",
        "page functions cannot run inside a cross-origin frame from the facade",
      );
    }

    boundingBox(): never {
      return frameUnsupported(
        "locator.boundingBox",
        "use page.screenshot to inspect the frame visually",
      );
    }
  }

  const frameLocatorProxy = (locator: CompatFrameLocator): CompatFrameLocator =>
    guard("frameLocator", locator);
  const frameScopedProxy = (locator: CompatFrameScopedLocator): CompatFrameScopedLocator =>
    guard("frameLocator.locator", locator);

  const handleMetadata = new WeakMap<
    object,
    { element: CompatLocator | null; result: QueryResult; state: PageState }
  >();
  const pageStateMetadata = new WeakMap<object, PageState>();

  const markElementHandle = (locator: CompatLocator, state: PageState): CompatLocator => {
    handleMetadata.set(locator, {
      element: locator,
      result: { count: 1, handleKind: "element" },
      state,
    });
    return locator;
  };

  const jsHandle = (result: QueryResult, state: PageState): unknown => {
    const element =
      result.handleKind === "element" && result.token
        ? locatorProxy(
            new CompatLocator(
              [
                { kind: "selector", value: `[data-stagehand-pw-compat="${result.token}"]` },
                { kind: "nth", index: 0 },
              ],
              state,
            ),
          )
        : null;
    const target = {
      asElement: () => element,
      jsonValue: async () => result.value,
      evaluate: (fn: (value: unknown, arg: unknown) => unknown, arg?: unknown) =>
        element
          ? element.evaluate(fn, arg)
          : state.rawPage.evaluate(
              (payload) => {
                const evaluate = (0, eval)(`(${payload.functionSource})`) as (
                  value: unknown,
                  argument: unknown,
                ) => unknown;
                return evaluate(payload.value, payload.argument);
              },
              {
                functionSource: Function.prototype.toString.call(fn),
                ...(result.value === undefined ? {} : { value: result.value }),
                ...(arg === undefined ? {} : { argument: arg }),
              },
            ),
      evaluateHandle: (fn: (value: unknown, arg: unknown) => unknown, arg?: unknown) =>
        element?.evaluateHandle(fn, arg) ?? unsupported("jsHandle", "evaluateHandle(value)"),
      dispose: async (): Promise<void> => {
        if (result.token) await state.execute([], "untag", { token: result.token });
      },
      $: (selector: string) => element?.$(selector) ?? null,
      $$: async (selector: string): Promise<CompatLocator[]> => element?.$$(selector) ?? [],
    };
    const handle = guard("jsHandle", target);
    handleMetadata.set(handle, { element, result, state });
    return handle;
  };

  let waitForNewPage: (options?: { timeout?: number }) => Promise<unknown>;

  const createPage = async (page: RawPage): Promise<unknown> => {
    const key = pageKey(page);
    const existing = compatPages.get(key);
    if (existing) return existing;
    const accessibilityFallbacks = new Map<string, { at: number; plan: QueryStep[] | null }>();
    const state: PageState = {
      rawPage: page,
      cachedUrl: await page.url(),
      viewport: await page.evaluate("({ width: innerWidth, height: innerHeight })"),
      closed: false,
      execute: async (plan, operation, extra = {}) => {
        const run = async (steps: QueryStep[]): Promise<QueryResult> => {
          const result = await page.evaluate<QueryResult>(
            buildQueryEvaluationExpression({ plan: steps, operation, ...extra }),
          );
          if (result.error) {
            const error = new Error(result.error.message);
            error.name = result.error.name;
            if (result.error.stack) error.stack = result.error.stack;
            throw error;
          }
          return result;
        };
        const result = await run(plan);
        if (result.count !== 0 || plan.length === 0 || !planHasRoleStep(plan)) return result;

        // Nothing matched in the DOM; consult the accessibility tree. Cache per
        // plan briefly so the inspect → tag → action sequence inside one
        // locator action (and the 50 ms retry loop) reuses a single snapshot.
        const cacheKey = JSON.stringify(plan);
        const cached = accessibilityFallbacks.get(cacheKey);
        let resolved: QueryStep[] | null;
        if (cached && Date.now() - cached.at < ACCESSIBILITY_FALLBACK_CACHE_TTL_MS) {
          resolved = cached.plan;
        } else {
          resolved = await resolvePlanWithAccessibilityTree(page, plan);
          accessibilityFallbacks.set(cacheKey, { at: Date.now(), plan: resolved });
        }
        if (!resolved) return result;
        const fallbackResult = await run(resolved);
        if (fallbackResult.count > 0) record("calls", "locator.getByRole.accessibilityTree");
        else record("misses", "getByRole.accessibilityTree:unresolvedXPath");
        return fallbackResult;
      },
      refreshUrl: async () => {
        state.cachedUrl = await page.url();
        for (const candidate of await rawContext.pages()) await createPage(candidate);
      },
    };
    const root = (): CompatLocator => locatorProxy(new CompatLocator([], state));
    const requestFetch = async (
      url: string,
      options: Record<string, unknown> = {},
    ): Promise<unknown> => {
      record("calls", "request.fetch");
      if (rawContext.request) return await rawContext.request.fetch(url, options);
      const response = await page.evaluate(
        async (payload) => {
          const result = await fetch(payload.url, payload.options as RequestInit);
          return {
            body: await result.text(),
            headers: Object.fromEntries(result.headers.entries()),
            ok: result.ok,
            status: result.status,
            statusText: result.statusText,
            url: result.url,
          };
        },
        { url, options },
      );
      const value = response as {
        body: string;
        headers: Record<string, string>;
        ok: boolean;
        status: number;
        statusText: string;
        url: string;
      };
      return guard("apiResponse", {
        ok: () => value.ok,
        status: () => value.status,
        statusText: () => value.statusText,
        url: () => value.url,
        headers: () => ({ ...value.headers }),
        text: async () => value.body,
        json: async () => JSON.parse(value.body),
        body: async () => new TextEncoder().encode(value.body),
      });
    };
    const request = guard("request", {
      fetch: (url: string, options?: Record<string, unknown>) => requestFetch(url, options),
      get: (url: string, options: Record<string, unknown> = {}) =>
        requestFetch(url, { ...options, method: "GET" }),
      post: (url: string, options: Record<string, unknown> = {}) =>
        requestFetch(url, { ...options, method: "POST" }),
    });
    const eventSubscriptions = new Map<
      string,
      Map<unknown, Promise<{ unsubscribe(): Promise<void> }>>
    >();
    const routeSubscriptions: Array<{
      pattern: unknown;
      handler: unknown;
      subscription: Promise<{ unsubscribe(): Promise<void> }>;
    }> = [];
    const encodeTextBase64 = (value: string): string => {
      const bytes = new TextEncoder().encode(value);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    const networkRequests = new Map<string, unknown>();
    const requestFromEvent = (event: { params?: Record<string, unknown> }) => {
      const params = event.params ?? {};
      const descriptor = (params.request ?? {}) as Record<string, unknown>;
      const headers = (descriptor.headers ?? {}) as Record<string, unknown>;
      const requestId = String(params.requestId ?? "");
      const request = guard("request", {
        url: () => String(descriptor.url ?? ""),
        method: () => String(descriptor.method ?? "GET"),
        headers: () =>
          Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, String(value)])),
        postData: () => (descriptor.postData === undefined ? null : String(descriptor.postData)),
        resourceType: () => String(params.type ?? "other").toLowerCase(),
        isNavigationRequest: () => params.type === "Document",
      });
      if (requestId) networkRequests.set(requestId, request);
      return request;
    };
    const responseFromEvent = (event: { params?: Record<string, unknown> }) => {
      const params = event.params ?? {};
      const descriptor = (params.response ?? {}) as Record<string, unknown>;
      const headers = (descriptor.headers ?? {}) as Record<string, unknown>;
      const request = networkRequests.get(String(params.requestId ?? ""));
      const status = Number(descriptor.status ?? 0);
      return guard("response", {
        url: () => String(descriptor.url ?? ""),
        status: () => status,
        statusText: () => String(descriptor.statusText ?? ""),
        ok: () => status >= 200 && status <= 299,
        headers: () =>
          Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, String(value)])),
        request: () => request,
      });
    };
    const failedRequestFromEvent = (event: { params?: Record<string, unknown> }) => {
      const params = event.params ?? {};
      const request = networkRequests.get(String(params.requestId ?? ""));
      if (!request) return requestFromEvent(event);
      return new Proxy(request as object, {
        get(target, property, receiver) {
          if (property === "failure") {
            return () => ({ errorText: String(params.errorText ?? "Request failed") });
          }
          return Reflect.get(target, property, receiver);
        },
      });
    };
    const consoleMessageFromEvent = (event: { params?: Record<string, unknown> }) => {
      const params = event.params ?? {};
      const args = Array.isArray(params.args) ? params.args : [];
      const text = args
        .map((entry) => {
          const value = (entry ?? {}) as Record<string, unknown>;
          if (value.value !== undefined) return String(value.value);
          if (value.description !== undefined) return String(value.description);
          return String(value.type ?? "");
        })
        .join(" ");
      return guard("consoleMessage", {
        type: () => String(params.type ?? "log"),
        text: () => text,
      });
    };
    const downloadFromEvent = (event: { params?: Record<string, unknown> }) => {
      const params = event.params ?? {};
      const guid = String(params.guid ?? "");
      return guard("download", {
        url: () => String(params.url ?? ""),
        suggestedFilename: () => String(params.suggestedFilename ?? (guid || "download")),
        failure: async (): Promise<null> => null,
        path: async (): Promise<null> => null,
        cancel: async (): Promise<void> => {
          if (guid) await page.sendCDP("Browser.cancelDownload", { guid });
        },
        saveAs: async (): Promise<never> => unsupported("download", "saveAs"),
      });
    };
    const pageErrorFromEvent = (event: { params?: Record<string, unknown> }) => {
      const details = (event.params?.exceptionDetails ?? {}) as Record<string, unknown>;
      const exception = (details.exception ?? {}) as Record<string, unknown>;
      const error = new Error(
        String(exception.description ?? exception.value ?? details.text ?? "Page error"),
      );
      error.name = String(exception.className ?? "Error");
      return error;
    };
    const subscribeEvent = (
      event: string,
      listener: (value: unknown) => unknown,
      once: boolean,
    ): Promise<{ unsubscribe(): Promise<void> }> => {
      if (
        event !== "download" &&
        event !== "console" &&
        event !== "request" &&
        event !== "response" &&
        event !== "requestfailed" &&
        event !== "pageerror" &&
        event !== "framenavigated"
      ) {
        unsupported("page", `on(${event})`);
      }
      let wrapped: (value: any) => unknown;
      wrapped = (value) => {
        if (once) {
          const subscriptions = eventSubscriptions.get(event);
          const subscription = subscriptions?.get(listener);
          subscriptions?.delete(listener);
          if (subscriptions?.size === 0) eventSubscriptions.delete(event);
          void subscription?.then((active) => active.unsubscribe());
        }
        const facadeValue =
          event === "download"
            ? downloadFromEvent(value)
            : event === "console"
              ? consoleMessageFromEvent(value)
              : event === "request"
                ? requestFromEvent(value)
                : event === "response"
                  ? responseFromEvent(value)
                  : event === "requestfailed"
                    ? failedRequestFromEvent(value)
                    : event === "pageerror"
                      ? pageErrorFromEvent(value)
                      : pageProxy;
        return listener(facadeValue);
      };
      const primarySubscription =
        event === "pageerror"
          ? page.onCDP("Runtime.exceptionThrown", wrapped)
          : event === "framenavigated"
            ? page.onCDP("Page.frameNavigated", (value) => {
                const frame = (value.params?.frame ?? {}) as Record<string, unknown>;
                if (frame.parentId === undefined) return wrapped(value);
              })
            : page.on(
                event as "console" | "download" | "request" | "response" | "requestfailed",
                wrapped,
              );
      const requestSubscription =
        event === "response" || event === "requestfailed"
          ? page.onCDP("Network.requestWillBeSent", requestFromEvent)
          : undefined;
      const subscription = requestSubscription
        ? Promise.all([primarySubscription, requestSubscription]).then(([primary, requests]) => ({
            unsubscribe: async () => {
              await Promise.all([primary.unsubscribe(), requests.unsubscribe()]);
            },
          }))
        : primarySubscription;
      const subscriptions = eventSubscriptions.get(event) ?? new Map();
      subscriptions.set(listener, subscription);
      eventSubscriptions.set(event, subscriptions);
      return subscription;
    };
    const waitForResponse = async (
      predicate: string | RegExp | ((response: any) => boolean | Promise<boolean>),
      options: { timeout?: number } = {},
    ): Promise<unknown> => {
      record("calls", "page.waitForResponse");
      const timeout = options.timeout ?? 30_000;
      return await new Promise((resolve, reject) => {
        let settled = false;
        let subscription: Promise<{ unsubscribe(): Promise<void> }>;
        const finish = (result: unknown, error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const subscriptions = eventSubscriptions.get("response");
          subscriptions?.delete(listener);
          if (subscriptions?.size === 0) eventSubscriptions.delete("response");
          void subscription
            .then((active) => active.unsubscribe())
            .catch((): undefined => undefined);
          if (error) reject(error);
          else resolve(result);
        };
        const listener = async (response: any) => {
          try {
            if (predicate instanceof RegExp) predicate.lastIndex = 0;
            const matched =
              typeof predicate === "function"
                ? await predicate(response)
                : predicate instanceof RegExp
                  ? predicate.test(response.url())
                  : response.url() === predicate;
            if (matched) finish(response);
          } catch (error) {
            finish(undefined, error instanceof Error ? error : new Error(String(error)));
          }
        };
        const timer = setTimeout(
          () => finish(undefined, new Error(`page.waitForResponse: timed out after ${timeout}ms`)),
          timeout,
        );
        subscription = subscribeEvent("response", listener, false);
        void subscription.catch((error) =>
          finish(undefined, error instanceof Error ? error : new Error(String(error))),
        );
      });
    };
    const waitForPageEvent = async (
      event: string,
      options: { timeout?: number } = {},
    ): Promise<unknown> => {
      if (event === "popup") return await waitForNewPage(options);
      if (event !== "download") return unsupported("page", `waitForEvent(${event})`);
      await page.sendCDP("Page.enable").catch((): undefined => undefined);
      await page
        .sendCDP("Page.setDownloadBehavior", { behavior: "allow" })
        .catch((): undefined => undefined);
      const timeout = options.timeout ?? 30_000;
      return await new Promise((resolve, reject) => {
        let subscription: Promise<{ unsubscribe(): Promise<void> }>;
        const listener = (download: unknown) => {
          clearTimeout(timer);
          resolve(download);
        };
        const timer = setTimeout(() => {
          const subscriptions = eventSubscriptions.get(event);
          subscriptions?.delete(listener);
          if (subscriptions?.size === 0) eventSubscriptions.delete(event);
          void subscription.then((active) => active.unsubscribe());
          reject(new Error(`page.waitForEvent(download): timed out after ${timeout}ms`));
        }, timeout);
        subscription = subscribeEvent("download", listener, true);
      });
    };
    const pageObject = {
      goto: async (url: string, options?: Record<string, unknown>) => {
        record("calls", "page.goto");
        const response = await page.goto(url, options);
        await state.refreshUrl();
        return response;
      },
      reload: async (options?: Record<string, unknown>) => {
        record("calls", "page.reload");
        const response = await page.reload(options);
        await state.refreshUrl();
        return response;
      },
      goBack: async (options?: Record<string, unknown>) => {
        record("calls", "page.goBack");
        const response = await page.goBack(options);
        await state.refreshUrl();
        return response;
      },
      goForward: async (options?: Record<string, unknown>) => {
        record("calls", "page.goForward");
        const response = await page.goForward(options);
        await state.refreshUrl();
        return response;
      },
      url: () => {
        record("calls", "page.url");
        return state.cachedUrl;
      },
      title: () => {
        record("calls", "page.title");
        return page.title();
      },
      content: async () => {
        record("calls", "page.content");
        return (await state.execute([], "pageContent")).value;
      },
      evaluate: <Result = unknown, Arg = unknown>(
        fn: string | ((arg: Arg) => Result),
        arg?: Arg,
      ) => {
        record("calls", "page.evaluate");
        const metadata =
          arg && typeof arg === "object" ? handleMetadata.get(arg as object) : undefined;
        if (metadata?.element && typeof fn === "function") {
          return metadata.element.evaluate(fn as (element: Element) => Result) as Promise<Result>;
        }
        return page.evaluate(fn, arg);
      },
      evaluateHandle: async (fn: (arg: unknown) => unknown, arg?: unknown) => {
        record("calls", "page.evaluateHandle");
        const metadata =
          arg && typeof arg === "object" ? handleMetadata.get(arg as object) : undefined;
        if (metadata?.element) return metadata.element.evaluateHandle(fn);
        const token = crypto.randomUUID();
        return jsHandle(
          await state.execute([], "pageEvaluateHandle", {
            functionSource: Function.prototype.toString.call(fn),
            ...(arg === undefined ? {} : { argument: arg }),
            token,
          }),
          state,
        );
      },
      frameLocator: (selector: string) => {
        record("calls", "page.frameLocator");
        return frameLocatorProxy(new CompatFrameLocator([selector], state));
      },
      locator: (selector: string, options: Record<string, unknown> = {}) => {
        record("calls", "page.locator");
        const located = locatorProxy(
          new CompatLocator([{ kind: "selector", value: selector }], state),
        );
        return Object.keys(options).length > 0 ? located.filter(options) : located;
      },
      getByText: (value: unknown, options?: { exact?: boolean }) => {
        record("calls", "page.getByText");
        return root().getByText(value, options);
      },
      getByRole: (role: string, options?: Record<string, unknown>) => {
        record("calls", "page.getByRole");
        return root().getByRole(role, options);
      },
      getByLabel: (value: unknown, options?: { exact?: boolean }) => {
        record("calls", "page.getByLabel");
        return root().getByLabel(value, options);
      },
      getByPlaceholder: (value: unknown, options?: { exact?: boolean }) =>
        root().getByPlaceholder(value, options),
      getByAltText: (value: unknown, options?: { exact?: boolean }) =>
        root().getByAltText(value, options),
      getByTitle: (value: unknown, options?: { exact?: boolean }) =>
        root().getByTitle(value, options),
      getByTestId: (value: unknown) => root().getByTestId(value),
      $: async (selector: string) => {
        record("calls", "page.$");
        const locator = (await pageObject.locator(selector).all())[0];
        return locator ? markElementHandle(locator, state) : null;
      },
      $$: async (selector: string) => {
        record("calls", "page.$$");
        return (await pageObject.locator(selector).all()).map((locator) =>
          markElementHandle(locator, state),
        );
      },
      $x: async (expression: string) => {
        record("calls", "page.$x");
        return (await pageObject.locator(`xpath=${expression}`).all()).map((locator) =>
          markElementHandle(locator, state),
        );
      },
      $eval: <Result = unknown>(
        selector: string,
        fn: (element: Element, arg: unknown) => Result,
        arg?: unknown,
      ) => {
        record("calls", "page.$eval");
        return pageObject.locator(selector).first().evaluate(fn, arg);
      },
      $$eval: <Result = unknown>(
        selector: string,
        fn: (elements: Element[], arg: unknown) => Result,
        arg?: unknown,
      ) => {
        record("calls", "page.$$eval");
        return pageObject.locator(selector).evaluateAll(fn, arg);
      },
      click: (selector: string, options?: Record<string, unknown>) =>
        pageObject.locator(selector).click(options),
      hover: (selector: string, options?: Record<string, unknown>) =>
        pageObject.locator(selector).hover(options),
      fill: (selector: string, value: string, options?: Record<string, unknown>) =>
        pageObject.locator(selector).fill(value, options),
      type: (selector: string, value: string, options?: Record<string, unknown>) =>
        pageObject.locator(selector).type(value, options),
      press: (selector: string, key: string, options?: Record<string, unknown>) =>
        pageObject.locator(selector).press(key, options),
      focus: (selector: string) => pageObject.locator(selector).focus(),
      check: (selector: string, options?: Record<string, unknown>) =>
        pageObject.locator(selector).check(options),
      uncheck: (selector: string, options?: Record<string, unknown>) =>
        pageObject.locator(selector).uncheck(options),
      selectOption: (
        selector: string,
        values: CompatSelectOption,
        options?: Record<string, unknown>,
      ) => pageObject.locator(selector).selectOption(values, options),
      getAttribute: (selector: string, name: string) =>
        pageObject.locator(selector).getAttribute(name),
      textContent: (selector: string) => pageObject.locator(selector).textContent(),
      innerText: (selector: string) => pageObject.locator(selector).innerText(),
      inputValue: (selector: string) => pageObject.locator(selector).inputValue(),
      isVisible: (selector: string) => pageObject.locator(selector).isVisible(),
      isChecked: (selector: string) => pageObject.locator(selector).isChecked(),
      isDisabled: (selector: string) => pageObject.locator(selector).isDisabled(),
      isEnabled: (selector: string) => pageObject.locator(selector).isEnabled(),
      screenshot: async (options: Record<string, unknown> = {}) => {
        record("calls", "page.screenshot");
        const { path: requestedPath, ...supported } = options;
        const inferredType =
          supported.type === undefined &&
          typeof requestedPath === "string" &&
          /\.jpe?g$/iu.test(requestedPath)
            ? "jpeg"
            : undefined;
        const bytes = await page.screenshot({
          ...supported,
          ...(inferredType ? { type: inferredType } : {}),
        });
        if (typeof requestedPath === "string") {
          screenshotArtifacts.push({ path: requestedPath, base64: encodeBase64(bytes) });
        }
        return bytes;
      },
      waitForTimeout: async (ms: number) => {
        record("calls", "page.waitForTimeout");
        await page.waitForTimeout(ms);
        for (const candidate of await rawContext.pages()) await createPage(candidate);
      },
      waitForLoadState: (state = "load", options: { timeout?: number } = {}) => {
        record("calls", "page.waitForLoadState");
        return page.waitForLoadState(state, options.timeout);
      },
      waitForSelector: async (selector: string, options?: Record<string, unknown>) => {
        record("calls", "page.waitForSelector");
        return (await page.waitForSelector(selector, options))
          ? pageObject.locator(selector).first()
          : null;
      },
      waitForNavigation: async (
        options: { timeout?: number; waitUntil?: string } = {},
      ): Promise<null> => {
        record("calls", "page.waitForNavigation");
        const before = state.cachedUrl;
        const deadline = Date.now() + (options.timeout ?? 30_000);
        while (Date.now() < deadline) {
          const next = await page.url();
          if (next !== before) {
            state.cachedUrl = next;
            if (options.waitUntil) await page.waitForLoadState(options.waitUntil, options.timeout);
            return null;
          }
          await page.waitForTimeout(50);
        }
        throw new Error("page.waitForNavigation: timed out");
      },
      waitForResponse,
      waitForEvent: waitForPageEvent,
      setViewportSize: async (size: { width: number; height: number }) => {
        record("calls", "page.setViewportSize");
        state.viewport = { width: size.width, height: size.height };
        await page.setViewportSize(size.width, size.height);
      },
      viewportSize: () => {
        record("calls", "page.viewportSize");
        return state.viewport;
      },
      setExtraHTTPHeaders: (headers: Record<string, string>) => {
        record("calls", "page.setExtraHTTPHeaders");
        return page.setExtraHTTPHeaders(headers);
      },
      addInitScript: (script: string | ((arg: unknown) => unknown), arg?: unknown) => {
        record("calls", "page.addInitScript");
        return page.addInitScript(script, arg);
      },
      close: async () => {
        record("calls", "page.close");
        await page.close();
        state.closed = true;
        closedPages.add(key);
      },
      isClosed: () => state.closed,
      name: () => "",
      context: () => context,
      bringToFront: async () => {
        record("calls", "page.bringToFront");
        await rawContext.setActivePage(page);
      },
      frames: () => {
        record("calls", "page.frames");
        return [pageProxy];
      },
      on: (event: string, listener: (value: unknown) => unknown) => {
        record("calls", "page.on");
        subscribeEvent(event, listener, false);
        return pageProxy;
      },
      once: (event: string, listener: (value: unknown) => unknown) => {
        record("calls", "page.once");
        subscribeEvent(event, listener, true);
        return pageProxy;
      },
      off: (event: string, listener: unknown) => {
        record("calls", "page.off");
        const subscriptions = eventSubscriptions.get(event);
        const subscription = subscriptions?.get(listener);
        subscriptions?.delete(listener);
        if (subscriptions?.size === 0) eventSubscriptions.delete(event);
        void subscription?.then((active) => active.unsubscribe());
        return pageProxy;
      },
      removeListener: (event: string, listener: unknown) => {
        record("calls", "page.removeListener");
        const subscriptions = eventSubscriptions.get(event);
        const subscription = subscriptions?.get(listener);
        subscriptions?.delete(listener);
        if (subscriptions?.size === 0) eventSubscriptions.delete(event);
        void subscription?.then((active) => active.unsubscribe());
        return pageProxy;
      },
      route: async (pattern: unknown, handler: (route: unknown) => unknown) => {
        record("calls", "page.route");
        const urlPattern = typeof pattern === "string" ? pattern : "*";
        await page.sendCDP("Fetch.enable", { patterns: [{ urlPattern }] });
        const subscription = page.onCDP("Fetch.requestPaused", async (event) => {
          const params = event.params ?? {};
          const requestId = String(params.requestId ?? "");
          const cdpRequest = (params.request ?? {}) as Record<string, unknown>;
          let handled = false;
          const requestHeaders = (cdpRequest.headers ?? {}) as Record<string, string>;
          const route = {
            request: () => ({
              url: () => String(cdpRequest.url ?? ""),
              method: () => String(cdpRequest.method ?? "GET"),
              headers: () => ({ ...requestHeaders }),
              postData: () =>
                cdpRequest.postData === undefined ? null : String(cdpRequest.postData),
            }),
            continue: async (options: Record<string, unknown> = {}) => {
              handled = true;
              const headers = options.headers as Record<string, string> | undefined;
              await page.sendCDP("Fetch.continueRequest", {
                requestId,
                ...(headers
                  ? { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) }
                  : {}),
                ...(typeof options.url === "string" ? { url: options.url } : {}),
                ...(typeof options.method === "string" ? { method: options.method } : {}),
                ...(typeof options.postData === "string"
                  ? { postData: encodeTextBase64(options.postData) }
                  : {}),
              });
            },
            abort: async (errorReason = "Failed"): Promise<void> => {
              handled = true;
              await page.sendCDP("Fetch.failRequest", { requestId, errorReason });
            },
            fulfill: async (options: Record<string, unknown> = {}): Promise<void> => {
              handled = true;
              const headers = { ...((options.headers ?? {}) as Record<string, string>) };
              const responseBody =
                options.json === undefined
                  ? typeof options.body === "string"
                    ? options.body
                    : undefined
                  : JSON.stringify(options.json);
              if (options.json !== undefined && !("content-type" in headers)) {
                headers["content-type"] = "application/json";
              }
              const body = responseBody === undefined ? undefined : encodeTextBase64(responseBody);
              await page.sendCDP("Fetch.fulfillRequest", {
                requestId,
                responseCode: typeof options.status === "number" ? options.status : 200,
                responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })),
                ...(body === undefined ? {} : { body }),
              });
            },
          };
          await handler(route);
          if (!handled) await route.continue();
        });
        await subscription;
        routeSubscriptions.push({ pattern, handler, subscription });
      },
      unroute: async (pattern: unknown, handler?: unknown): Promise<void> => {
        const matches = routeSubscriptions.filter(
          (entry) =>
            entry.pattern === pattern && (handler === undefined || entry.handler === handler),
        );
        for (const entry of matches) {
          routeSubscriptions.splice(routeSubscriptions.indexOf(entry), 1);
          await (await entry.subscription).unsubscribe();
        }
        if (routeSubscriptions.length === 0) await page.sendCDP("Fetch.disable");
      },
      request,
      accessibility: {
        snapshot: (options?: Record<string, unknown>) => page.snapshot(options),
      },
      keyboard: {
        type: (text: string, options?: { delay?: number }) => page.type(text, options),
        insertText: (text: string) => page.type(text),
        press: (key: string, options?: { delay?: number }) => page.keyPress(key, options),
      },
      mouse: (() => {
        let x = 0;
        let y = 0;
        let down = false;
        return {
          click: (nextX: number, nextY: number, options?: Record<string, unknown>) =>
            page.click(nextX, nextY, options),
          move: async (nextX: number, nextY: number) => {
            x = nextX;
            y = nextY;
            await page.hover(x, y);
          },
          wheel: (deltaX: number, deltaY: number) => page.scroll(x, y, deltaX, deltaY),
          down: async () => {
            down = true;
          },
          up: async () => {
            if (down) await page.click(x, y);
            down = false;
          },
        };
      })(),
    };
    const pageProxy = guard("page", pageObject);
    pageStateMetadata.set(pageProxy, state);
    compatPages.set(key, pageProxy);
    closedPages.delete(key);
    for (const [listener, once] of contextPageListeners) {
      (listener as (value: unknown) => unknown)(pageProxy);
      if (once) contextPageListeners.delete(listener);
    }
    return pageProxy;
  };

  const initialPage = await createPage(stagehand.page);
  const contextRequest = (initialPage as { request: unknown }).request;
  const initialRawPages = await rawContext.pages();
  for (const page of initialRawPages) await createPage(page);

  waitForNewPage = async (options: { timeout?: number } = {}): Promise<unknown> => {
    const existing = new Set(compatPages.keys());
    const timeout = options.timeout ?? 30_000;
    const deadline = Date.now() + timeout;
    do {
      for (const candidate of await rawContext.pages()) {
        const key = pageKey(candidate);
        if (!existing.has(key)) return await createPage(candidate);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(`context.waitForEvent(page): timed out after ${timeout}ms`);
  };

  const contextObject = {
    pages: () => {
      record("calls", "context.pages");
      return [...compatPages.entries()]
        .filter(([key]) => !closedPages.has(key))
        .map(([, page]) => page);
    },
    newPage: async () => {
      record("calls", "context.newPage");
      return await createPage(await rawContext.newPage());
    },
    cookies: (urls?: string | string[]) => {
      record("calls", "context.cookies");
      return rawContext.cookies(urls);
    },
    addCookies: (cookies: unknown[]) => rawContext.addCookies(cookies),
    clearCookies: (options?: Record<string, unknown>) => {
      record("calls", "context.clearCookies");
      return rawContext.clearCookies(options);
    },
    setExtraHTTPHeaders: (headers: Record<string, string>) =>
      rawContext.setExtraHTTPHeaders(headers),
    addInitScript: (script: string | ((arg: unknown) => unknown), arg?: unknown) => {
      record("calls", "context.addInitScript");
      return rawContext.addInitScript(script, arg);
    },
    waitForEvent: (event: string, options?: { timeout?: number }) => {
      if (event !== "page") return unsupported("context", `waitForEvent(${event})`);
      return waitForNewPage(options);
    },
    on: (event: string, listener: (value: unknown) => unknown) => {
      record("calls", "context.on");
      if (event !== "page") return unsupported("context", `on(${event})`);
      contextPageListeners.set(listener, false);
      return context;
    },
    once: (event: string, listener: (value: unknown) => unknown) => {
      record("calls", "context.once");
      if (event !== "page") return unsupported("context", `once(${event})`);
      contextPageListeners.set(listener, true);
      return context;
    },
    off: (event: string, listener: unknown) => {
      record("calls", "context.off");
      if (event !== "page") return unsupported("context", `off(${event})`);
      contextPageListeners.delete(listener);
      return context;
    },
    removeListener: (event: string, listener: unknown) => {
      record("calls", "context.removeListener");
      if (event !== "page") return unsupported("context", `removeListener(${event})`);
      contextPageListeners.delete(listener);
      return context;
    },
    newCDPSession: async (compatPage: object) => {
      record("calls", "context.newCDPSession");
      const target = pageStateMetadata.get(compatPage);
      if (!target) throw new Error("context.newCDPSession: page does not belong to this context");
      const subscriptions: Array<Promise<{ unsubscribe(): Promise<void> }>> = [];
      return guard("cdpSession", {
        send: (method: string, params?: Record<string, unknown>) =>
          target.rawPage.sendCDP(method, params),
        on: (method: string, listener: (params: Record<string, unknown>) => unknown) => {
          subscriptions.push(target.rawPage.onCDP(method, (event) => listener(event.params ?? {})));
        },
        detach: async () => {
          await Promise.all(
            subscriptions.map(async (subscription) => (await subscription).unsubscribe()),
          );
        },
      });
    },
    request: contextRequest,
  };
  const context = guard("context", contextObject);
  const browser = guard("browser", {
    contexts: () => [context],
    isConnected: () => !closeRequested,
    // Do not close Chrome from inside experimentalBatch — the callback is
    // running in that browser. The host reads closeRequested() from the batch
    // envelope and tears down Stagehand + the keep-alive session after the
    // batch returns.
    close: async () => {
      record("calls", "browser.close");
      closeRequested = true;
    },
    // Stagehand v4 exposes one attached context. Returning that context preserves
    // Playwright-shaped control flow without pretending an isolated context exists.
    newContext: async () => {
      record("calls", "browser.newContext");
      return context;
    },
    newPage: () => contextObject.newPage(),
  });

  return {
    page: initialPage,
    context,
    browser,
    telemetry: () => ({ calls: { ...stats.calls }, misses: { ...stats.misses } }),
    artifacts: () => screenshotArtifacts.map((artifact) => ({ ...artifact })),
    closeRequested: () => closeRequested,
  };
}
