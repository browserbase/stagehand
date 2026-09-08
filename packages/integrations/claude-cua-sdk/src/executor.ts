/**
 * Executes Anthropic Browser Use toolset members against a Stagehand browser
 * through the facade's Playwright-compat batch runtime.
 *
 * Every member is one `experimentalBatch` round trip where the surface allows
 * it: coordinate/keyboard/tab members run as one `run` snippet that also
 * reports the tab inventory; ref-targeted members go through the facade's
 * hydrated snapshot actions (`run` actions); `read_page` / `find` are one
 * `snapshot`; `screenshot` is one facade screenshot. See ARCHITECTURE.md for
 * the per-member table and what has no facade equivalent.
 *
 * Element references are the facade's snapshot ids (`0-7812`): `read_page`
 * and `find` mint them, `run` actions resolve them through the facade's
 * per-page id → xpath map, so a stale id fails with the facade's own message.
 */

import {
  StagehandFacadeSessionLostError,
  StagehandFacadeTools,
  type RefAction,
} from "@browserbasehq/stagehand-integrations/facade";
import {
  sanitizeErrorMessage,
  type HarnessLogger,
} from "@browserbasehq/stagehand-integrations/harness";
import type { Stagehand } from "@browserbasehq/stagehand";
import {
  isBrowserToolsetMember,
  type CuaToolExecutor,
  type CuaToolResult,
  type CuaToolResultBlock,
} from "./toolset.js";

/**
 * The facade surface the executor needs. `StagehandFacadeTools` satisfies it
 * in-process; hosts that own the facade elsewhere (the evals runner bridge)
 * implement it over MCP tool calls.
 */
export type CuaFacadeTools = Pick<
  StagehandFacadeTools,
  "run" | "runActions" | "snapshot" | "screenshot"
>;

export interface StagehandCuaExecutorOptions {
  tools: CuaFacadeTools;
  logger: HarnessLogger;
  /** Runs after a member that may have changed the page; transient evidence failures are ignored. */
  onMutation?: (toolUseId: string) => Promise<void>;
  /** Runner-owned loss telemetry for hosts that call the facade over a bridge. */
  browserSessionLoss?: () => unknown;
}

/** Members that never mutate the page; `onMutation` is not called after them. */
export const READ_ONLY_TOOLSET_MEMBERS: ReadonlySet<string> = new Set<string>([
  "screenshot",
  "zoom",
  "read_page",
  "find",
  "get_page_text",
  "list_tabs",
]);

/**
 * Members the facade cannot express at all. They answer with a recoverable
 * `is_error` tool_result naming an alternative; nothing is stubbed. Ref-target
 * variants that are rejected per call (right/middle/double/triple click and
 * modifiers on a ref) are handled in `click`.
 */
export const UNSUPPORTED_TOOLSET_MEMBERS: ReadonlySet<string> = new Set<string>([
  "hold_key",
  "left_mouse_down",
  "left_mouse_up",
  "file_upload",
  "read_console",
  "read_network",
]);

const BROWSER_MAX_WAIT_S = 30;
const SCROLL_PX_PER_UNIT = 100;
const READ_PAGE_DEFAULT_DEPTH = 15;
const MAX_TEXT_RESULT_CHARS = 120_000;
const MAX_FIND_RESULTS = 20;
const MAX_STATE_FIELD_CHARS = 4096;

const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "slider",
  "spinbutton",
  "switch",
  "listbox",
  "treeitem",
  "menu",
  "menubar",
  "tablist",
]);

/** CUA / xdotool key names → Playwright key names. */
const KEY_NAMES: Record<string, string> = {
  return: "Enter",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  tab: "Tab",
  space: " ",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  page_up: "PageUp",
  page_down: "PageDown",
  ctrl: "Control",
  control: "Control",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  cmd: "Meta",
  command: "Meta",
  meta: "Meta",
  super: "Meta",
  win: "Meta",
};

type PointerTarget = { type: "coordinate"; x: number; y: number } | { type: "ref"; ref: string };

type BrowserTab = { tab_id: string; title: string; url: string; active: boolean };

/**
 * Tail of every mutating `run` snippet: the tab inventory as the toolset's
 * `browser_state` wants it. The canonical visible context excludes keeper pages;
 * its readonly pageId is the underlying Stagehand page identity.
 */
