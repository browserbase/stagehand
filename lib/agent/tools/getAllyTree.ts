import { tool } from "ai";
import { z } from "zod";
import { Page } from "../../../types/page";
import { countTokens } from "../utils/tokens";

export const createGetAccessibilityTreeTool = (page: Page) => {
  return tool({
    description: `gets the accessibility (ARIA) tree from the current page. this is useful for understanding the page structure and accessibility features. it should provide full context of what is on the page`,
    parameters: z.object({}),
    execute: async () => {
      // Get the accessibility tree snapshot
      const snapshot = await page.accessibility.snapshot();
      const snapshotStr = JSON.stringify(snapshot, null, 2);
      const content = snapshotStr.split("\n");
      let joinedContent = content.join("\n");

      const MAX_TOKENS = 70000;

      try {
        const tokenCount = await countTokens(joinedContent);

        if (tokenCount > MAX_TOKENS) {
          const words = joinedContent.split(/\s+/).filter((w) => w.length > 0);
          const wordsPerToken = words.length / tokenCount;
          const maxWords = Math.floor(MAX_TOKENS * wordsPerToken) - 50;
          const truncatedWords = words.slice(0, maxWords);

          joinedContent =
            truncatedWords.join(" ") +
            "\n\n[CONTENT TRUNCATED: Exceeded 150,000 token limit]";
        }
      } catch {
        const words = joinedContent.split(/\s+/).filter((w) => w.length > 0);
        const estimatedTokens = Math.ceil(words.length / 4);

        if (estimatedTokens > MAX_TOKENS) {
          const maxWords = MAX_TOKENS * 4;
          const truncatedWords = words.slice(0, maxWords);

          joinedContent =
            truncatedWords.join(" ") +
            "\n\n[CONTENT TRUNCATED: Exceeded 150,000 token limit (estimated)]";
        }
      }

      return {
        content: joinedContent,
        timestamp: Date.now(),
      };
    },
    experimental_toToolResultContent: (result) => {
      const content = typeof result === "string" ? result : result.content;
      return [{ type: "text", text: `Accessibility Tree:\n${content}` }];
    },
  });
};
