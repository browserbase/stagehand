/// <reference types="chrome" />

import { trace } from "@opentelemetry/api";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocatorChain, LocatorQueryStep } from "@browserbasehq/stagehand-protocol/types";
import type { ElementChainResolution } from "../../../extension/dom/locatorScripts/resolveElementChain.js";
import type { CDPSessionLike } from "../../../extension/understudy/cdp.js";
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

  afterEach(() => vi.restoreAllMocks());

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

  async function resolve(
    steps: LocatorChain["steps"],
    mode: "all" | "count" | ElementChainResolution = "all",
  ) {
    const progress = new Progress("test frame chain", 10_000);
    try {
      return await resolver.resolve(
        { steps },
        typeof mode === "string" ? { mode } : mode,
        progress,
      );
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
      const frame = page.frameForId(target.frameId);
      // Make selector re-resolution pick the wrong button.
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
  async function mixedScopes() {
    await page.evaluate(() => {
      document.body.innerHTML = '<section class="scope"><button id="a">Save</button></section>';
    });
    await addFrame("/child", true);
    await page.evaluate(() => {
      document.querySelector("iframe")!.className = "scope";
      document.body.insertAdjacentHTML(
        "beforeend",
        '<section class="scope"><button id="b">Save</button></section>',
      );
    });
  }

  it("preserves mixed-document scope order in all, count, first & nth modes", async () => {
    await mixedScopes();
    const steps: LocatorChain["steps"] = [css(".scope"), css("button")];
    const all = await targets(steps);
    expect(await ids(all)).toEqual(["a", "save", "open-save", "closed-save", "b"]);
    expect(await resolve(steps, "count")).toEqual({ mode: "count", count: 5 });
    for (const index of [0, 1, 4, 5]) {
      const selected = await resolve(steps, { mode: "selected", index });
      expect(selected).toEqual({ mode: "selected", targets: all.slice(index, index + 1) });
    }
    expect(await ids(await targets([...steps, { type: "nth", index: 4 }]))).toEqual(["b"]);
    expect(
      await ids(await targets([css(".scope"), { type: "nth", index: 1 }, css("#save")])),
    ).toEqual(["save"]);
    expect(await targets([css(".scope"), { type: "nth", index: 9 }, css("button")])).toEqual([]);
  });

  it("deduplicates overlapping scopes by document identity before selecting positions", async () => {
    await mixedScopes();
    await page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<section class="scope"><div class="scope"><button id="same">Save</button><button id="same">Save</button></div></section>',
      );
    });
    const steps: LocatorChain["steps"] = [css(".scope, body"), css("button")];
    const all = await targets(steps);
    // body comes first, so its ordinary descendants precede the child document.
    expect(await ids(all)).toEqual(["a", "b", "same", "same", "save", "open-save", "closed-save"]);
    expect(all[2].backendNodeId).not.toBe(all[3].backendNodeId);
    expect(await ids(await targets([...steps, { type: "nth", index: 4 }]))).toEqual(["save"]);
  });

  function recordTraffic() {
    const calls: {
      session: CDPSessionLike;
      method: string;
      params?: Record<string, unknown>;
      result?: unknown;
    }[] = [];
    const spies = [...page.sessions.values()].map((session) => {
      const send = session.send.bind(session);
      return vi.spyOn(session, "send").mockImplementation(async (method, params) => {
        const call: (typeof calls)[number] = {
          session,
          method,
          params: params as Record<string, unknown>,
        };
        calls.push(call);
        const result = await send(method, params);
        call.result = result;
        return result;
      });
    });
    return { calls, stop: () => spies.forEach((spy) => spy.mockRestore()) };
  }

  it.each([query("css", "button"), query("text", "Save"), query("xpath", ".//button")])(
    "batches $selector.kind scopes at 500 & 1,000 matches per document",
    async (selector) => {
      await mixedScopes();
      const [childTarget] = await targets([css("iframe"), css("#save")]);
      const child = page.frameForId(childTarget.frameId);
      for (const size of [500, 1000]) {
        await page.evaluate((size) => {
          for (const [side, section] of Array.from(
            document.querySelectorAll("section"),
          ).entries()) {
            section.innerHTML = Array.from(
              { length: size / 2 },
              (_, i) =>
                '<div class="card"><button id="main-' +
                ((side * size) / 2 + i) +
                '">Save</button></div>',
            ).join("");
          }
        }, size);
        await child.evaluate((size) => {
          document.body.innerHTML = Array.from(
            { length: size },
            (_, i) => '<div class="card"><button id="child-' + i + '">Save</button></div>',
          ).join("");
        }, size);
        const steps: LocatorChain["steps"] = [css(".card, iframe"), selector];
        for (const mode of [
          { mode: "count" },
          { mode: "selected", index: 0 },
          { mode: "selected", index: 2 * size - 1 },
          { mode: "all" },
        ] satisfies ElementChainResolution[]) {
          const traffic = recordTraffic();
          let result;
          try {
            result = await resolve(steps, mode);
          } finally {
            traffic.stop();
          }
          const queries = traffic.calls.filter((call) =>
            String(call.params?.functionDeclaration).includes("this.query("),
          );
          expect(queries).toHaveLength(3); // initial main query, main scopes, child document
          // One describe enters the iframe; only requested final targets add describes.
          expect(traffic.calls.filter((call) => call.method === "DOM.describeNode")).toHaveLength(
            1 + (mode.mode === "count" ? 0 : mode.mode === "all" ? 2 * size : 1),
          );
          if (result.mode === "count") expect(result.count).toBe(2 * size);
          else if (mode.mode === "selected")
            expect(await ids(result.targets)).toEqual([
              mode.index === 0 ? "main-0" : "main-" + (size - 1),
            ]);
          else
            expect(await ids(result.targets)).toEqual([
              ...Array.from({ length: size / 2 }, (_, i) => "main-" + i),
              ...Array.from({ length: size }, (_, i) => "child-" + i),
              ...Array.from({ length: size / 2 }, (_, i) => "main-" + (size / 2 + i)),
            ]);
        }
      }
    },
    30_000,
  );

  it("releases temporary objects in every session while consumer handles stay usable", async () => {
    await mixedScopes();
    const steps: LocatorChain["steps"] = [css(".scope"), css("button")];
    const traffic = recordTraffic();
    let matches: ElementChainTarget[];
    try {
      matches = await targets(steps);
    } finally {
      traffic.stop();
    }
    const sessions = new Set(matches.map((target) => target.session));
    expect(sessions.size).toBe(2);
    for (const session of sessions) {
      expect(
        traffic.calls.filter(
          (call) => call.session === session && call.method === "Runtime.releaseObjectGroup",
        ),
      ).toHaveLength(1);
    }
    for (const call of traffic.calls) {
      const response = call.result as { result?: { objectId?: string } } | undefined;
      if (!call.params?.objectGroup || !response?.result?.objectId) continue;
      await expect(
        call.session.send("Runtime.callFunctionOn", {
          objectId: response.result.objectId,
          functionDeclaration: "function() { return true; }",
        }),
      ).rejects.toThrow();
    }
    const target = matches[1];
    const { object } = await target.session.send<{ object: { objectId: string } }>(
      "DOM.resolveNode",
      { backendNodeId: target.backendNodeId },
    );
    try {
      await resolve(steps, "count");
      const result = await target.session.send<{ result: { value: string } }>(
        "Runtime.callFunctionOn",
        {
          objectId: object.objectId,
          functionDeclaration: "function() { return this.id; }",
          returnByValue: true,
        },
      );
      expect(result.result.value).toBe("save");
    } finally {
      await target.session.send("Runtime.releaseObject", { objectId: object.objectId });
    }
  });

  it("rejects an iframe removed after matching but before entry", async () => {
    await addFrame();
    const send = page.mainSession.send.bind(page.mainSession);
    let removed = false;
    vi.spyOn(page.mainSession, "send").mockImplementation(async (method, params) => {
      const result = await send(method, params);
      if (
        !removed &&
        method === "Runtime.callFunctionOn" &&
        String((params as { functionDeclaration?: string }).functionDeclaration).includes(
          "this.query(",
        )
      ) {
        removed = true;
        await page.evaluate(() => document.querySelector("iframe")!.remove());
      }
      return result;
    });
    await expect(targets([css("iframe"), css("button")])).rejects.toThrow(
      "Chain iframe detached before entry",
    );
  });

  it.each(["detach", "navigate"])(
    "rejects %s during a child query & cleans both sessions",
    async (change) => {
      await addFrame("/child", true);
      const [target] = await targets([css("iframe"), css("#save")]);
      const send = target.session.send.bind(target.session);
      let changed = false;
      const releases: string[] = [];
      const parentSend = page.mainSession.send.bind(page.mainSession);
      vi.spyOn(page.mainSession, "send").mockImplementation(async (method, params) => {
        if (method === "Runtime.releaseObjectGroup") releases.push("main");
        return parentSend(method, params);
      });
      vi.spyOn(target.session, "send").mockImplementation(async (method, params) => {
        if (method === "Runtime.releaseObjectGroup") releases.push("child");
        const result = await send(method, params);
        if (
          !changed &&
          method === "Runtime.callFunctionOn" &&
          String((params as { functionDeclaration?: string }).functionDeclaration).includes(
            "this.query(",
          )
        ) {
          changed = true;
          if (change === "detach") {
            await page.evaluate(() => document.querySelector("iframe")!.remove());
            await expect.poll(() => page.registry.frames.has(target.frameId)).toBe(false);
          } else {
            const oldLoader = page.registry.frames.get(target.frameId)?.lastSeen?.loaderId;
            await page.evaluate(
              (url) =>
                new Promise<void>((resolve) => {
                  const iframe = document.querySelector("iframe")!;
                  iframe.onload = () => resolve();
                  iframe.src = url;
                }),
              new URL("/child", fixture.url).href,
            );
            await expect
              .poll(() => page.registry.frames.get(target.frameId)?.lastSeen?.loaderId)
              .not.toBe(oldLoader);
          }
        }
        return result;
      });
      await expect(targets([css("iframe"), css("#save")])).rejects.toThrow(
        /Chain frame (detached|changed)/,
      );
      expect(releases).toEqual(expect.arrayContaining(["main", "child"]));
    },
  );
});