const TABS_SNIPPET = `const __tabs = [];
const __pages = context.pages();
const __activeId = __reportedPage.pageId;
if (typeof __activeId !== "string" || !__activeId) throw new Error("Active facade page is missing a stable pageId.");
for (let __i = 0; __i < __pages.length && __i < 100; __i += 1) {
  const __p = __pages[__i];
  if (typeof __p.pageId !== "string" || !__p.pageId) throw new Error("Visible facade page is missing a stable pageId.");
  let __title = "";
  try { __title = await __p.title(); } catch {}
  __tabs.push({ tab_id: __p.pageId, title: __title, url: __p.url(), active: __p.pageId === __activeId });
}`;

/** Convenience for in-process hosts: executor over a live Stagehand instance. */
export function createStagehandCuaExecutor(
  stagehand: Stagehand,
  options: Omit<StagehandCuaExecutorOptions, "tools">,
): StagehandCuaExecutor {
  return new StagehandCuaExecutor({ ...options, tools: new StagehandFacadeTools(stagehand) });
}

export class StagehandCuaExecutor implements CuaToolExecutor {
  private lastMouse = { x: 0, y: 0 };
  private lastReportedTabs?: string;
  private lastTabs: BrowserTab[] = [];
  private pendingTabOpened: string[] = [];

  constructor(private readonly options: StagehandCuaExecutorOptions) {}

  async execute(
    member: string,
    input: Record<string, unknown>,
    context: { toolUseId: string },
  ): Promise<CuaToolResult> {
    try {
      if (!isBrowserToolsetMember(member)) {
        throw new Error(`Unknown browser toolset member "${member}".`);
      }
      if (UNSUPPORTED_TOOLSET_MEMBERS.has(member)) {
        throw new Error(
          `${member} is not available on this browser${
            member === "hold_key"
              ? '; use key (e.g. "shift+Tab") instead'
              : member === "left_mouse_down" || member === "left_mouse_up"
                ? "; use left_click_drag for a complete drag or left_click for a click instead"
                : ""
          }.`,
        );
      }
      if (
        input.tab_id !== undefined &&
        !["switch_tab", "close_tab", "new_tab", "list_tabs"].includes(member)
      ) {
        // Batch pages are selected when each callback starts. Select the target
        // first so coordinate actions and hydrated refs use the requested tab.
        await this.runWithTabs(tabSelectionCode(asString(input.tab_id, "tab_id")));
      }
      const result = await this.executeMember(member, input);
      if (!READ_ONLY_TOOLSET_MEMBERS.has(member) && this.options.onMutation) {
        await this.options.onMutation(context.toolUseId).catch((error: unknown) => {
          if (this.isSessionLost(error)) throw error;
        });
      }
      return result;
    } catch (error) {
      const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      // Every later call would fail identically; let the session end instead
      // of feeding the model a stream of terminal errors.
      if (this.isSessionLost(error)) throw error;
      this.options.logger.log({
        category: "claude_cua",
        level: 1,
        message: `toolset member ${member} failed: ${message}`,
      });
      return { content: `Error: ${message}`, isError: true };
    }
  }

  private isSessionLost(error: unknown): boolean {
    return (
      error instanceof StagehandFacadeSessionLostError ||
      Boolean(this.options.browserSessionLoss?.())
    );
  }

  private async executeMember(
    member: string,
    input: Record<string, unknown>,
  ): Promise<CuaToolResult> {
    switch (member) {
      case "navigate":
        return this.navigate(input);
      case "screenshot":
        return this.screenshot();
      case "zoom":
        return this.zoom(input);
      case "left_click":
      case "right_click":
      case "middle_click":
      case "double_click":
      case "triple_click":
        return this.click(member, input);
      case "hover":
        return this.hover(input);
      case "left_click_drag":
        return this.drag(input);
      case "mouse_move":
        return this.mouseMove(input);
      case "scroll":
        return this.scroll(input);
      case "scroll_to":
        return this.scrollTo(input);
      case "type":
        return this.typeText(input);
      case "key":
        return this.pressKeys(input);
      case "wait":
        return this.wait(input);
      case "read_page":
        return this.readPage(input);
      case "find":
        return this.find(input);
      case "get_page_text":
        return this.getPageText();
      case "form_input":
        return this.formInput(input);
      case "javascript_exec":
        return this.javascriptExec(input);
      case "new_tab":
        return this.newTab();
      case "list_tabs":
        return this.listTabs();
      case "switch_tab":
        return this.switchTab(input);
      case "close_tab":
        return this.closeTab(input);
      default:
        throw new Error(`Unknown browser toolset member "${member}".`);
    }
  }

