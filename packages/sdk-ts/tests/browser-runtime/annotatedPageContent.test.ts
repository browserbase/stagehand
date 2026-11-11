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
      expect(formatted).toContain('name="email"');
      expect(formatted).toContain("Email");
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
