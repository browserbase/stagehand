/// <reference types="chrome" />

import { trace } from "@opentelemetry/api";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LocatorChain, LocatorQueryStep } from "@browserbasehq/stagehand-protocol/types";
import { StagehandLogger } from "../../../extension/logger.js";
import { browserWebSocketFactory } from "../../../extension/understudy/browserWebSocketTransport.js";
import { BrowserContext } from "../../../extension/understudy/context.js";
import type { ElementChainTarget } from "../../../extension/understudy/elementChainResolver.js";
import { FrameChainResolver } from "../../../extension/understudy/frameChainResolver.js";
import { Locator } from "../../../extension/understudy/locator.js";
import type { Page } from "../../../extension/understudy/page.js";
import { Progress } from "../../../extension/understudy/progress.js";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { startFixtureServer, type FixtureServer } from "../integration/_support.js";

const query = (kind: "css" | "xpath" | "text", value: string): LocatorQueryStep => ({
  type: "query",
  selector: { kind, value },
});
const css = (value: string) => query("css", value);

describe("iframe chain resolution in Chrome", () => {
  let chrome: Awaited<ReturnType<typeof launchLocalBrowser>> | undefined;
  let context: BrowserContext | undefined;
  let fixture: FixtureServer;
  let page: Page;
  let resolver: FrameChainResolver;

  beforeAll(async () => {
    fixture = await startFixtureServer({
      "/": '<!doctype html><body><button id="outside">Outside</button><div id="ordinary"></div></body>',
      "/child": `<!doctype html><body><section><button id="save" onclick="this.dataset.clicked = 'yes'">Save</button></section>
        <div id="open"></div><div id="closed"></div><script>
        for (const mode of ['open', 'closed']) {
          document.getElementById(mode).attachShadow({mode}).innerHTML = '<button id="' + mode + '-save">Shadow save</button>';
        }
      </script></body>`,
      "/empty": "<!doctype html><body></body>",
      "/nested": () => {
        const url = new URL("/child", fixture.url);
        url.hostname = "grandchild.test";
        return `<!doctype html><iframe id="inner" src="${url.href}"></iframe>`;
      },
    });
    chrome = await launchLocalBrowser({
      headless: true,
      args: [
        "--host-resolver-rules=MAP child.test 127.0.0.1,MAP grandchild.test 127.0.0.1",
        "--site-per-process",
        "--no-proxy-server",
      ],
    });
    const version = (await fetch(`${chrome.cdpUrl}/json/version`).then((response) =>
      response.json(),
    )) as { webSocketDebuggerUrl: string };
    context = await BrowserContext.create(version.webSocketDebuggerUrl, {
      websocketFactory: browserWebSocketFactory,
      blankPageUrl: "about:blank",
      fallbackLocatorScriptSource: await readFile(
        new URL("../../../extension/dist/content-script.js", import.meta.url),
        "utf8",
      ),
      chromeTabs: {
        activeTargetId: async () => undefined,
        targetIdForTabId: async () => undefined,
        tabIdForTargetId: async () => undefined,
        activateTarget: async () => {},
      },
      logger: new StagehandLogger(
        { tracer: trace.getTracer("frame-chain-test") },
        () => {},
        undefined,
        "off",
      ),
    });
    await context.conn.send("Extensions.loadUnpacked", {
      path: fileURLToPath(new URL("../../../extension/dist", import.meta.url)),
    });
    page = context.pages()[0]!;
  }, 60_000);

  afterAll(async () => {
    try {
      await context?.close();
    } finally {
      try {
        await chrome?.close();
      } finally {
        await fixture?.close();
      }
    }
  });

  beforeEach(async () => {
    await page.goto(fixture.url);
    resolver = new FrameChainResolver(page);
  });

  async function addFrame(path = "/child", crossOrigin = false, id = "outer") {
    const url = new URL(path, fixture.url);
    if (crossOrigin) url.hostname = "child.test";
    await page.evaluate(
      ({ src, id }) =>
        new Promise<void>((resolve) => {
          const frame = document.createElement("iframe");
          frame.id = id;
          frame.onload = () => resolve();
          frame.src = src;
          document.body.append(frame);
        }),
      { src: url.href, id },
    );
  }

  async function resolve(steps: LocatorChain["steps"], mode: "all" | "count" = "all") {
    const progress = new Progress("test frame chain", 10_000);
    try {
      return await resolver.resolve({ steps }, { mode }, progress);
    } finally {
      progress.dispose();
    }
  }

  async function targets(steps: LocatorChain["steps"]) {
    const result = await resolve(steps);
    if (result.mode === "count") throw new Error("Expected targets");
    return result.targets;
  }

  async function ids(matches: ElementChainTarget[]) {
    return Promise.all(
      matches.map(async (target) => {
        const { node } = await target.session.send<{ node: { attributes: string[] } }>(
          "DOM.describeNode",
          { backendNodeId: target.backendNodeId },
        );
        return node.attributes[node.attributes.indexOf("id") + 1];
      }),
    );
  }

  it("targets the iframe element until another query enters its document", async () => {
    await addFrame();
    const [frame] = await targets([css("iframe")]);
    expect(await ids([frame])).toEqual(["outer"]);
    expect(frame.frameId).toBe(page.mainFrame().frameId);
    expect(await ids(await targets([css("button")]))).toEqual(["outside"]);
    const child = await targets([css("iframe"), css("section"), css("button")]);
    expect(await ids(child)).toEqual(["save"]);
    expect(child[0].frameId).not.toBe(frame.frameId);
    expect(child[0].session).toBe(frame.session);
  });

  it.each([
    query("css", "section button"),
    query("xpath", "//section/button"),
    query("text", "Save"),
  ])("uses the $selector.kind engine inside the child document", async (selector) => {
    await addFrame();
    const matches = await targets([css("iframe"), selector]);
    expect(await ids(matches)).toEqual(
      selector.selector.kind === "text" ? ["save", "open-save", "closed-save"] : ["save"],
    );
  });

  it.each([false, true])(
    "enters open & closed shadow roots inside a child (cross-origin: %s)",
    async (crossOrigin) => {
      await addFrame("/child", crossOrigin);
      expect(
        await ids(await targets([css("iframe"), css("#open, #closed"), css("button")])),
      ).toEqual(["open-save", "closed-save"]);
    },
  );

  it("enters nested same-origin documents one query at a time", async () => {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const outer = document.createElement("iframe");
          outer.onload = () => resolve();
          outer.srcdoc = '<iframe srcdoc="<button id=deep>Deep</button>"></iframe>';
          document.body.append(outer);
        }),
    );
    expect(await ids(await targets([css("iframe"), css("iframe"), css("button")]))).toEqual([
      "deep",
    ]);
  });

  it("resolves explicit frame hops & rejects an ordinary element as their source", async () => {
    await addFrame();
    expect(
      await ids(
        await targets([css("iframe"), { type: "frame", selector: css("section button").selector }]),
      ),
    ).toEqual(["save"]);
    await expect(
      targets([css("#ordinary"), { type: "frame", selector: css("button").selector }]),
    ).rejects.toThrow("Explicit frame hop requires an iframe or frame element");
    expect(
      await targets([css(".missing"), { type: "frame", selector: css("button").selector }]),
    ).toEqual([]);
  });

  it("retains every matched frame & stops at empty child results", async () => {
    await addFrame("/child", false, "first");
    await addFrame("/child", true, "second");
    expect(await resolve([css("iframe"), css("section button")], "count")).toEqual({
      mode: "count",
      count: 2,
    });
    expect(await ids(await targets([css("iframe"), css("section button")]))).toEqual([
      "save",
      "save",
    ]);
    await addFrame("/empty", false, "empty");
    expect(await targets([css("#empty"), css("button"), css("#outside")])).toEqual([]);
  });

  it.each(["/child", "/nested"])(
    "uses the owning OOPIF session & acts on the exact target (%s)",
    async (path) => {
      await addFrame(path, true);
      const steps: LocatorChain["steps"] =
        path === "/nested"
          ? [
              css("#outer"),
              { type: "frame", selector: css("#inner").selector },
              { type: "frame", selector: css("#save").selector },
            ]
          : [css("#outer"), css("#save")];
      const [target] = await targets(steps);
      expect(target.session).not.toBe(page.mainSession);
      expect(page.getSessionForFrame(target.frameId)).toBe(target.session);
      expect(await ids([target])).toEqual(["save"]);
      // Exercise the existing action machinery with the captured identity, even
      // after the page makes the original selector ambiguous.
      const frame = page.frameForId(target.frameId);
      await frame.evaluate(() => {
        const duplicate = document.createElement("button");
        duplicate.id = "save";
        duplicate.textContent = "Wrong button";
        document.body.prepend(duplicate);
      });
      const locator = new Locator(frame, "#save");
      locator.resolveNode = async () => {
        const { object } = await target.session.send<{ object: { objectId: string } }>(
          "DOM.resolveNode",
          { backendNodeId: target.backendNodeId },
        );
        return { objectId: object.objectId, nodeId: null };
      };
      await locator.click();
      expect(
        await frame.evaluate(() =>
          Array.from(
            document.querySelectorAll("#save"),
            (element) => (element as HTMLElement).dataset.clicked ?? "no",
          ),
        ),
      ).toEqual(["no", "yes"]);
    },
  );
});