  // ---------------------------------------------------------------------------
  // Facade round trips
  // ---------------------------------------------------------------------------

  /** One batch: `body` mutates the page, the tail reports tabs plus `extra`. */
  private async runWithTabs(
    body: string,
    extra = "{}",
  ): Promise<{ tabs: BrowserTab[]; extra: Record<string, unknown> }> {
    const value = (await this.options.tools.run(
      `let __reportedPage = page;\n${body}\n${TABS_SNIPPET}\nreturn { tabs: __tabs, extra: ${extra} };`,
    )) as { tabs?: BrowserTab[]; extra?: Record<string, unknown> } | undefined;
    if (!value || !Array.isArray(value.tabs)) throw new Error("run returned no browser state");
    this.lastTabs = value.tabs;
    return { tabs: value.tabs, extra: value.extra ?? {} };
  }

  /**
   * One batch: hydrated snapshot actions. The facade reports the active url;
   * the cached tab inventory is updated with it rather than spending a second
   * round trip on a full tab listing once a real inventory is cached.
   */
  private async runRefActions(actions: RefAction[]): Promise<BrowserTab[]> {
    const { url } = await this.options.tools.runActions(actions);
    if (this.lastTabs.some((tab) => tab.active)) {
      this.lastTabs = this.lastTabs.map((tab) => (tab.active ? { ...tab, url } : tab));
    } else {
      // read_page/find do not list tabs. Resolve real IDs on the first ref
      // action instead of inventing a tab the model cannot later select.
      await this.runWithTabs("");
    }
    return this.lastTabs;
  }

  private browserState(tabs: BrowserTab[], force: boolean): CuaToolResultBlock | undefined {
    const normalized = tabs.map((tab) => ({
      tab_id: String(tab.tab_id),
      title: sanitizeStateField(tab.title),
      url: sanitizeStateField(tab.url),
      active: tab.active === true,
    }));
    if (normalized.length > 0 && normalized.filter((tab) => tab.active).length !== 1) {
      normalized.forEach((tab) => (tab.active = false));
      normalized[normalized.length - 1]!.active = true;
    }
    const key = JSON.stringify(normalized);
    const changed = key !== this.lastReportedTabs;
    const opened = this.pendingTabOpened.splice(0);
    if (!force && !changed && opened.length === 0) return undefined;
    this.lastReportedTabs = key;
    return {
      type: "browser_state",
      tabs: normalized,
      ...(opened.length > 0 && {
        state_changes: opened.map((tab_id) => ({ type: "tab_opened" as const, tab_id })),
      }),
    };
  }

  private withState(text: string, tabs: BrowserTab[], force = false): CuaToolResult {
    const content: CuaToolResultBlock[] = [{ type: "text", text }];
    const state = this.browserState(tabs, force);
    if (state) content.push(state);
    return { content };
  }

  private stateOnly(tabs: BrowserTab[]): CuaToolResult {
    const state = this.browserState(tabs, true);
    return { content: state ? [state] : [] };
  }

  // ---------------------------------------------------------------------------
  // Navigation / tabs (1 round trip each)
  // ---------------------------------------------------------------------------

  private async navigate(input: Record<string, unknown>): Promise<CuaToolResult> {
    const raw = asString(input.url, "url").trim();
    let body: string;
    if (raw === "back") body = `await page.goBack({ waitUntil: "domcontentloaded" });`;
    else if (raw === "forward") body = `await page.goForward({ waitUntil: "domcontentloaded" });`;
    else if (raw === "reload") body = `await page.reload({ waitUntil: "domcontentloaded" });`;
    else {
      const url = normalizeNavigationUrl(raw);
      body = `await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded" });`;
    }
    const { tabs, extra } = await this.runWithTabs(body, `{ url: page.url() }`);
    return this.withState(`Navigated to ${String(extra.url ?? "")}`, tabs, true);
  }

