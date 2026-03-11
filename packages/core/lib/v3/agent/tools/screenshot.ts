import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";

interface PageMetadata {
  viewportHeight: number;
  scrollHeight: number;
  scrollTop: number;
  totalElementCount: number;
  interactiveElementCount: number;
  hasIframes: boolean;
}

export const screenshotTool = (v3: V3) =>
  tool({
    description:
      "Takes a screenshot (PNG) of the current page. Use this to quickly verify page state.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        v3.logger({
          category: "agent",
          message: `Agent calling tool: screenshot`,
          level: 1,
        });
        const page = await v3.context.awaitActivePage();
        const buffer = await page.screenshot({ fullPage: false });
        const pageUrl = page.url();

        let pageMetadata: PageMetadata | undefined;
        try {
          pageMetadata = await page.evaluate(() => {
            const interactive =
              "input,button,a,select,textarea,[role='button'],[role='link'],[role='checkbox'],[role='radio'],[role='tab'],[contenteditable='true']";
            return {
              viewportHeight: window.innerHeight,
              scrollHeight: document.documentElement.scrollHeight,
              scrollTop: window.scrollY,
              totalElementCount: document.querySelectorAll("*").length,
              interactiveElementCount:
                document.querySelectorAll(interactive).length,
              hasIframes: document.querySelectorAll("iframe").length > 0,
            };
          });
        } catch {
          // page.evaluate can fail on special pages (e.g. about:blank)
        }

        return {
          success: true,
          base64: buffer.toString("base64"),
          timestamp: Date.now(),
          pageUrl,
          pageMetadata,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error taking screenshot: ${(error as Error).message}`,
        };
      }
    },
    toModelOutput: (result) => {
      if (result.success === false || result.error !== undefined) {
        return {
          type: "content",
          value: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      const parts: Array<
        | { type: "media"; mediaType: "image/png"; data: string }
        | { type: "text"; text: string }
      > = [{ type: "media", mediaType: "image/png", data: result.base64 }];

      if (result.pageMetadata) {
        const m = result.pageMetadata;
        const pctScrolled =
          m.scrollHeight > m.viewportHeight
            ? Math.round(
                (m.scrollTop / (m.scrollHeight - m.viewportHeight)) * 100,
              )
            : 0;
        parts.push({
          type: "text",
          text:
            `Page context: viewport ${m.viewportHeight}px, ` +
            `scrollHeight ${m.scrollHeight}px (${pctScrolled}% scrolled), ` +
            `${m.totalElementCount} elements (${m.interactiveElementCount} interactive)` +
            (m.hasIframes ? ", has iframes" : ""),
        });
      }

      return { type: "content", value: parts };
    },
  });
