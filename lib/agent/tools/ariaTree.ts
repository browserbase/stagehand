import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

// Cache to store the full content and avoid re-extracting on each chunk request
let cachedContent: string | null = null;
let cachedPageUrl: string | null = null;

export const createAriaTreeTool = (stagehand: Stagehand) =>
  tool({
    description:
      "gets the accessibility (ARIA) tree from the current page in chunks. this is useful for understanding the page structure and accessibility features. it provides full context of what is on the page, broken into manageable chunks. if no chunk number is specified, returns the first chunk with metadata about total chunks available.",
    parameters: z.object({
      chunkNumber: z
        .number()
        .optional()
        .describe(
          "The chunk number to retrieve (1-based). If not provided, returns the first chunk.",
        ),
    }),
    execute: async ({ chunkNumber = 1 }) => {
      try {
        const pageUrl = stagehand.page.url();

        // Only extract content if we don't have cached content or if the URL changed
        if (!cachedContent || cachedPageUrl !== pageUrl) {
          const { page_text } = await stagehand.page.extract();
          cachedContent = page_text;
          cachedPageUrl = pageUrl;
        }

        const TOKENS_PER_CHUNK = 50000;
        const CHARACTERS_PER_TOKEN = 4; // Rough estimate
        const CHARACTERS_PER_CHUNK = TOKENS_PER_CHUNK * CHARACTERS_PER_TOKEN;

        const totalCharacters = cachedContent.length;
        const totalChunks = Math.ceil(totalCharacters / CHARACTERS_PER_CHUNK);

        // Validate chunk number
        if (chunkNumber < 1 || chunkNumber > totalChunks) {
          return {
            success: false,
            error: `Invalid chunk number ${chunkNumber}. Available chunks: 1-${totalChunks}`,
          };
        }

        // Calculate chunk boundaries
        const startIndex = (chunkNumber - 1) * CHARACTERS_PER_CHUNK;
        const endIndex = Math.min(
          startIndex + CHARACTERS_PER_CHUNK,
          totalCharacters,
        );
        const chunkContent = cachedContent.substring(startIndex, endIndex);

        // Determine if there are more chunks
        const hasMoreChunks = chunkNumber < totalChunks;
        const nextChunkNumber = hasMoreChunks ? chunkNumber + 1 : null;

        // Return formatted content with all necessary information
        let content = `Accessibility Tree - Chunk ${chunkNumber} of ${totalChunks} (characters ${startIndex + 1}-${endIndex} of ${totalCharacters})\n\n${chunkContent}`;

        if (hasMoreChunks) {
          content += `\n\n[CHUNK INCOMPLETE: This is chunk ${chunkNumber} of ${totalChunks}. To get the next chunk, call this tool again with chunkNumber: ${nextChunkNumber}]`;
        } else {
          content += `\n\n[CHUNK COMPLETE: This is the final chunk (${chunkNumber} of ${totalChunks})]`;
        }

        return {
          success: true,
          content,
          chunkNumber,
          totalChunks,
          hasMoreChunks,
        };
      } catch {
        return {
          success: false,
          error: `Error getting aria tree, try again`,
        };
      }
    },
  });
