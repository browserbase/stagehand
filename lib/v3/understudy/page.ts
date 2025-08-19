import { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp";
import { Frame } from "./frame";

type LoadState = "load" | "domcontentloaded" | "networkidle";

export class Page {
  private frame: Frame;

  private constructor(
    private readonly session: CDPSessionLike,
    private readonly pageId: string,
    mainFrameId: string,
  ) {
    this.frame = new Frame(session, mainFrameId, pageId);
  }

  /**
   * Factory to create a Page bound to the top (main) CDP frame.
   * Calls Page.getFrameTree and anchors the Frame to its .frame.id (CDP frame id).
   */
  static async create(session: CDPSessionLike, pageId: string): Promise<Page> {
    await session.send("Page.enable");

    const { frameTree } = await session.send<{
      frameTree: Protocol.Page.FrameTree;
    }>("Page.getFrameTree");

    const mainFrameId = frameTree.frame.id; // CDP frame id (not a Playwright id)
    return new Page(session, pageId, mainFrameId);
  }

  /** Get current URL via Page.getNavigationHistory */
  async url(): Promise<string> {
    const { entries, currentIndex } =
      await this.session.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );

    return entries[currentIndex]?.url ?? "";
  }

  /** Navigate via Page.navigate; optionally wait for a lifecycle state */
  async goto(url: string, options?: { waitUntil?: LoadState }): Promise<void> {
    await this.session.send<Protocol.Page.NavigateResponse>("Page.navigate", {
      url,
    });
    if (options?.waitUntil) {
      await this.frame.waitForLoadState(options.waitUntil);
    }
  }

  /** Navigate back via Page.navigateToHistoryEntry */
  async goBack(): Promise<void> {
    const { entries, currentIndex } =
      await this.session.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );

    if (currentIndex > 0) {
      const targetEntry = entries[currentIndex - 1];
      await this.session.send("Page.navigateToHistoryEntry", {
        entryId: targetEntry.id,
      });
    }
  }

  /** Navigate forward via Page.navigateToHistoryEntry */
  async goForward(): Promise<void> {
    const { entries, currentIndex } =
      await this.session.send<Protocol.Page.GetNavigationHistoryResponse>(
        "Page.getNavigationHistory",
      );

    if (currentIndex < entries.length - 1) {
      const targetEntry = entries[currentIndex + 1];
      await this.session.send("Page.navigateToHistoryEntry", {
        entryId: targetEntry.id,
      });
    }
  }

  /** Reload via Page.reload; optionally wait for a lifecycle state */
  async reload(options?: {
    waitUntil?: Exclude<LoadState, "networkidle">;
  }): Promise<void> {
    await this.session.send("Page.reload", { ignoreCache: false });
    if (options?.waitUntil) {
      await this.frame.waitForLoadState(options.waitUntil);
    }
  }

  /** Take screenshot (delegates to the main Frame) */
  async screenshot(options?: { fullPage?: boolean }): Promise<string> {
    return this.frame.screenshot(options);
  }

  /** Add init script for new documents */
  async addInitScript(script: string): Promise<void> {
    await this.session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: script,
    });
  }

  /** Expose the main frame */
  mainFrame(): Frame {
    return this.frame;
  }

  /** Create a locator (delegates to main frame) */
  locator(selector: string): ReturnType<Frame["locator"]> {
    return this.frame.locator(selector);
  }

  /**
   * Optional helper in case you want to re-anchor after hard navigations:
   * re-reads Page.getFrameTree and updates the Frame binding.
   */
  async refreshMainFrame(): Promise<void> {
    const { frameTree } = await this.session.send<{
      frameTree: Protocol.Page.FrameTree;
    }>("Page.getFrameTree");
    this.frame = new Frame(this.session, frameTree.frame.id, this.pageId);
  }
}

/**
 * Utility JS snippets for scroll helpers (kept as-is)
 */
export const actHandlerUtils = {
  scrollToNextChunk: `
    window.scrollBy(0, window.innerHeight * 0.8);
  `,
  scrollToPreviousChunk: `
    window.scrollBy(0, -window.innerHeight * 0.8);
  `,
  scrollElementIntoView: `
    function(selector) {
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  `,
  scrollElementToPercentage: `
    function(selector, percentage) {
      const element = document.querySelector(selector);
      if (element) {
        const maxScroll = element.scrollHeight - element.clientHeight;
        element.scrollTop = (maxScroll * percentage) / 100;
      }
    }
  `,
};