  private async newTab(): Promise<CuaToolResult> {
    const { tabs, extra } = await this.runWithTabs(
      `const __new = await context.newPage();
await __new.bringToFront();
__reportedPage = __new;`,
      `{ tab_id: __new.pageId }`,
    );
    const tabId = String(extra.tab_id ?? "");
    this.pendingTabOpened.push(tabId);
    return this.stateOnly(tabs.map((tab) => ({ ...tab, active: String(tab.tab_id) === tabId })));
  }

  private async listTabs(): Promise<CuaToolResult> {
    const { tabs } = await this.runWithTabs("");
    return this.stateOnly(tabs);
  }

  private async switchTab(input: Record<string, unknown>): Promise<CuaToolResult> {
    const tabId = asString(input.tab_id, "tab_id");
    const { tabs } = await this.runWithTabs(tabSelectionCode(tabId));
    return this.stateOnly(tabs.map((tab) => ({ ...tab, active: String(tab.tab_id) === tabId })));
  }

  private async closeTab(input: Record<string, unknown>): Promise<CuaToolResult> {
    const tabId = asString(input.tab_id, "tab_id");
    const { tabs } = await this.runWithTabs(
      `const __all = context.pages();
const __target = __all.find((p) => p.pageId === ${JSON.stringify(tabId)});
if (!__target) throw new Error(${JSON.stringify(`Unknown tab_id "${tabId}".`)});
if (__all.length <= 1) throw new Error("Cannot close the last remaining tab.");
const __wasActive = __target.pageId === page.pageId;
await __target.close();
if (__wasActive) {
  const __rest = context.pages();
  __reportedPage = __rest[__rest.length - 1];
  await __reportedPage.bringToFront();
}`,
    );
    return this.stateOnly(tabs.filter((tab) => String(tab.tab_id) !== tabId));
  }

  // ---------------------------------------------------------------------------
  // Pointer
  // ---------------------------------------------------------------------------

  private async click(member: string, input: Record<string, unknown>): Promise<CuaToolResult> {
    const button =
      member === "right_click" ? "right" : member === "middle_click" ? "middle" : "left";
    const clickCount = member === "double_click" ? 2 : member === "triple_click" ? 3 : 1;
    const modifiers = parseModifiers(input.modifiers);
    const target = parseTarget(input) ?? { type: "coordinate" as const, ...this.lastMouse };
    const verb = clickVerb(member);

    if (target.type === "ref") {
      if (button !== "left" || clickCount !== 1 || modifiers.length > 0) {
        throw new Error(
          `${member} on an element reference is not available on this browser; only left_click works on references. Use a coordinate target (locate the element on a screenshot) or press keys instead.`,
        );
      }
      const tabs = await this.runRefActions([{ op: "click", id: target.ref }]);
      return this.withState(`${verb} element ${target.ref}.`, tabs);
    }

    if (modifiers.length > 0) {
      throw new Error(
        "modifier clicks are not available on this browser; use key for a keyboard shortcut or an unmodified click instead.",
      );
    }
    this.lastMouse = { x: target.x, y: target.y };
    const { tabs } = await this.runWithTabs(
      `await batchStagehand.page.click(${target.x}, ${target.y}, ${JSON.stringify({
        button,
        clickCount,
      })});`,
    );
    return this.withState(`${verb} at (${Math.round(target.x)}, ${Math.round(target.y)}).`, tabs);
  }

  private async hover(input: Record<string, unknown>): Promise<CuaToolResult> {
    const target = requireTarget(input);
    if (target.type === "ref") {
      const tabs = await this.runRefActions([{ op: "hover", id: target.ref }]);
      return this.withState(`Hovered element ${target.ref}.`, tabs);
    }
    this.lastMouse = { x: target.x, y: target.y };
    const { tabs } = await this.runWithTabs(
      `await batchStagehand.page.hover(${target.x}, ${target.y});`,
    );
    return this.withState(`Hovered at (${Math.round(target.x)}, ${Math.round(target.y)}).`, tabs);
  }

