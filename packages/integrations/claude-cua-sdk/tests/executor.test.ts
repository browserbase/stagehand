import { describe, expect, it } from "vitest";
import {
  chordToPlaywrightKey,
  normalizeNavigationUrl,
  READ_ONLY_TOOLSET_MEMBERS,
  StagehandCuaExecutor,
  UNSUPPORTED_TOOLSET_MEMBERS,
  type CuaFacadeTools,
} from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };

type FacadeCall =
  | { kind: "run"; code: string }
  | { kind: "actions"; actions: unknown[] }
  | { kind: "snapshot" }
  | { kind: "screenshot"; options: unknown };

const TABS = [{ tab_id: "p1", title: "Example", url: "https://example.com/", active: true }];
const SNAPSHOT = [
  "[0-1] RootWebArea: Example",
  "  [0-9] button: Upload",
  "  [0-12] textbox: Search",
  "    StaticText: hint",
  "  [1-4] link: Background image",
].join("\n");

/**
 * Fake facade: records every round trip and answers `run` code with the
 * envelope the executor's snippets return, so the mapping can be asserted on
 * the emitted code / actions and on the number of round trips.
 */
function fakeFacade(overrides: Partial<CuaFacadeTools> = {}) {
  const calls: FacadeCall[] = [];
  const tools: CuaFacadeTools = {
    run: async (code) => {
      calls.push({ kind: "run", code });
      if (code.includes("return { tabs: __tabs")) {
        const extra = code.includes("url: page.url()")
          ? { url: "https://example.com/", title: "Example" }
          : code.includes("tab_id: __new")
            ? { tab_id: "p2" }
            : {};
        return {
          tabs: extra.tab_id
            ? [
                ...structuredClone(TABS),
                { tab_id: "p2", title: "", url: "about:blank", active: true },
              ]
            : structuredClone(TABS),
          extra,
        };
      }
      return "value";
    },
    runActions: async (actions) => {
      calls.push({ kind: "actions", actions });
      return { completed: actions.length, url: "https://example.com/after" };
    },
    snapshot: async () => {
      calls.push({ kind: "snapshot" });
      return SNAPSHOT;
    },
    screenshot: async (options) => {
      calls.push({ kind: "screenshot", options });
      return { data: "UE5H", mimeType: "image/png" };
    },
    ...overrides,
  };
  return { calls, tools };
}

function executor(facade = fakeFacade(), onMutation?: (toolUseId: string) => Promise<void>) {
  return {
    exec: new StagehandCuaExecutor({
      tools: facade.tools,
      logger,
      ...(onMutation && { onMutation }),
    }),
    calls: facade.calls,
  };
}

const ctx = { toolUseId: "tu_1" };
const lastRun = (calls: FacadeCall[]) =>
  (calls.filter((call) => call.kind === "run").at(-1) as { code: string }).code;

describe("key and url helpers", () => {
  it("maps CUA key names onto Playwright chords", () => {
    expect(chordToPlaywrightKey("ctrl+a")).toBe("Control+a");
    expect(chordToPlaywrightKey("Return")).toBe("Enter");
    expect(chordToPlaywrightKey("shift+Tab")).toBe("Shift+Tab");
    expect(chordToPlaywrightKey("f5")).toBe("F5");
    expect(chordToPlaywrightKey("+")).toBe("+");
  });

  it("normalizes navigation urls to http(s) only", () => {
    expect(normalizeNavigationUrl("example.com")).toBe("https://example.com/");
    expect(() => normalizeNavigationUrl("javascript:alert(1)")).toThrow(/Only http and https/);
  });
});

