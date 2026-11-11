import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { createBrowserFactoriesForTest } from "../../src/browser/factories.js";
import { Stagehand } from "../../src/stagehand.js";
import { describe, expect, it } from "vitest";
import { launchLocalBrowser } from "../../src/browser/localBrowser.js";
import { CDPClient, openCDPWebSocket, resolveBrowserWebSocketUrl } from "../../src/cdpClient.js";
import { classifyActions } from "../../../extension/understudy/annotatedPageContent/actions.js";
import { formatAnnotatedPageContent } from "../../../extension/understudy/annotatedPageContent/format.js";
import { captureAnnotatedPageContent } from "../../../extension/understudy/annotatedPageContent/index.js";
import type { ContentAttributesJson } from "../../../extension/understudy/annotatedPageContent/common_quality_data_pb.js";
import type { CDPSessionLike } from "../../../extension/understudy/cdp.js";
import { runWithProgress } from "../../../extension/understudy/progress.js";

describe("Chromium annotated page content", () => {
  it("captures a real page with actionable metadata", async () => {
    const signal = AbortSignal.timeout(30_000);
    const chrome = await launchLocalBrowser({ headless: true }, signal);
    let client: CDPClient | undefined;
    try {
      const wsUrl = await resolveBrowserWebSocketUrl(chrome.cdpUrl, { signal });
      client = new CDPClient(await openCDPWebSocket(wsUrl, signal), wsUrl);
      const cdp = client;
      const html = `<!doctype html><title>APC fixture</title>
        <h1>Checkout</h1>
        <form>
          <label>Email <input name="email" type="email"></label>
          <label>Plan <select name="plan"><option>Basic</option><option>Pro</option></select></label>
          <button type="button">Pay</button>
          <input name="readonly" readonly value="Saved">
          <input name="disabled" disabled>
          <input name="aria-disabled" aria-disabled="true">
          <input name="date" type="date">
          <input name="color" type="color">
          <input name="range" type="range">
          <input name="upload" type="file">
          <textarea name="notes"></textarea>
          <div contenteditable="true" aria-label="Editor">Editable text</div>
          <div aria-label="Hover target" onmouseenter="this.dataset.entered = 'yes'">Hover me</div>
          <div aria-label="Focus target" tabindex="0">Focus only</div>
          <div aria-label="Scroll target" style="overflow: auto; height: 30px; width: 200px"><p style="height: 150px">Scrollable text</p></div>
        </form>`;
      const { targetId } = await cdp.sendCommand<{ targetId: string }>(
        "Target.createTarget",
        { url: "data:text/html," + encodeURIComponent(html) },
        undefined,
        signal,
      );
      const { sessionId } = await cdp.sendCommand<{ sessionId: string }>(
        "Target.attachToTarget",
        { targetId, flatten: true },
        undefined,
        signal,
      );
      await waitForDocument(cdp, sessionId);
      const session = {
        send: <T>(method: string, params?: object) =>
          cdp.sendCommand<T>(method, { ...params }, sessionId, signal),
      } as CDPSessionLike;
      const content = await runWithProgress({ name: "apc", timeout: 10_000 }, (progress) =>
        captureAnnotatedPageContent(session, progress),
      );
      expect(content.rootNode).toBeDefined();
      const pending = [content.rootNode!];
      const attributes: ContentAttributesJson[] = [];
      while (pending.length) {
        const node = pending.pop()!;
        if (node.contentAttributes) attributes.push(node.contentAttributes);
        pending.push(...(node.childrenNodes ?? []));
      }
      expect(attributes.some((entry) => entry.textData?.textContent?.includes("Checkout"))).toBe(
        true,
      );
      const email = attributes.find((entry) => entry.formControlData?.fieldName === "email");
      expect(email?.formControlData?.formControlType).toBe("FORM_CONTROL_TYPE_INPUT_EMAIL");
      expect(email?.commonAncestorDomNodeId).toBeGreaterThan(0);
      const { node: emailNode } = await session.send<{
        node: { localName: string; attributes: string[] };
      }>("DOM.describeNode", { backendNodeId: email!.commonAncestorDomNodeId });
      expect(emailNode.localName).toBe("input");
      expect(emailNode.attributes).toContain("email");
      expect(
        attributes.some((entry) => (entry.interactionInfo?.clickabilityReasons?.length ?? 0) > 0),
      ).toBe(true);
      const field = (name: string) =>
        attributes.find((entry) => entry.formControlData?.fieldName === name);
      expect(classifyActions(email)).toEqual(["click", "fill", "type"]);
      expect(classifyActions(field("readonly"))).toEqual([]);
      expect(classifyActions(field("disabled"))).toEqual([]);
      expect(classifyActions(field("aria-disabled"))).toEqual([]);
      for (const name of ["date", "color", "range"]) {
        expect(classifyActions(field(name)), name).toEqual(["click", "fill"]);
      }
      expect(classifyActions(field("upload"))).toEqual(["click", "upload"]);
      expect(classifyActions(field("notes"))).toEqual(["click", "fill", "type"]);
      const labeled = (label: string) => attributes.find((entry) => entry.label === label);
      expect(classifyActions(labeled("Editor"))).toEqual(["click", "fill", "type"]);
      expect(classifyActions(labeled("Hover target"))).toEqual(["hover"]);
      expect(classifyActions(labeled("Focus target"))).toEqual([]);
      expect(classifyActions(labeled("Scroll target"))).toEqual(["scroll"]);
      const formatted = formatAnnotatedPageContent(content, ["fill", "select"]);
      expect(formatted).toContain('input_email: "Email"');
      expect(formatted).not.toContain("Checkout");
      expect(formatted).toContain('option: "Basic"');
      expect(formatted).not.toContain('name="disabled"');
      expect(formatted).not.toContain('name="readonly"');
      expect(formatted).not.toContain("Hover me");
      const select = attributes.find((entry) => entry.formControlData?.fieldName === "plan");
      expect(select?.formControlData?.selectOptions?.map((option) => option.text)).toEqual([
        "Basic",
        "Pro",
      ]);
    } finally {
      client?.close();
      await chrome.close();
    }
  }, 45_000);
});

