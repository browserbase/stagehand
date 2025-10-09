import { tool } from "ai";
import { z } from "zod/v3";
import type { V3 } from "@/packages/core/lib/v3/v3";

export const createAriaTreeTool = (v3: V3) =>
  tool({
    description:
      "gets the accessibility (ARIA) hybrid tree text for the current page. use this to understand structure and content.",
    parameters: z.object({}),
    execute: async () => {
      const page = await v3.context.awaitActivePage();
      const { pageText } = (await v3.extract()) as { pageText: string };
      const pageUrl = await page.url();

      let content = pageText;
      const MAX_TOKENS = 70000; // rough cap, assume ~4 chars per token for conservative truncation
      const estimatedTokens = Math.ceil(content.length / 4);
      if (estimatedTokens > MAX_TOKENS) {
        const maxChars = MAX_TOKENS * 4;
        content =
          content.substring(0, maxChars) +
          "\n\n[CONTENT TRUNCATED: Exceeded 70,000 token limit]";
      }

      return { content, pageUrl };
    },
    experimental_toToolResultContent: (result) => {
      const content = typeof result === "string" ? result : result.content;
      return [{ type: "text", text: `Accessibility Tree:\n${content}` }];
    },
  });