  private async mouseMove(input: Record<string, unknown>): Promise<CuaToolResult> {
    const target = requireTarget(input, { allowRef: false });
    if (target.type !== "coordinate") throw new Error("mouse_move requires a coordinate target.");
    this.lastMouse = { x: target.x, y: target.y };
    const { tabs } = await this.runWithTabs(
      `await batchStagehand.page.hover(${target.x}, ${target.y});`,
    );
    return this.withState(
      `Moved mouse to (${Math.round(target.x)}, ${Math.round(target.y)}).`,
      tabs,
    );
  }

  private async drag(input: Record<string, unknown>): Promise<CuaToolResult> {
    const from = parseTarget(input, {
      field: "from",
      coordinateField: "start_coordinate",
      allowRef: false,
    });
    const to = parseTarget(input, { allowRef: false });
    if (!from || !to || from.type !== "coordinate" || to.type !== "coordinate") {
      throw new Error("left_click_drag requires coordinate targets in from and target.");
    }
    this.lastMouse = { x: to.x, y: to.y };
    // The SDK owns the full press/move/release sequence. Two movement steps
    // preserve the midpoint used by this executor before the endpoint.
    const { tabs } = await this.runWithTabs(
      `await batchStagehand.page.dragAndDrop(${from.x}, ${from.y}, ${to.x}, ${to.y}, { steps: 2 });`,
    );
    return this.withState(
      `Dragged from (${Math.round(from.x)}, ${Math.round(from.y)}) to (${Math.round(to.x)}, ${Math.round(to.y)}).`,
      tabs,
    );
  }

  private async scroll(input: Record<string, unknown>): Promise<CuaToolResult> {
    const direction = asString(input.scroll_direction, "scroll_direction");
    if (!["up", "down", "left", "right"].includes(direction)) {
      throw new Error(`Invalid scroll_direction "${direction}".`);
    }
    const amount = Math.min(Math.max(1, asNumber(input.scroll_amount ?? 3, "scroll_amount")), 10);
    const px = amount * SCROLL_PX_PER_UNIT;
    const deltaX = direction === "right" ? px : direction === "left" ? -px : 0;
    const deltaY = direction === "down" ? px : direction === "up" ? -px : 0;
    const target = parseTarget(input) ?? { type: "coordinate" as const, ...this.lastMouse };

    if (target.type === "ref") {
      // No element geometry on this side of the facade: bring the element into
      // view (hover), then wheel at the viewport centre. Two round trips.
      await this.runRefActions([{ op: "hover", id: target.ref }]);
      const { tabs } = await this.runWithTabs(
        `const __vp = await page.evaluate("({ w: innerWidth, h: innerHeight })");
await batchStagehand.page.scroll(Math.round(__vp.w / 2), Math.round(__vp.h / 2), ${deltaX}, ${deltaY});`,
      );
      return this.withState(
        `Scrolled ${direction} by ${amount} near element ${target.ref} (element hovered into view first).`,
        tabs,
      );
    }
    this.lastMouse = { x: target.x, y: target.y };
    const { tabs } = await this.runWithTabs(
      `await batchStagehand.page.scroll(${target.x}, ${target.y}, ${deltaX}, ${deltaY});`,
    );
    return this.withState(
      `Scrolled ${direction} by ${amount} at (${Math.round(target.x)}, ${Math.round(target.y)}).`,
      tabs,
    );
  }

  private async scrollTo(input: Record<string, unknown>): Promise<CuaToolResult> {
    const target = requireTarget(input);
    if (target.type !== "ref") throw new Error("scroll_to requires a ref target.");
    // Hovering scrolls the element into view; the facade exposes no
    // scrollIntoView on snapshot ids.
    const tabs = await this.runRefActions([{ op: "hover", id: target.ref }]);
    return this.withState(`Scrolled element ${target.ref} into view.`, tabs);
  }

  // ---------------------------------------------------------------------------
  // Keyboard / timing (1 round trip each)
  // ---------------------------------------------------------------------------

  private async typeText(input: Record<string, unknown>): Promise<CuaToolResult> {
    const text = asString(input.text, "text");
    const { tabs } = await this.runWithTabs(
      `await batchStagehand.page.type(${JSON.stringify(text)});`,
    );
    return this.withState(
      `Typed ${JSON.stringify(text.length > 60 ? `${text.slice(0, 57)}...` : text)}.`,
      tabs,
    );
  }

