import { CDPSession, Protocol } from "devtools-protocol";

interface FrameManager {
  session: CDPSession;
  frameId: string;
  pageId: string;
}

class Frame implements FrameManager {
  constructor(
    public session: CDPSession,
    public frameId: string,
    public pageId: string,
  ) {}

  /**
   * Get DOM node at specific coordinates
   * Maps to: DOM.getNodeForLocation
   */
  async getNodeAtLocation(x: number, y: number): Promise<Protocol.DOM.Node> {
    const { backendNodeId, frameId } = await this.session.send(
      "DOM.getNodeForLocation",
      {
        x,
        y,
        includeUserAgentShadowDOM: true,
        ignorePointerEventsNone: false,
      },
    );

    const { node } = await this.session.send("DOM.describeNode", {
      backendNodeId,
    });

    return node;
  }

  /**
   * Get bounding box for CSS selector
   * Maps to: CSS selector -> DOM.querySelector -> DOM.getBoxModel
   */
  async getLocationForSelector(
    selector: string,
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    // First, get document node
    const { root } = await this.session.send("DOM.getDocument");

    // Query selector
    const { nodeId } = await this.session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });

    // Get box model for the node
    const { model } = await this.session.send("DOM.getBoxModel", {
      nodeId,
    });

    const [x, y] = model.content[0];
    const width = model.width;
    const height = model.height;

    return { x, y, width, height };
  }

  /**
   * Wait for DOM to settle (no mutations)
   * Custom implementation using DOM mutation observers
   */
  async waitForSettledDom(timeout: number = 30000): Promise<boolean> {
    const script = `
      new Promise((resolve) => {
        let timer;
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            resolve(true);
          }, 500);
        });
        observer.observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
        timer = setTimeout(() => {
          observer.disconnect();
          resolve(true);
        }, ${timeout});
      })
    `;

    const { result } = await this.session.send("Runtime.evaluate", {
      expression: script,
      awaitPromise: true,
    });

    return result.value as boolean;
  }

  /**
   * Get accessibility tree
   * Maps to: Accessibility.getFullAXTree or Accessibility.getPartialAXTree
   */
  async getAccessibilityTree(
    withFrames: boolean = false,
  ): Promise<Protocol.Accessibility.AXNode[]> {
    const { nodes } = await this.session.send("Accessibility.getFullAXTree", {
      frameId: this.frameId,
    });

    if (withFrames) {
      // Recursively get accessibility trees from child frames
      const childFrames = await this.childFrames();
      for (const childFrame of childFrames) {
        const childNodes = await childFrame.getAccessibilityTree(false);
        nodes.push(...childNodes);
      }
    }

    return nodes;
  }

  /**
   * Evaluate JavaScript in frame context
   * Maps to: Runtime.evaluate
   */
  async evaluate<T = any>(expression: string, ...args: any[]): Promise<T> {
    const { result, exceptionDetails } = await this.session.send(
      "Runtime.evaluate",
      {
        expression,
        contextId: await this.getExecutionContextId(),
        awaitPromise: true,
        returnByValue: true,
        arguments: args.map((arg) => ({ value: arg })),
      },
    );

    if (exceptionDetails) {
      throw new Error(exceptionDetails.text || "Evaluation failed");
    }

    return result.value as T;
  }

  /**
   * Take screenshot of frame
   * Maps to: Page.captureScreenshot
   */
  async screenshot(options?: {
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<string> {
    const params: Protocol.Page.CaptureScreenshotRequest = {
      format: "png",
      captureBeyondViewport: options?.fullPage,
    };

    if (options?.clip) {
      params.clip = {
        ...options.clip,
        scale: 1,
      };
    }

    const { data } = await this.session.send("Page.captureScreenshot", params);
    return data;
  }

  /**
   * Get child frames
   * Uses Page.getFrameTree
   */
  async childFrames(): Promise<Frame[]> {
    const { frameTree } = await this.session.send("Page.getFrameTree");
    const frames: Frame[] = [];

    const collectFrames = (tree: Protocol.Page.FrameTree) => {
      if (
        tree.frame.id !== this.frameId &&
        tree.frame.parentId === this.frameId
      ) {
        frames.push(new Frame(this.session, tree.frame.id, this.pageId));
      }
      if (tree.childFrames) {
        tree.childFrames.forEach(collectFrames);
      }
    };

    collectFrames(frameTree);
    return frames;
  }

  /**
   * Wait for specific load state
   * Maps to: Page.lifecycleEvent monitoring
   */
  async waitForLoadState(
    state: "load" | "domcontentloaded" | "networkidle" = "load",
  ): Promise<void> {
    return new Promise((resolve) => {
      const handler = (event: Protocol.Page.LifecycleEventEvent) => {
        if (event.frameId === this.frameId && event.name === state) {
          this.session.off("Page.lifecycleEvent", handler);
          resolve();
        }
      };
      this.session.on("Page.lifecycleEvent", handler);
    });
  }

  /**
   * Create a locator for elements
   * Maps to: DOM.performSearch -> DOM.getSearchResults
   */
  locator(
    selector: string,
    options?: { deep?: boolean; depth?: number },
  ): Locator {
    return new Locator(this, selector, options);
  }

  private async getExecutionContextId(): Promise<number> {
    const { executionContexts } = await this.session.send("Runtime.enable");
    const context = executionContexts?.find(
      (ctx) => ctx.auxData && (ctx.auxData as any).frameId === this.frameId,
    );
    if (!context) throw new Error("No execution context for frame");
    return context.id;
  }
}

class Locator {
  constructor(
    private frame: Frame,
    private selector: string,
    private options?: { deep?: boolean; depth?: number },
  ) {}

  /**
   * Click on element
   * Maps to:
   * 1. DOM.scrollIntoViewIfNeeded
   * 2. DOM.getContentQuads (get coordinates)
   * 3. Input.dispatchMouseEvent (mousePressed, mouseReleased)
   */
  async click(options?: {
    button?: "left" | "right" | "middle";
    clickCount?: number;
  }): Promise<void> {
    // Find element
    const { root } = await this.frame.session.send("DOM.getDocument");
    const { nodeId } = await this.frame.session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: this.selector,
    });

    // Scroll into view
    await this.frame.session.send("DOM.scrollIntoViewIfNeeded", {
      nodeId,
    });

    // Get element coordinates
    const { quads } = await this.frame.session.send("DOM.getContentQuads", {
      nodeId,
    });

    if (!quads || quads.length === 0) {
      throw new Error("Element not visible");
    }

    // Calculate center point
    const quad = quads[0];
    const x = (quad[0] + quad[2]) / 2;
    const y = (quad[1] + quad[5]) / 2;

    // Perform click
    const button = options?.button || "left";
    const clickCount = options?.clickCount || 1;

    await this.frame.session.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      clickCount,
    });

    await this.frame.session.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      clickCount,
    });
  }

  /**
   * Fill input field
   * Maps to: Runtime.callFunctionOn
   */
  async fill(value: string): Promise<void> {
    const { root } = await this.frame.session.send("DOM.getDocument");
    const { nodeId } = await this.frame.session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: this.selector,
    });

    const { object } = await this.frame.session.send("DOM.resolveNode", {
      nodeId,
    });

    await this.frame.session.send("Runtime.callFunctionOn", {
      functionDeclaration: `function(value) {
        this.value = value;
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
      objectId: object.objectId,
      arguments: [{ value }],
    });
  }

  /**
   * Type text into element
   * Maps to:
   * 1. DOM.focus
   * 2. Input.dispatchKeyEvent (for each character)
   */
  async type(text: string, options?: { delay?: number }): Promise<void> {
    // Focus element
    const { root } = await this.frame.session.send("DOM.getDocument");
    const { nodeId } = await this.frame.session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: this.selector,
    });

    await this.frame.session.send("DOM.focus", {
      nodeId,
    });

    // Type each character
    for (const char of text) {
      await this.frame.session.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        text: char,
        key: char,
      });

      await this.frame.session.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        text: char,
        key: char,
      });

      if (options?.delay) {
        await new Promise((resolve) => setTimeout(resolve, options.delay));
      }
    }
  }

  /**
   * Select option(s) in select element
   * Maps to: DOM.setAttributeValue
   */
  async selectOption(values: string | string[]): Promise<string[]> {
    const valueArray = Array.isArray(values) ? values : [values];

    const { root } = await this.frame.session.send("DOM.getDocument");
    const { nodeId } = await this.frame.session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: this.selector,
    });

    // Get all options
    const { nodeIds } = await this.frame.session.send("DOM.querySelectorAll", {
      nodeId,
      selector: "option",
    });

    const selectedValues: string[] = [];

    for (const optionId of nodeIds) {
      const { attributes } = await this.frame.session.send(
        "DOM.getAttributes",
        {
          nodeId: optionId,
        },
      );

      const valueIndex = attributes.indexOf("value");
      const optionValue = valueIndex !== -1 ? attributes[valueIndex + 1] : "";

      if (valueArray.includes(optionValue)) {
        await this.frame.session.send("DOM.setAttributeValue", {
          nodeId: optionId,
          name: "selected",
          value: "selected",
        });
        selectedValues.push(optionValue);
      }
    }

    return selectedValues;
  }
}

class Page {
  private frame: Frame;

  constructor(
    private session: CDPSession,
    private pageId: string,
  ) {
    this.frame = new Frame(session, "", pageId); // Main frame
  }

  /**
   * Get current URL
   * Maps to: Page.getNavigationHistory
   */
  async url(): Promise<string> {
    const { entries, currentIndex } = await this.session.send(
      "Page.getNavigationHistory",
    );
    return entries[currentIndex].url;
  }

  /**
   * Navigate to URL
   * Maps to: Page.navigate
   */
  async goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle" },
  ): Promise<void> {
    const { frameId } = await this.session.send("Page.navigate", {
      url,
    });

    if (options?.waitUntil) {
      await this.frame.waitForLoadState(options.waitUntil);
    }
  }

  /**
   * Navigate back in history
   * Maps to: Page.navigateToHistoryEntry
   */
  async goBack(): Promise<void> {
    const { entries, currentIndex } = await this.session.send(
      "Page.getNavigationHistory",
    );

    if (currentIndex > 0) {
      const targetEntry = entries[currentIndex - 1];
      await this.session.send("Page.navigateToHistoryEntry", {
        entryId: targetEntry.id,
      });
    }
  }

  /**
   * Navigate forward in history
   * Maps to: Page.navigateToHistoryEntry
   */
  async goForward(): Promise<void> {
    const { entries, currentIndex } = await this.session.send(
      "Page.getNavigationHistory",
    );

    if (currentIndex < entries.length - 1) {
      const targetEntry = entries[currentIndex + 1];
      await this.session.send("Page.navigateToHistoryEntry", {
        entryId: targetEntry.id,
      });
    }
  }

  /**
   * Reload page
   * Maps to: Page.reload
   */
  async reload(options?: {
    waitUntil?: "load" | "domcontentloaded";
  }): Promise<void> {
    await this.session.send("Page.reload", {
      ignoreCache: false,
    });

    if (options?.waitUntil) {
      await this.frame.waitForLoadState(options.waitUntil);
    }
  }

  /**
   * Take screenshot
   * Maps to: Page.captureScreenshot
   */
  async screenshot(options?: { fullPage?: boolean }): Promise<string> {
    return this.frame.screenshot(options);
  }

  /**
   * Add initialization script
   * Maps to: Page.addScriptToEvaluateOnNewDocument
   */
  async addInitScript(script: string): Promise<void> {
    await this.session.send("Page.addScriptToEvaluateOnNewDocument", {
      source: script,
    });
  }

  /**
   * Get main frame
   */
  mainFrame(): Frame {
    return this.frame;
  }

  /**
   * Create locator (delegates to main frame)
   */
  locator(selector: string): Locator {
    return this.frame.locator(selector);
  }
}

/**
 * Utility functions for scrolling and viewport manipulation
 * These would be injected as JavaScript
 */
const actHandlerUtils = {
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

export { Frame, Page, Locator, actHandlerUtils };
