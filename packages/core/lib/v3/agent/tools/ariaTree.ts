import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";

export const ariaTreeTool = (v3: V3) =>
  tool({
    description:
      "gets the accessibility (ARIA) hybrid tree text for the current page. use this to understand structure and content.",
    inputSchema: z.object({}),
    execute: async () => {
      v3.logger({
        category: "agent",
        message: `Agent calling tool: ariaTree`,
        level: 1,
      });
      const page = await v3.context.awaitActivePage();
      const { pageText } = (await v3.extract()) as { pageText: string };
      const pageUrl = page.url();

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
    toModelOutput: (result) => ({
      type: "content",
      value: [{ type: "text", text: `Accessibility Tree:\n${result.content}` }],
    }),
  });