  private async pressKeys(input: Record<string, unknown>): Promise<CuaToolResult> {
    const raw = asString(input.text, "text");
    const text = raw === " " ? raw : raw.trim();
    if (!text) throw new Error('"text" must name at least one key.');
    const repeat = Math.min(Math.max(1, Math.floor(asNumber(input.repeat ?? 1, "repeat"))), 100);
    const chords = text === " " ? [" "] : text.split(/\s+/).filter(Boolean);
    const pressed: string[] = [];
    for (let i = 0; i < repeat; i += 1) {
      for (const chord of chords) pressed.push(chordToPlaywrightKey(chord));
    }
    const { tabs } = await this.runWithTabs(
      `for (const __key of ${JSON.stringify(pressed)}) await batchStagehand.page.keyPress(__key);`,
    );
    return this.withState(`Pressed ${pressed.join(", ")}.`, tabs);
  }

  private async wait(input: Record<string, unknown>): Promise<CuaToolResult> {
    const seconds = Math.min(
      Math.max(0, asNumber(input.duration ?? 1, "duration")),
      BROWSER_MAX_WAIT_S,
    );
    const { tabs } = await this.runWithTabs(
      `await page.waitForTimeout(${Math.round(seconds * 1000)});`,
    );
    return this.withState(`Waited ${seconds}s.`, tabs);
  }

  // ---------------------------------------------------------------------------
  // Capture / reading (1 round trip each)
  // ---------------------------------------------------------------------------

  private async screenshot(): Promise<CuaToolResult> {
    const image = await this.options.tools.screenshot({ type: "png" });
    return { content: [imageBlock(image.data, image.mimeType)] };
  }

  private async zoom(input: Record<string, unknown>): Promise<CuaToolResult> {
    const region = input.region;
    if (!Array.isArray(region) || region.length < 4) {
      throw new Error('"region" must be [x0, y0, x1, y1].');
    }
    const [x0, y0, x1, y1] = region.map((v, i) => asNumber(v, `region[${i}]`)) as number[];
    const width = x1! - x0!;
    const height = y1! - y0!;
    if (width <= 0 || height <= 0) {
      throw new Error("zoom region must have positive width and height.");
    }
    // Base64 is produced inside the batch: its return value must be JSON.
    const base64 = await this.options.tools.run(
      `const __bytes = await page.screenshot({ type: "png", clip: { x: ${x0}, y: ${y0}, width: ${width}, height: ${height} } });
const __u8 = __bytes instanceof Uint8Array ? __bytes : new Uint8Array(__bytes);
let __bin = "";
for (let __i = 0; __i < __u8.length; __i += 0x8000) __bin += String.fromCharCode.apply(null, __u8.subarray(__i, __i + 0x8000));
return btoa(__bin);`,
    );
    if (typeof base64 !== "string" || !base64) throw new Error("zoom returned no image");
    return { content: [imageBlock(base64, "image/png")] };
  }

