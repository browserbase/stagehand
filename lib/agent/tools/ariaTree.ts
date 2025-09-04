import { tool } from "ai";
import { z } from "zod/v3";
import { Page } from "@/types/page";

export const createAriaTreeTool = (page: Page) =>
  tool({
    description:
      "gets the accessibility (ARIA) tree from the current page. this is useful for understanding the page structure and accessibility features. it should provide full context of what is on the page",
    parameters: z.object({}),
    execute: async () => {
      const { page_text } = await page.extract();
      const pageUrl = page.url();

      let content = page_text;
      const MAX_TOKENS = 70000;

      const estimatedTokens = Math.ceil(content.length / 4);

      if (estimatedTokens > MAX_TOKENS) {
        const maxCharacters = MAX_TOKENS * 4;
        content =
          content.substring(0, maxCharacters) +
          "\n\n[CONTENT TRUNCATED: Exceeded 70,000 token limit]";
      }

      return {
        content,
        pageUrl,
      };
    },
    experimental_toToolResultContent: (result) => {
      const content = typeof result === "string" ? result : result.content;
      return [{ type: "text", text: `Accessibility Tree:\n${content}` }];
    },
  });