async function waitForDocument(client: CDPClient, sessionId: string) {
  await expect
    .poll(
      async () => {
        const { result } = await client.sendCommand<{ result: { value?: string } }>(
          "Runtime.evaluate",
          { expression: "document.readyState", returnByValue: true },
          sessionId,
        );
        return result.value;
      },
      { timeout: 10_000 },
    )
    .toBe("complete");
}

describe("APC actionable IDs through the SDK", () => {
  it("shares snapshot IDs and resolves actions in the main document and child frames", async () => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html");
      if (request.url === "/child") {
        response.end(
          '<label>Child field<input id="field"></label><button onclick="this.textContent=\'Clicked child\'">Child button</button>',
        );
      } else {
        const address = server.address() as AddressInfo;
        response.end(
          '<label>Main field<input id="field"></label><button onclick="this.textContent=\'Clicked main\'">Main button</button>' +
            '<iframe src="/child"></iframe><iframe src="http://localhost:' +
            address.port +
            '/child"></iframe>' +
            '<div id="shadow"></div><script>document.querySelector("#shadow").attachShadow({mode:"open"}).innerHTML = \'<button onclick="this.textContent=String(123)">Shadow button</button>\';</script>',
        );
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const signal = AbortSignal.timeout(60_000);
    const chrome = await launchLocalBrowser({ headless: true }, signal);
    let stagehand: Stagehand | undefined;
    try {
      const { localBrowser } = createBrowserFactoriesForTest({
        connectCdp: (options) =>
          CDPClient.connect({
            ...options,
            localExtensionDir: fileURLToPath(new URL("../../../extension/dist", import.meta.url)),
          }),
      });
      const browser = await localBrowser.connect({ cdpUrl: chrome.cdpUrl });
      stagehand = await Stagehand.create({
        browser,
        model: {
          generate: async () => {
            throw new Error("APC must not call a model");
          },
        },
      });
      const page = await browser.context.newPage();
      await page.goto("http://127.0.0.1:" + (server.address() as AddressInfo).port, {
        waitUntil: "load",
      });
      const output = await page.apc({ actions: ["click", "fill"] });
      const full = await page.apc();
      expect(output).not.toContain("apc-");
      expect(output).not.toContain("container");
      expect(full).not.toContain("url=");
      const snapshot = await page.snapshot({ includeIframes: true });
      const lines = output.split("\n");
      const fields = lines.filter((line) => line.includes("input_text"));
      expect(fields).toHaveLength(3);
      const ids = fields.map((line) => line.match(/^\[(\d+-\d+)\]/)![1]!);
      expect(new Set(ids.map((id) => id.split("-")[0])).size).toBe(3);
      for (let index = 0; index < ids.length; index++) {
        const selector = snapshot.xpathMap[ids[index]!]!;
        expect(selector).toBeTruthy();
        const field = page.locator(selector);
        await field.fill("field-" + index);
        expect(await field.inputValue()).toBe("field-" + index);
      }
      const buttons = lines.filter((line) => line.includes("button"));
      expect(buttons).toHaveLength(4);
      for (const line of buttons) {
        const id = line.match(/^\[(\d+-\d+)\]/)![1]!;
        const selector = snapshot.xpathMap[id]!;
        expect(selector).toBeTruthy();
        const button = page.locator(selector);
        await button.click();
        expect(await button.textContent()).toMatch(/Clicked|123/);
      }
    } finally {
      await stagehand?.close();
      await chrome.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 60_000);
});