  private async readPage(input: Record<string, unknown>): Promise<CuaToolResult> {
    const filter = input.filter as string | undefined;
    if (filter !== undefined && filter !== "interactive" && filter !== "all") {
      throw new Error(`Invalid filter "${String(filter)}".`);
    }
    const depth = Math.max(
      1,
      Math.floor(asNumber(input.depth ?? READ_PAGE_DEFAULT_DEPTH, "depth")),
    );
    const tree = await this.options.tools.snapshot({ includeIframes: true });
    const lines: string[] = [];
    let title = "";
    for (const rawLine of tree.split("\n")) {
      if (!rawLine.trim()) continue;
      const indent = rawLine.match(/^ */)?.[0].length ?? 0;
      if (Math.floor(indent / 2) >= depth) continue;
      const idMatch = rawLine.match(/^(\s*)\[([^\]]+)\]\s*(.*)$/);
      if (!idMatch) {
        if (filter !== "interactive") lines.push(rawLine);
        continue;
      }
      const [, pad, id, rest] = idMatch as unknown as [string, string, string, string];
      const role = rest.split(":")[0]!.trim().toLowerCase();
      if (role === "rootwebarea" && !title) title = rest.slice(rest.indexOf(":") + 1).trim();
      const interactive =
        INTERACTIVE_ROLES.has(role) || rest.includes("[checked]") || rest.includes("[selected]");
      if (filter === "interactive" && !interactive) continue;
      lines.push(`${pad}[${id}] ${rest}`);
    }
    const url = this.lastTabs.find((tab) => tab.active)?.url;
    const header = `Page: ${sanitizeStateField(title)}${url ? ` (${url})` : ""}\nElement references are the bracketed ids; target them with {"type":"ref","ref":"<id>"}.`;
    return { content: [{ type: "text", text: truncateText(`${header}\n${lines.join("\n")}`) }] };
  }

  /** Lexical match over a fresh snapshot; the facade has no model-backed locator. */
  private async find(input: Record<string, unknown>): Promise<CuaToolResult> {
    const query = asString(input.query, "query").trim();
    if (!query) throw new Error('"query" must not be empty.');
    const tree = await this.options.tools.snapshot({ includeIframes: true });
    const tokens = query
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 1);
    const scored: Array<{ id: string; description: string; score: number }> = [];
    for (const line of tree.split("\n")) {
      const match = line.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
      if (!match) continue;
      const [, id, rest] = match as unknown as [string, string, string];
      const lower = rest.toLowerCase();
      const score = tokens.filter((token) => lower.includes(token)).length;
      if (score > 0) scored.push({ id, description: rest.trim(), score });
    }
    const matches = scored.sort((a, b) => b.score - a.score).slice(0, MAX_FIND_RESULTS);
    const text =
      matches.length === 0
        ? `No elements matching "${query}" were found. Try read_page to inspect the page.`
        : `Found ${matches.length} element(s) matching "${query}" (text match over the accessibility tree):\n${matches
            .map((m) => `[${m.id}] ${m.description}`)
            .join("\n")}`;
    return { content: [{ type: "text", text: truncateText(text) }] };
  }

  private async getPageText(): Promise<CuaToolResult> {
    const text = await this.options.tools.run(
      `return await page.evaluate(\`(() => {
  const pick = (el) => (el && el.innerText ? el.innerText.trim() : "");
  const main = pick(document.querySelector("article")) || pick(document.querySelector("main, [role=main]"));
  const body = pick(document.body);
  return main && main.length >= 200 ? main : body;
})()\`);`,
    );
    return { content: [{ type: "text", text: truncateText(String(text ?? "")) }] };
  }

  private async formInput(input: Record<string, unknown>): Promise<CuaToolResult> {
    const target = requireTarget(input);
    if (target.type !== "ref") throw new Error("form_input requires a ref target.");
    if (!("value" in input)) throw new Error('Missing "value".');
    const value = input.value as string | number | boolean;
    let summary: string;
    let tabs: BrowserTab[];
    if (typeof value === "boolean") {
      // Snapshot ids carry no element state on this side of the facade; the
      // toggle is a click and the result says so.
      tabs = await this.runRefActions([{ op: "click", id: target.ref }]);
      summary = `Clicked ${target.ref} to ${value ? "check" : "uncheck"} it; verify its state with read_page.`;
    } else {
      try {
        tabs = await this.runRefActions([{ op: "fill", id: target.ref, value: String(value) }]);
        summary = `Set value of ${target.ref}.`;
      } catch (error) {
        // fill rejects <select> ("unsupported-element"); the facade's select op
        // is the equivalent. Second round trip only on that path.
        const message = error instanceof Error ? error.message : String(error);
        if (!/select|unsupported-element/iu.test(message)) throw error;
        tabs = await this.runRefActions([{ op: "select", id: target.ref, values: String(value) }]);
        summary = `Selected ${JSON.stringify(String(value))} in ${target.ref}.`;
      }
    }
    return this.withState(summary, tabs);
  }

  private async javascriptExec(input: Record<string, unknown>): Promise<CuaToolResult> {
    const script = asString(input.text, "text");
    const output = await this.options.tools.run(
      `const __value = await page.evaluate(${JSON.stringify(script)});
if (__value === undefined) return "undefined";
if (typeof __value === "string") return __value;
try { return JSON.stringify(__value, null, 2) ?? String(__value); } catch { return String(__value); }`,
    );
    return { content: [{ type: "text", text: truncateText(String(output ?? "undefined")) }] };
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function tabSelectionCode(tabId: string): string {
  return `const __target = context.pages().find((p) => p.pageId === ${JSON.stringify(tabId)});
if (!__target) throw new Error(${JSON.stringify(`Unknown tab_id "${tabId}". Call list_tabs to see the open tabs.`)});
await __target.bringToFront();
__reportedPage = __target;`;
}

function imageBlock(data: string, mimeType: string): CuaToolResultBlock {
  return { type: "image", source: { type: "base64", media_type: mimeType, data } };
}

function parseTarget(
  input: Record<string, unknown>,
  opts: { field?: string; coordinateField?: string; allowRef?: boolean } = {},
): PointerTarget | undefined {
  const field = opts.field ?? "target";
  const raw = input[field];
  if (raw && typeof raw === "object") {
    const t = raw as Record<string, unknown>;
    if (t.type === "ref") {
      if (opts.allowRef === false) throw new Error(`"${field}" must be a coordinate target.`);
      return { type: "ref", ref: asString(t.ref, `${field}.ref`).replace(/^ref_/u, "") };
    }
    if (t.type === "coordinate" || ("x" in t && "y" in t)) {
      return { type: "coordinate", x: asNumber(t.x, `${field}.x`), y: asNumber(t.y, `${field}.y`) };
    }
    throw new Error(`Unsupported target type "${String(t.type)}".`);
  }
  const coordinateField = opts.coordinateField ?? "coordinate";
  const coord = input[coordinateField];
  if (Array.isArray(coord)) {
    if (coord.length < 2) throw new Error(`"${coordinateField}" must be [x, y].`);
    return {
      type: "coordinate",
      x: asNumber(coord[0], `${coordinateField}[0]`),
      y: asNumber(coord[1], `${coordinateField}[1]`),
    };
  }
  return undefined;
}

function requireTarget(
  input: Record<string, unknown>,
  opts: { allowRef?: boolean } = {},
): PointerTarget {
  const target = parseTarget(input, opts);
  if (!target) throw new Error('Missing "target".');
  return target;
}

function parseModifiers(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  const parts: string[] = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[+\s,]+/);
  const names = new Set<string>();
  for (const part of parts) {
    const mapped = KEY_NAMES[part.trim().toLowerCase()];
    if (!mapped || !["Control", "Alt", "Meta", "Shift"].includes(mapped)) {
      throw new Error(`Unknown modifier key "${part}".`);
    }
    names.add(mapped);
  }
  return [...names];
}

