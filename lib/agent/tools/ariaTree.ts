import { tool } from "ai";
import { z } from "zod";
import { Page } from "@/types/page";

export const createAriaTreeTool = (page: Page) =>
  tool({
    description:
      "gets the accessibility (ARIA) tree from the current page. this is useful for understanding the page structure and accessibility features. it should provide full context of what is on the page",
    parameters: z.object({}),
    execute: async () => {
      const { page_text } = await page.extract();
      const pageUrl = page.url();

      return {
        content: page_text,
        timestamp: Date.now(),
        pageUrl,
      };
    },
    experimental_toToolResultContent: (result) => {
      const content = typeof result === "string" ? result : result.content;
      return [{ type: "text", text: `Accessibility Tree:\n${content}` }];
    },
  });
