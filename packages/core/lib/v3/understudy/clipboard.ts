import type { Protocol } from "devtools-protocol";
import type { V3Context } from "./context.js";
import type { Page } from "./page.js";
import type {
  BrowserClipboard,
  ClipboardOptions,
  ClipboardPasteOptions,
} from "../types/public/clipboard.js";
import { StagehandEvalError } from "../types/public/sdkErrors.js";
import { FlowLogger } from "../flowlogger/FlowLogger.js";

type ContextClipboardParams = {
  context: V3Context;
  resolvePage: (page?: Page) => Promise<Page>;
};

export class ContextClipboard implements BrowserClipboard {
  constructor(private readonly params: ContextClipboardParams) {}

  @FlowLogger.wrapWithLogging({ eventType: "ClipboardWriteText" })
  async writeText(text: string, options?: ClipboardOptions): Promise<void> {
    await this.writeTextInternal(text, options);
  }

  private async writeTextInternal(
    text: string,
    options?: ClipboardOptions,
  ): Promise<void> {
    const page = await this.resolvePage(options?.page);
    await this.ensurePageFocused(page);
    await this.grantClipboardPermissions(page);
    await page.sendCDP("Runtime.enable").catch(() => {});
    const response = await page.sendCDP<Protocol.Runtime.EvaluateResponse>(
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

  @FlowLogger.wrapWithLogging({ eventType: "ClipboardReadText" })
  async readText(options?: ClipboardOptions): Promise<string> {
    const page = await this.resolvePage(options?.page);
    await this.ensurePageFocused(page);
    await this.grantClipboardPermissions(page);
    await page.sendCDP("Runtime.enable").catch(() => {});
    const response = await page.sendCDP<Protocol.Runtime.EvaluateResponse>(
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

  @FlowLogger.wrapWithLogging({ eventType: "ClipboardClear" })
  async clear(options?: ClipboardOptions): Promise<void> {
    await this.writeTextInternal("", options);
  }

  @FlowLogger.wrapWithLogging({ eventType: "ClipboardPaste" })
  async paste(options?: ClipboardPasteOptions): Promise<void> {
    const page = await this.resolvePage(options?.page);
    await this.ensurePageFocused(page);
    await page.keyPress(options?.shortcut ?? "ControlOrMeta+V");
  }

  @FlowLogger.wrapWithLogging({ eventType: "ClipboardCopy" })
  async copy(options?: ClipboardOptions): Promise<void> {
    const page = await this.resolvePage(options?.page);
    await this.ensurePageFocused(page);
    await page.keyPress("ControlOrMeta+C");
  }

  @FlowLogger.wrapWithLogging({ eventType: "ClipboardCut" })
  async cut(options?: ClipboardOptions): Promise<void> {
    const page = await this.resolvePage(options?.page);
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
    await page.sendCDP("Page.bringToFront").catch(() => {});
    await page.sendCDP("Runtime.enable").catch(() => {});
    await page
      .sendCDP("Runtime.evaluate", {
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