/** "ctrl+shift+a" → "Control+Shift+a"; single keys map through KEY_NAMES. */
export function chordToPlaywrightKey(chord: string): string {
  if (chord === "+") return "+";
  const keys: string[] = [];
  let building = "";
  for (const ch of chord) {
    if (ch === "+" && building) {
      keys.push(building);
      building = "";
    } else {
      building += ch;
    }
  }
  if (building) keys.push(building);
  return keys
    .map((key) => {
      const mapped = KEY_NAMES[key.toLowerCase()];
      if (mapped) return mapped;
      if (/^f\d{1,2}$/iu.test(key)) return key.toUpperCase();
      return key;
    })
    .join("+");
}

function clickVerb(member: string): string {
  switch (member) {
    case "double_click":
      return "Double-clicked";
    case "triple_click":
      return "Triple-clicked";
    case "right_click":
      return "Right-clicked";
    case "middle_click":
      return "Middle-clicked";
    default:
      return "Clicked";
  }
}

export function normalizeNavigationUrl(raw: string): string {
  let candidate = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:/iu.test(candidate)) candidate = `https://${candidate}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Navigation refused. "${raw}" is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Navigation refused. Only http and https URLs are allowed.");
  }
  return parsed.toString();
}

function sanitizeStateField(value: unknown): string {
  const str = typeof value === "string" ? value : String(value ?? "");
  // No control characters or Unicode line/paragraph separators allowed.
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, "").slice(0, MAX_STATE_FIELD_CHARS);
}

function truncateText(text: string, max = MAX_TEXT_RESULT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[CONTENT TRUNCATED: ${text.length - max} more characters]`;
}

function asNumber(value: unknown, field: string): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new Error(`Invalid or missing numeric field "${field}".`);
  }
  return n;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid or missing string field "${field}".`);
  return value;
}
