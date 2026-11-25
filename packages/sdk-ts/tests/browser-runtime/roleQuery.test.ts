import { trace } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StagehandLogger } from "../../../extension/logger.js";
import { browserWebSocketFactory } from "../../../extension/understudy/browserWebSocketTransport.js";
import { BrowserContext } from "../../../extension/understudy/context.js";
import type { Page } from "../../../extension/understudy/page.js";
import { runWithProgress } from "../../../extension/understudy/progress.js";
import { queryNativeRoles, type NativeRoleQuery } from "../../../extension/understudy/roleQuery.js";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";

describe("native role queries in Chrome", () => {
  let chrome: Awaited<ReturnType<typeof launchLocalBrowser>> | undefined;
  let context: BrowserContext | undefined;
  let page: Page;

  beforeAll(async () => {
    chrome = await launchLocalBrowser({ headless: true }, AbortSignal.timeout(60_000));
    const version = (await fetch(`${chrome.cdpUrl}/json/version`).then((response) =>
      response.json(),
    )) as { webSocketDebuggerUrl: string };
    context = await BrowserContext.create(version.webSocketDebuggerUrl, {
      websocketFactory: browserWebSocketFactory,
      blankPageUrl: "about:blank",
      fallbackLocatorScriptSource: "",
      chromeTabs: {
        activeTargetId: async () => undefined,
        targetIdForTabId: async () => undefined,
        tabIdForTargetId: async () => undefined,
        activateTarget: async () => {},
      },
      logger: new StagehandLogger(
        { tracer: trace.getTracer("role-query-test") },
        () => {},
        undefined,
        "off",
      ),
    });
    page = context.pages()[0]!;
  }, 60_000);

  afterAll(async () => {
    try {
      await context?.close();
    } finally {
      await chrome?.close();
    }
  });

  const setContent = (html: string) =>
    page.evaluate((value) => {
      document.body.innerHTML = value;
    }, html);
  const query = (options: NativeRoleQuery) =>
    runWithProgress({ name: "role fixture", timeout: 5000 }, async (progress) => {
      const frame = page.mainFrame();
      const contextId = await frame.getMainWorldExecutionContextId(progress);
      return queryNativeRoles(frame.session, contextId, options, progress);
    });
  const names = async (options: NativeRoleQuery) =>
    (await query(options))
      .map((node) => node.name?.value)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  it("uses native roles, labels, hidden naming references & presentation rules", async () => {
    await setContent(`
      <span id="hidden-label" hidden>Archive report</span>
      <button aria-labelledby="hidden-label">Wrong</button>
      <div role="button" aria-label="Explicit control"></div>
      <button>Ar<span>chive</span> report</button>
      <label for="account">Account number</label><input id="account">
      <label>Wrapped label<input></label>
      <input aria-label="ARIA input">
      <h2>Report heading</h2><h2 role="presentation">Presentational heading</h2>
      <button role="none">Focusable control</button>
    `);
    expect(await names({ role: "button", name: "archive REPORT" })).toEqual([
      "Archive report",
      "Archive report",
    ]);
    expect(await names({ role: "button" })).toEqual([
      "Archive report",
      "Archive report",
      "Explicit control",
      "Focusable control",
    ]);
    expect(await names({ role: "textbox" })).toEqual([
      "ARIA input",
      "Account number",
      "Wrapped label",
    ]);
    expect(await names({ role: "heading", level: 2 })).toEqual(["Report heading"]);
    const matches = await query({ role: "button" });
    expect(matches.every((node) => Number.isInteger(node.backendDOMNodeId))).toBe(true);
    expect(new Set(matches.map((node) => node.backendDOMNodeId)).size).toBe(matches.length);
  });

  it("finds images & directories through filtered native aliases without duplicate matches", async () => {
    await setContent(`
      <img alt="Report diagram">
      <div role="img" aria-label="Report icon"></div>
      <div role="directory" aria-label="Report directory"><div role="listitem">Entry</div></div>
      <button>Report button</button>
    `);
    expect(await names({ role: "img", name: "report" })).toEqual(["Report diagram", "Report icon"]);
    expect(await names({ role: "directory", name: "Report directory", exact: true })).toEqual([
      "Report directory",
    ]);
  });

  it("normalizes names locally for substring & case-sensitive exact matching", async () => {
    await setContent(
      '<button aria-label="  Save   report  "></button><button>Save report copy</button><button></button>',
    );
    expect(await query({ role: "button", name: "SAVE report" })).toHaveLength(2);
    expect(await query({ role: "button", name: "Save\nreport", exact: true })).toHaveLength(1);
    expect(await query({ role: "button", name: "save report", exact: true })).toHaveLength(0);
    expect(await query({ role: "button", name: "", exact: true })).toHaveLength(1);
  });

  it("excludes unexposed controls without requiring actionability", async () => {
    await setContent(`
      <button hidden>Display hidden</button>
      <button style="visibility:hidden">Visibility hidden</button>
      <div aria-hidden="true"><button>ARIA hidden</button></div>
      <div inert><button>Inert</button></div>
      <button style="opacity:0">Transparent</button>
      <button disabled>Disabled</button>
      <button style="position:absolute;left:-9999px">Offscreen</button>
    `);
    expect(await names({ role: "button" })).toEqual(["Disabled", "Offscreen", "Transparent"]);
    expect(await names({ role: "button", disabled: false })).toEqual(["Offscreen", "Transparent"]);
  });

  it("reads native & ARIA states, including mixed values & absent states", async () => {
    await setContent(`
      <input type="checkbox" aria-label="Checked" checked>
      <input type="checkbox" aria-label="Unchecked">
      <input id="mixed" type="checkbox" aria-label="Mixed">
      <div role="checkbox" aria-checked="true" aria-label="ARIA checked"></div>
      <button aria-pressed="mixed">Mixed toggle</button>
      <button aria-pressed="false">Off toggle</button>
      <button aria-pressed="true" aria-expanded="true" disabled>On toggle</button>
      <button aria-expanded="false">Collapsed</button><button>Plain</button>
      <div role="tab" aria-selected="true">Selected</div>
      <div role="tab" aria-selected="false">Unselected</div>
      <div role="button" aria-disabled="true">ARIA disabled</div>
      <fieldset disabled><button>Inherited disabled</button></fieldset>
      <h3>Native heading</h3><div role="heading" aria-level="4">ARIA heading</div>
    `);
    await page.evaluate(() => {
      (document.getElementById("mixed") as HTMLInputElement).indeterminate = true;
    });
    expect(await names({ role: "checkbox", checked: true })).toEqual(["ARIA checked", "Checked"]);
    expect(await names({ role: "checkbox", checked: false })).toEqual(["Unchecked"]);
    expect(await names({ role: "checkbox", checked: "mixed" })).toEqual(["Mixed"]);
    expect(await names({ role: "button", pressed: "mixed" })).toEqual(["Mixed toggle"]);
    expect(await names({ role: "button", pressed: false })).toEqual(["Off toggle"]);
    expect(await names({ role: "button", pressed: true, expanded: true, disabled: true })).toEqual([
      "On toggle",
    ]);
    expect(await names({ role: "button", expanded: false })).toEqual(["Collapsed"]);
    expect(await names({ role: "button", disabled: true })).toEqual([
      "ARIA disabled",
      "Inherited disabled",
      "On toggle",
    ]);
    expect(await names({ role: "tab", selected: true })).toEqual(["Selected"]);
    expect(await names({ role: "tab", selected: false })).toEqual(["Unselected"]);
    expect(await names({ role: "heading", level: 3 })).toEqual(["Native heading"]);
    expect(await names({ role: "heading", level: 4 })).toEqual(["ARIA heading"]);
  });

  it.each(["open", "closed"] as const)(
    "reads %s & nested shadow roots with slots & root-local labels",
    async (mode) => {
      await setContent(
        '<span id="label">Wrong outer label</span><my-control role="button"><span>World</span></my-control>',
      );
      await page.evaluate((mode) => {
        const root = document.querySelector("my-control")!.attachShadow({ mode });
        root.innerHTML =
          '<span>Hello </span><slot>Fallback</slot><span id="label" hidden>Inner label</span><button aria-labelledby="label"></button><my-nested></my-nested>';
        root.querySelector("my-nested")!.attachShadow({ mode }).innerHTML =
          "<button>Nested control</button>";
      }, mode);
      expect(await names({ role: "button", name: "Hello World" })).toHaveLength(1);
      expect(await names({ role: "button", name: "Inner label", exact: true })).toEqual([
        "Inner label",
      ]);
      expect(await names({ role: "button", name: "Nested control", exact: true })).toEqual([
        "Nested control",
      ]);
      await page.evaluate(() => {
        document.querySelector("my-control > span")!.textContent = "Again";
      });
      expect(await names({ role: "button", name: "Hello Again" })).toHaveLength(1);
      expect(await names({ role: "button", name: "Hello World" })).toHaveLength(0);
    },
  );

  it("queries iframe documents separately from the parent", async () => {
    await setContent("<button>Parent control</button>");
    await page.evaluate(async () => {
      const iframe = document.createElement("iframe");
      iframe.srcdoc = "<button>Child control</button>";
      const loaded = new Promise<void>((resolve) => {
        iframe.onload = () => resolve();
      });
      document.body.append(iframe);
      await loaded;
    });
    expect(await names({ role: "button" })).toEqual(["Parent control"]);
    const { frameTree } = await page.mainSession.send<{
      frameTree: { childFrames?: { frame: { id: string } }[] };
    }>("Page.getFrameTree");
    expect(frameTree.childFrames).toHaveLength(1);
    const child = page.frameForId(frameTree.childFrames![0].frame.id);
    const matches = await runWithProgress(
      { name: "child role fixture", timeout: 5000 },
      async (progress) => {
        const contextId = await child.getMainWorldExecutionContextId(progress);
        return queryNativeRoles(child.session, contextId, { role: "button" }, progress);
      },
    );
    expect(matches.map((node) => node.name?.value)).toEqual(["Child control"]);
  });

  it("observes changed labels, roles, states & replacement documents", async () => {
    await setContent(
      '<span id="label" hidden>Before</span><button id="target" aria-labelledby="label">Wrong</button>',
    );
    expect(await names({ role: "button", name: "Before" })).toEqual(["Before"]);
    await page.evaluate(() => {
      document.getElementById("label")!.textContent = "After";
      const target = document.getElementById("target")!;
      target.setAttribute("role", "checkbox");
      target.setAttribute("aria-checked", "true");
    });
    expect(await names({ role: "button" })).toEqual([]);
    expect(await names({ role: "checkbox", name: "After", checked: true })).toEqual(["After"]);
    await page.goto("data:text/html,<button>New document</button>");
    expect(await names({ role: "button" })).toEqual(["New document"]);
  });
});
