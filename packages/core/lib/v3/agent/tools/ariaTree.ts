import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import { TimeoutError } from "../../types/public/sdkErrors.js";

export const ariaTreeTool = (v3: V3, toolTimeout?: number) =>
  tool({
    description:
      "gets the accessibility (ARIA) hybrid tree text for the current page. use this to understand structure and content.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        v3.logger({
          category: "agent",
          message: `Agent calling tool: ariaTree`,
          level: 1,
        });
        const page = await v3.context.awaitActivePage();
        const extractOptions = toolTimeout
          ? { timeout: toolTimeout }
          : undefined;
        const { pageText } = (await v3.extract(extractOptions)) as {
          pageText: string;
        };
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

        return { success: true, content, pageUrl };
      } catch (error) {
        if (error instanceof TimeoutError) {
          throw error;
        }
        return {
          content: "",
          error: error?.message ?? String(error),
          success: false,
          pageUrl: "",
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

      return {
        type: "content",
        value: [
          { type: "text", text: `Accessibility Tree:\n${result.content}` },
        ],
      };
    },
  });
