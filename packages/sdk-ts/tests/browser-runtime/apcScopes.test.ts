/// <reference types="chrome" />

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { trace } from "@opentelemetry/api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { resolveBrowserWebSocketUrl } from "../../src/cdpClient.js";
import { StagehandLogger } from "../../../extension/logger.js";
import { BrowserContext } from "../../../extension/understudy/context.js";
import { CdpConnection } from "../../../extension/understudy/cdp.js";
import { browserWebSocketFactory } from "../../../extension/understudy/browserWebSocketTransport.js";
import type { Frame } from "../../../extension/understudy/frame.js";
import type { Page } from "../../../extension/understudy/page.js";
import {
  ChainTargetLocator,
  resolveLocatorChain,
  type ChainTarget,
} from "../../../extension/understudy/locatorChain.js";
import { runWithProgress } from "../../../extension/understudy/progress.js";
import { resolveContentFrame } from "../../../extension/understudy/frameLocator.js";
import { formatAnnotatedPageContent } from "../../../extension/understudy/annotatedPageContent/format.js";

describe("APC locator scopes in Chromium", () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/child") {
      response.end('<div id="child-scope"><label>Child field<input name="child"></label></div>');
      return;
    }
    const port = (server.address() as AddressInfo).port;
    response.end(`<!doctype html><title>Scoped APC</title>
      <label for="email">External email label</label>
      <input name="outside">
      <div id="scope" style="display:contents">
        <input id="email" name="email">
        <section id="nested"><input name="nested"></section>
        <div id="shadow"></div>
        <iframe id="same" src="/child"></iframe>
        <iframe id="cross" src="http://localhost:${port}/child"></iframe>
      </div>
      <div id="closed"></div>
      <section id="native">
        <label for="resume">Resume PDF</label>
        <input id="resume" name="resume" type="file" accept=".pdf,application/pdf" multiple>
        <label>Portrait<input name="portrait" type="file" accept="image/*"></label>
        <div id="hidden-uploads">
        <label for="hidden-upload">Hidden attachments</label>
        <input id="hidden-upload" name="hidden-upload" type="file" hidden multiple>
        <input name="display-none-upload" type="file" style="display:none">
        </div>
        <label>Plan<select name="plan"><option value="basic" selected>Basic</option><option value="pro">Pro</option><option disabled value="closed">Closed</option></select></label>
        <label>Add-ons<select name="addons" multiple><option value="a">Alpha</option><option value="b">Beta</option></select></label>
      </section>
      <script>
        document.querySelector("#shadow").attachShadow({mode:"open"}).innerHTML =
          '<div id="inner"><input name="shadow"></div>';
        document.querySelector("#closed").attachShadow({mode:"closed"}).innerHTML =
          '<input name="closed">';
      </script>`);
  });
  let chrome: Awaited<ReturnType<typeof launchLocalBrowser>> | undefined;
  let context: BrowserContext | undefined;
  let page: Page;
  let roots: Record<string, ChainTarget>;
  const names = (query: Awaited<ReturnType<Page["queryAnnotatedPageContent"]>>) =>
    query.nodes.map((node) => node.source.contentAttributes?.formControlData?.fieldName);

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const signal = AbortSignal.timeout(30_000);
    chrome = await launchLocalBrowser({ headless: true }, signal);
    const url = await resolveBrowserWebSocketUrl(chrome.cdpUrl, { signal });
    const logger = new StagehandLogger({ tracer: trace.getTracer("apc-scopes") }, () => {});
    const connection = await CdpConnection.connect(url, browserWebSocketFactory, logger);
    // Use the real extension world, including its access to closed shadow roots.
    const { id: extensionId } = await connection.send<{ id: string }>("Extensions.loadUnpacked", {
      path: fileURLToPath(new URL("../../../extension/dist", import.meta.url)),
    });
    context = new BrowserContext(
      connection,
      logger,
      {
        activeTargetId: async () => undefined,
        targetIdForTabId: async () => undefined,
        tabIdForTargetId: async () => undefined,
        activateTarget: async () => {},
      },
      "LOCAL",
      null,
      "chrome-extension://" + extensionId + "/blank.html",
      readFileSync(new URL("../../../extension/dist/content-script.js", import.meta.url), "utf8"),
    );
    await context.bootstrap();
    page = await context.newPage();
    await page.goto("http://127.0.0.1:" + (server.address() as AddressInfo).port, {
      waitUntil: "load",
    });
    roots = {};
    await runWithProgress({ name: "roots", timeout: 10_000 }, async (progress) => {
      for (const id of ["scope", "nested", "shadow", "closed", "email", "same", "cross"]) {
        const matches = await resolveLocatorChain(
          page,
          page.mainFrame(),
          {
            steps: [{ type: "query", selector: { type: "css", value: "#" + id } }],
          },
          progress,
        );
        expect(matches).toHaveLength(1);
        roots[id] = matches[0]!;
      }
    });
  }, 30_000);

  afterAll(async () => {
    await context?.close();
    await chrome?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("uses DOM descendants across flattened and shadow wrappers and retains external labels", async () => {
    const capture = vi.spyOn(page, "captureAnnotatedPageContent");
    try {
      const query = await page.queryAnnotatedPageContent({
        actions: ["fill"],
        scopes: [
          { type: "element", target: roots.nested! },
          { type: "element", target: roots.scope! },
          { type: "element", target: roots.shadow! },
        ],
      });
      expect(capture).toHaveBeenCalledTimes(1);
      expect(names(query)).toEqual(["email", "nested", "shadow"]);
      expect(query.targetsById.size).toBe(3);
      expect(formatAnnotatedPageContent(query)).toContain("External email label");
      // Execute directly from the shared target map, without a selector lookup or snapshot.
      const target = query.targetsById.get(query.nodes[0]!.id!)!;
      const locator = new ChainTargetLocator(target, { type: "css", value: "#email" });
      await locator.fill("scoped@example.com");
      expect(await locator.inputValue()).toBe("scoped@example.com");
      expect(capture).toHaveBeenCalledTimes(1);
      const self = await page.queryAnnotatedPageContent({
        actions: ["fill"],
        scopes: [{ type: "element", target: roots.email! }],
      });
      expect(self.nodes).toEqual([]);
      const closed = await page.queryAnnotatedPageContent({
        actions: ["fill"],
        scopes: [{ type: "element", target: roots.closed! }],
      });
      expect(names(closed)).toEqual(["closed"]);
    } finally {
      capture.mockRestore();
    }
  });

  it("restricts document and iframe scopes to the owning frame, including OOPIFs", async () => {
    const main = await page.queryAnnotatedPageContent({
      actions: ["fill"],
      scopes: [{ type: "document", frame: page.mainFrame() }],
    });
    expect(names(main)).toEqual(["outside", "email", "nested", "shadow", "closed"]);
    await runWithProgress({ name: "frames", timeout: 10_000 }, async (progress) => {
      const frames: Frame[] = [];
      for (const id of ["same", "cross"]) {
        const owner = roots[id]!;
        const frame = await resolveContentFrame(page, owner.frame, owner.backendNodeId, progress);
        frames.push(frame);
        const query = await page.queryAnnotatedPageContent(
          {
            actions: ["fill"],
            scopes: [{ type: "frame", target: owner }],
          },
          progress,
        );
        expect(names(query)).toEqual(["child"]);
        const target = query.targetsById.get(query.nodes[0]!.id!)!;
        expect(target.frame.frameId).toBe(frame.frameId);
        const locator = new ChainTargetLocator(target, { type: "css", value: "input" });
        await locator.fill(id, progress);
        expect(await locator.inputValue(progress)).toBe(id);
        const document = await page.queryAnnotatedPageContent(
          {
            actions: ["fill"],
            scopes: [{ type: "document", frame }],
          },
          progress,
        );
        expect(document.nodes.map((node) => node.id)).toEqual(query.nodes.map((node) => node.id));
        const [childRoot] = await resolveLocatorChain(
          page,
          frame,
          {
            steps: [{ type: "query", selector: { type: "css", value: "#child-scope" } }],
          },
          progress,
        );
        const descendants = await page.queryAnnotatedPageContent(
          {
            actions: ["fill"],
            scopes: [{ type: "element", target: childRoot! }],
          },
          progress,
        );
        expect(descendants.nodes.map((node) => node.id)).toEqual(
          query.nodes.map((node) => node.id),
        );
      }
      expect(frames[0]!.session.id).toBe(page.mainFrame().session.id);
      expect(frames[1]!.session.id).not.toBe(page.mainFrame().session.id);
      const union = await page.queryAnnotatedPageContent(
        {
          actions: ["fill"],
          scopes: [
            { type: "frame", target: roots.cross! },
            { type: "frame", target: roots.same! },
            { type: "frame", target: roots.same! },
          ],
        },
        progress,
      );
      expect(names(union)).toEqual(["child", "child"]);
      expect([...union.targetsById.values()].map((target) => target.frame.frameId)).toEqual(
        frames.map((frame) => frame.frameId),
      );
    });
  });

  it("prepares upload choices with labels and constraints, then uses normal file assignment", async () => {
    const capture = vi.spyOn(page, "captureAnnotatedPageContent");
    try {
      const result = await page.queryAnnotatedPageContentCandidates({ operation: "setInputFiles" });
      expect(capture).toHaveBeenCalledTimes(1);
      expect(result.candidates).toHaveLength(2);
      expect(result.limitations).toContain("hidden-file-inputs");
      const resume = result.candidates.find((candidate) =>
        candidate.description.includes("Resume PDF"),
      )!;
      const portrait = result.candidates.find((candidate) =>
        candidate.description.includes("Portrait"),
      )!;
      expect(resume.description).toContain('accept=".pdf,application/pdf"');
      expect(resume.description).toContain("multiple");
      expect(portrait.description).toContain('accept="image/*"');
      expect(portrait.description).not.toContain("multiple");
      expect(result.unresolvedCount).toBe(0);
      const locator = new ChainTargetLocator(result.targetsById.get(resume.id)!, {
        type: "css",
        value: "#resume",
      });
      await locator.setInputFiles([
        { name: "one.pdf", mimeType: "application/pdf", buffer: new TextEncoder().encode("one") },
        { name: "two.pdf", mimeType: "application/pdf", buffer: new TextEncoder().encode("two") },
      ]);
      expect(
        await page.evaluate(() =>
          Array.from(
            document.querySelector<HTMLInputElement>("#resume")!.files!,
            (file) => file.name,
          ),
        ),
      ).toEqual(["one.pdf", "two.pdf"]);
      expect(capture).toHaveBeenCalledTimes(1);
      await locator.setInputFiles([]);
      expect(
        await page.evaluate(
          () => document.querySelector<HTMLInputElement>("#resume")!.files!.length,
        ),
      ).toBe(0);
    } finally {
      capture.mockRestore();
    }
  });

  it("reports incomplete hidden-upload discovery instead of treating it as a definitive no match", async () => {
    await runWithProgress({ name: "hidden upload", timeout: 10_000 }, async (progress) => {
      const [root] = await resolveLocatorChain(
        page,
        page.mainFrame(),
        {
          steps: [{ type: "query", selector: { type: "css", value: "#hidden-uploads" } }],
        },
        progress,
      );
      const result = await page.queryAnnotatedPageContentCandidates(
        {
          operation: "setInputFiles",
          scopes: [{ type: "element", target: root! }],
        },
        progress,
      );
      expect(result.candidates).toEqual([]);
      expect(result.unresolvedCount).toBe(0);
      expect(result.limitations).toContain("hidden-file-inputs");
      // Both omitted controls are nevertheless usable by the ordinary upload action.
      for (const name of ["hidden-upload", "display-none-upload"]) {
        const selector = { type: "css" as const, value: 'input[name="' + name + '"]' };
        const [target] = await resolveLocatorChain(
          page,
          page.mainFrame(),
          {
            steps: [{ type: "query", selector }],
          },
          progress,
        );
        await new ChainTargetLocator(target!, selector).setInputFiles(
          {
            name: "hidden.txt",
            mimeType: "text/plain",
            buffer: new TextEncoder().encode("hidden"),
          },
          progress,
        );
      }
      expect(
        await page.evaluate(() =>
          Array.from(
            document.querySelectorAll<HTMLInputElement>("#hidden-uploads input"),
            (input) => input.files![0]?.name,
          ),
        ),
      ).toEqual(["hidden.txt", "hidden.txt"]);
    });
  });

  it("prepares native single and multiple select choices with option values and selected state", async () => {
    const result = await page.queryAnnotatedPageContentCandidates({ operation: "selectOption" });
    expect(result.candidates).toHaveLength(2);
    const single = result.candidates.find((candidate) =>
      candidate.description.startsWith("select_one"),
    )!;
    const multiple = result.candidates.find((candidate) =>
      candidate.description.startsWith("select_multiple"),
    )!;
    expect(single.description).toContain('option: "Basic" [value="basic"; selected]');
    expect(single.description).toContain('option: "Pro" [value="pro"; unselected]');
    expect(multiple.description).toContain('option: "Alpha" [value="a"; unselected]');
    expect(result.limitations).toContain("select-option-disabled-state");
    expect(single.description).not.toContain("disabled");
    const select = new ChainTargetLocator(result.targetsById.get(single.id)!, {
      type: "css",
      value: "select",
    });
    expect(await select.selectOption("pro")).toEqual(["pro"]);
    const multiSelect = new ChainTargetLocator(result.targetsById.get(multiple.id)!, {
      type: "css",
      value: "select",
    });
    expect(await multiSelect.selectOption(["a", "b"])).toEqual(["a", "b"]);
  });
});