describe("StagehandCuaExecutor", () => {
  it("navigate → one batch with page.goto that returns browser_state", async () => {
    const { exec, calls } = executor();
    const result = await exec.execute("navigate", { url: "example.com" }, ctx);
    expect(calls).toHaveLength(1);
    expect(lastRun(calls)).toContain(
      'await page.goto("https://example.com/", { waitUntil: "domcontentloaded" })',
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      { type: "text", text: "Navigated to https://example.com/" },
      { type: "browser_state", tabs: TABS },
    ]);
  });

  it("navigate back/forward/reload use history navigation", async () => {
    const { exec, calls } = executor();
    await exec.execute("navigate", { url: "back" }, ctx);
    await exec.execute("navigate", { url: "forward" }, ctx);
    await exec.execute("navigate", { url: "reload" }, ctx);
    expect(calls.map((call) => (call as { code: string }).code.split("\n")[0])).toEqual([
      'await page.goBack({ waitUntil: "domcontentloaded" });',
      'await page.goForward({ waitUntil: "domcontentloaded" });',
      'await page.reload({ waitUntil: "domcontentloaded" });',
    ]);
  });

  it("left_click on a ref → one hydrated action batch; coordinates → raw page.click", async () => {
    const { exec, calls } = executor();
    await exec.execute("navigate", { url: "https://example.com" }, ctx);
    calls.length = 0;
    const byRef = await exec.execute("left_click", { target: { type: "ref", ref: "0-9" } }, ctx);
    expect(calls).toEqual([{ kind: "actions", actions: [{ op: "click", id: "0-9" }] }]);
    expect(byRef.content[0]).toEqual({ type: "text", text: "Clicked element 0-9." });
    // The url the facade reports refreshes the cached tab state — no second round trip.
    expect(byRef.content[1]).toMatchObject({
      type: "browser_state",
      tabs: [{ tab_id: "p1", url: "https://example.com/after", active: true }],
    });

    calls.length = 0;
    const byCoord = await exec.execute(
      "double_click",
      { target: { type: "coordinate", x: 10, y: 20 } },
      ctx,
    );
    expect(calls).toHaveLength(1);
    expect(lastRun(calls)).toContain(
      'await batchStagehand.page.click(10, 20, {"button":"left","clickCount":2})',
    );
    expect(byCoord.content[0]).toEqual({ type: "text", text: "Double-clicked at (10, 20)." });
  });

  it("right/double click and modifiers on a ref have no facade equivalent and answer with a recoverable error", async () => {
    const { exec, calls } = executor();
    for (const [member, input] of [
      ["right_click", { target: { type: "ref", ref: "0-9" } }],
      ["double_click", { target: { type: "ref", ref: "0-9" } }],
      ["left_click", { target: { type: "ref", ref: "0-9" }, modifiers: "shift" }],
    ] as const) {
      const result = await exec.execute(member, input, ctx);
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/only left_click works on references/);
    }
    expect(calls).toEqual([]);
  });

  it("hover / scroll_to on a ref → one hover action", async () => {
    const { exec, calls } = executor();
    await exec.execute("hover", { target: { type: "ref", ref: "0-12" } }, ctx);
    expect(calls).toEqual([{ kind: "actions", actions: [{ op: "hover", id: "0-12" }] }]);
    calls.length = 0;
    const scrolled = await exec.execute("scroll_to", { target: { type: "ref", ref: "1-4" } }, ctx);
    expect(calls).toEqual([{ kind: "actions", actions: [{ op: "hover", id: "1-4" }] }]);
    expect(scrolled.content[0]).toEqual({ type: "text", text: "Scrolled element 1-4 into view." });
  });

  it("scroll → wheel at coordinates (1 trip) or hover+wheel on a ref (2 trips); type/key → raw keyboard", async () => {
    const { exec, calls } = executor();
    await exec.execute(
      "scroll",
      {
        target: { type: "coordinate", x: 100, y: 200 },
        scroll_direction: "down",
        scroll_amount: 2,
      },
      ctx,
    );
    expect(calls).toHaveLength(1);
    expect(lastRun(calls)).toContain("await batchStagehand.page.scroll(100, 200, 0, 200)");
    calls.length = 0;
    await exec.execute(
      "scroll",
      { target: { type: "ref", ref: "0-9" }, scroll_direction: "up" },
      ctx,
    );
    expect(calls.map((call) => call.kind)).toEqual(["actions", "run"]);
    expect(lastRun(calls)).toContain(", 0, -300)");
    calls.length = 0;
    await exec.execute("type", { text: "hello" }, ctx);
    expect(lastRun(calls)).toContain('await batchStagehand.page.type("hello")');
    calls.length = 0;
    const keys = await exec.execute("key", { text: "ctrl+a Backspace", repeat: 2 }, ctx);
    expect(lastRun(calls)).toContain(
      'for (const __key of ["Control+a","Backspace","Control+a","Backspace"])',
    );
    expect(keys.content[0]).toEqual({
      type: "text",
      text: "Pressed Control+a, Backspace, Control+a, Backspace.",
    });
  });

  it("drag uses the complete native gesture in one batch", async () => {
    const { exec, calls } = executor();
    await exec.execute(
      "left_click_drag",
      { from: { type: "coordinate", x: 1, y: 2 }, target: { type: "coordinate", x: 30, y: 40 } },
      ctx,
    );
    expect(calls).toHaveLength(1);
    expect(lastRun(calls)).toContain(
      "await batchStagehand.page.dragAndDrop(1, 2, 30, 40, { steps: 2 })",
    );
  });

  it.each(["left_mouse_down", "left_mouse_up"])(
    "%s gives guidance without claiming to hold a button",
    async (member) => {
      const { exec, calls } = executor();
      const result = await exec.execute(
        member,
        { target: { type: "coordinate", x: 1, y: 2 } },
        ctx,
      );
      expect(result).toEqual({
        content: `Error: ${member} is not available on this browser; use left_click_drag for a complete drag or left_click for a click instead.`,
        isError: true,
      });
      expect(calls).toEqual([]);
    },
  );

  it("screenshot → facade screenshot as an image block; zoom → clipped screenshot in-batch", async () => {
    const { exec, calls } = executor();
    const result = await exec.execute("screenshot", {}, ctx);
    expect(calls).toEqual([{ kind: "screenshot", options: { type: "png" } }]);
    expect(result.content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "UE5H" } },
    ]);
    calls.length = 0;
    const zoom = await exec.execute("zoom", { region: [0, 0, 100, 50] }, ctx);
    expect(calls).toHaveLength(1);
    expect(lastRun(calls)).toContain("clip: { x: 0, y: 0, width: 100, height: 50 }");
    expect(zoom.content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "value" } },
    ]);
  });

  it("read_page → one snapshot with depth/interactive filters and a ref hint", async () => {
    const { exec, calls } = executor();
    await exec.execute("navigate", { url: "https://example.com" }, ctx);
    calls.length = 0;
    const all = await exec.execute("read_page", {}, ctx);
    expect(calls).toEqual([{ kind: "snapshot" }]);
    const text = (all.content as Array<{ text?: string }>)[0]!.text!;
    expect(text).toContain("Page: Example (https://example.com/)");
    expect(text).toContain('{"type":"ref","ref":"<id>"}');
    expect(text).toContain("[0-12] textbox: Search");
    expect(text).toContain("StaticText: hint");

    const interactive = await exec.execute("read_page", { filter: "interactive", depth: 2 }, ctx);
    const filtered = (interactive.content as Array<{ text?: string }>)[0]!.text!;
    expect(filtered).toContain("[0-9] button: Upload");
    expect(filtered).toContain("[1-4] link: Background image");
    expect(filtered).not.toContain("RootWebArea");
    expect(filtered).not.toContain("StaticText");
  });

  it("find → lexical match over a fresh snapshot", async () => {
    const { exec, calls } = executor();
    const result = await exec.execute("find", { query: "background image link" }, ctx);
    expect(calls).toEqual([{ kind: "snapshot" }]);
    const text = (result.content as Array<{ text?: string }>)[0]!.text!;
    expect(text.split("\n")[1]).toBe("[1-4] link: Background image");
    const none = await exec.execute("find", { query: "zzzz" }, ctx);
    expect((none.content as Array<{ text?: string }>)[0]!.text).toMatch(/No elements matching/);
  });

  it("get_page_text and javascript_exec run through page.evaluate in one batch", async () => {
    const { exec, calls } = executor();
    await exec.execute("get_page_text", {}, ctx);
    expect(calls).toHaveLength(1);
    expect(lastRun(calls)).toContain("innerText");
    calls.length = 0;
    const js = await exec.execute("javascript_exec", { text: "document.title" }, ctx);
    expect(calls).toHaveLength(1);
    expect(lastRun(calls)).toContain('await page.evaluate("document.title")');
    expect(js.content).toEqual([{ type: "text", text: "value" }]);
  });

  it("form_input → fill, falling back to select on the facade's unsupported-element error; booleans toggle by click", async () => {
    let fillAttempts = 0;
    const facade = fakeFacade({
      runActions: async (actions) => {
        facade.calls.push({ kind: "actions", actions });
        if (actions[0]!.op === "fill") {
          fillAttempts += 1;
          throw new Error("Failed to fill element (unsupported-element)");
        }
        return { completed: 1, url: "https://example.com/" };
      },
    });
    const { exec, calls } = executor(facade);
    const selected = await exec.execute(
      "form_input",
      { target: { type: "ref", ref: "0-12" }, value: "Lowest price" },
      ctx,
    );
    expect(fillAttempts).toBe(1);
    expect(calls[1]).toEqual({
      kind: "actions",
      actions: [{ op: "select", id: "0-12", values: "Lowest price" }],
    });
    expect(selected.content[0]).toEqual({ type: "text", text: 'Selected "Lowest price" in 0-12.' });

    calls.length = 0;
    const toggled = await exec.execute(
      "form_input",
      { target: { type: "ref", ref: "0-9" }, value: true },
      ctx,
    );
    expect(calls).toEqual([{ kind: "actions", actions: [{ op: "click", id: "0-9" }] }]);
    expect((toggled.content as Array<{ text?: string }>)[0]!.text).toMatch(/verify its state/);
  });

  it("tab members return exactly one browser_state block", async () => {
    const { exec, calls } = executor();
    const opened = await exec.execute("new_tab", {}, ctx);
    expect(opened.content).toEqual([
      {
        type: "browser_state",
        tabs: [
          { ...TABS[0], active: false },
          { tab_id: "p2", title: "", url: "about:blank", active: true },
        ],
        state_changes: [{ type: "tab_opened", tab_id: "p2" }],
      },
    ]);
    const listed = await exec.execute("list_tabs", {}, ctx);
    expect(listed.content).toHaveLength(1);
    expect((listed.content as Array<{ type: string }>)[0]!.type).toBe("browser_state");
    await exec.execute("switch_tab", { tab_id: "p1" }, ctx);
    expect(lastRun(calls)).toContain('=== "p1"');
    const missing = await exec.execute("switch_tab", {}, ctx);
    expect(missing.isError).toBe(true);
  });

  it("unsupported members and facade errors become recoverable tool errors, never throws", async () => {
    const facade = fakeFacade({
      runActions: async () => {
        throw new Error('Snapshot ID "9-9" is stale or not actionable; call snapshot again.');
      },
    });
    const { exec } = executor(facade);
    for (const member of UNSUPPORTED_TOOLSET_MEMBERS) {
      const result = await exec.execute(member, {}, ctx);
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/not available on this browser/);
    }
    const stale = await exec.execute("left_click", { target: { type: "ref", ref: "9-9" } }, ctx);
    expect(stale).toEqual({
      content: 'Error: Snapshot ID "9-9" is stale or not actionable; call snapshot again.',
      isError: true,
    });
    const unknown = await exec.execute("teleport", {}, ctx);
    expect(unknown.isError).toBe(true);
  });

  it("rethrows a lost browser session so the loop ends instead of looping on terminal errors", async () => {
    const facade = fakeFacade({
      run: async () => {
        throw new Error("Browser session lost (CDP connection closed). The task cannot continue.");
      },
    });
    const { exec } = executor(facade);
    await expect(exec.execute("type", { text: "x" }, ctx)).rejects.toThrow(/Browser session lost/);
  });

  it("stops on terminal loss discovered by evidence capture but tolerates transient evidence errors", async () => {
    const lost = executor(fakeFacade(), async () => {
      throw new Error("Browser session lost (CDP connection closed). The task cannot continue.");
    });
    await expect(lost.exec.execute("type", { text: "x" }, ctx)).rejects.toThrow(
      /Browser session lost/,
    );
    const transient = executor(fakeFacade(), async () => {
      throw new Error("screenshot timed out");
    });
    expect((await transient.exec.execute("type", { text: "x" }, ctx)).isError).not.toBe(true);
  });

  it("calls onMutation after mutating members only", async () => {
    const observed: string[] = [];
    const { exec } = executor(fakeFacade(), async (toolUseId) => {
      observed.push(toolUseId);
    });
    await exec.execute("screenshot", {}, { toolUseId: "ro" });
    await exec.execute("read_page", {}, { toolUseId: "ro2" });
    await exec.execute("type", { text: "x" }, { toolUseId: "mut" });
    expect(observed).toEqual(["mut"]);
    expect(READ_ONLY_TOOLSET_MEMBERS.has("type")).toBe(false);
  });
});
