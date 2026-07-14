import type { Protocol } from "devtools-protocol";
import type { V3Context } from "./context.js";
import type { Page } from "./page.js";
import type { ClipboardOptions, ClipboardPasteOptions } from "../../protocol/types.js";
import { StagehandEvalError } from "../errors.js";

type ContextClipboardParams = {
  context: V3Context;
  resolvePage: (page?: Page) => Promise<Page>;
};

// TODO(runtime-cleanup): Hydrate ClipboardOptions.locator instead of always
// resolving the active Understudy page.
export class ContextClipboard {
  constructor(private readonly params: ContextClipboardParams) {}
  async writeText(text: string, options?: ClipboardOptions): Promise<void> {
    await this.writeTextInternal(text, options);
  }

  private async writeTextInternal(text: string, options?: ClipboardOptions): Promise<void> {
    void options;
    const page = await this.resolvePage();
    await this.ensurePageFocused(page);
    await this.grantClipboardPermissions(page);
    await page.sendInternalCDP("Runtime.enable").catch(() => {});
    const response = await page.sendInternalCDP<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      {
        expression: `navigator.clipboard.writeText(${JSON.stringify(text)})`,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      },
    );
    this.throwIfEvaluationFailed("write clipboard text", response);
  }
  async readText(options?: ClipboardOptions): Promise<string> {
    void options;
    const page = await this.resolvePage();
    await this.ensurePageFocused(page);
    await this.grantClipboardPermissions(page);
    await page.sendInternalCDP("Runtime.enable").catch(() => {});
    const response = await page.sendInternalCDP<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      {
        expression: "navigator.clipboard.readText()",
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      },
    );
    this.throwIfEvaluationFailed("read clipboard text", response);

    return String(response.result?.value ?? "");
  }
  async clear(options?: ClipboardOptions): Promise<void> {
    await this.writeTextInternal("", options);
  }
  async paste(options?: ClipboardPasteOptions): Promise<void> {
    const page = await this.resolvePage();
    await this.ensurePageFocused(page);
    await page.keyPress(options?.shortcut ?? "ControlOrMeta+V");
  }
  async copy(options?: ClipboardOptions): Promise<void> {
    void options;
    const page = await this.resolvePage();
    await this.ensurePageFocused(page);
    await page.keyPress("ControlOrMeta+C");
  }
  async cut(options?: ClipboardOptions): Promise<void> {
    void options;
    const page = await this.resolvePage();
    await this.ensurePageFocused(page);
    await page.keyPress("ControlOrMeta+X");
  }

  private async resolvePage(page?: Page): Promise<Page> {
    return await this.params.resolvePage(page);
  }

  private async grantClipboardPermissions(page: Page): Promise<void> {
    const origin = this.originForPage(page);
    if (!origin) return;

    await this.params.context.conn
      .send("Browser.grantPermissions", {
        origin,
        permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
      })
      .catch(() => {});
  }

  private async ensurePageFocused(page: Page): Promise<void> {
    this.params.context.setActivePage(page);
    await page.sendInternalCDP("Page.bringToFront").catch(() => {});
    await page.sendInternalCDP("Runtime.enable").catch(() => {});
    await page
      .sendInternalCDP("Runtime.evaluate", {
        expression: "window.focus()",
        awaitPromise: true,
        userGesture: true,
      })
      .catch(() => {});
  }

  private originForPage(page: Page): string | undefined {
    try {
      const parsed = new URL(page.url());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return undefined;
      }
      return parsed.origin;
    } catch {
      return undefined;
    }
  }

  private throwIfEvaluationFailed(
    operation: string,
    response: Protocol.Runtime.EvaluateResponse,
  ): void {
    if (!response.exceptionDetails) return;

    const message =
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.text ??
      "Runtime.evaluate failed";
    throw new StagehandEvalError(`Failed to ${operation}: ${message}`);
  }
}
