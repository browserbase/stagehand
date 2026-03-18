import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";

export interface SearchResult {
  title: string;
  url: string;
  publishedDate?: string;
}

interface BrowserbaseRawResult {
  title?: string;
  url?: string;
  publishedDate?: string;
}

interface BrowserbaseApiResponse {
  results?: BrowserbaseRawResult[];
}

async function performBrowserbaseSearch(
  v3: V3,
  query: string,
  apiKey: string,
  numResults: number = 5,
): Promise<{ results: SearchResult[]; error?: string }> {
  try {
    const response = await fetch("https://api.browserbase.com/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bb-api-key": apiKey,
      },
      body: JSON.stringify({ query, numResults }),
    });

    if (!response.ok) {
      return {
        results: [],
        error: `Browserbase Search API error: ${response.status} ${response.statusText}`,
      };
    }

    const data = (await response.json()) as BrowserbaseApiResponse;
    const results: SearchResult[] = (data?.results ?? []).map(
      ({ title, url, publishedDate }) => ({
        title: title,
        url: url,
        ...(publishedDate && { publishedDate }),
      }),
    );

    return { results };
  } catch (error) {
    v3.logger({
      category: "agent",
      message: `Search error: ${error.message}`,
      level: 0,
    });
    return {
      results: [],
      error: `Error performing search: ${error.message}`,
    };
  }
}

export const searchTool = (v3: V3, apiKey: string) =>
  tool({
    description:
      "Perform a web search and returns results. Use this tool when you need information from the web or when you are unsure of the exact URL you want to navigate to. This can be used to find the ideal entry point, resulting in a task that is easier to complete due to starting further in the process.",
    inputSchema: z.object({
      query: z.string().describe("The search query to look for on the web"),
    }),
    execute: async ({ query }) => {
      v3.logger({
        category: "agent",
        message: `Agent calling tool: search`,
        level: 1,
        auxiliary: {
          arguments: {
            value: JSON.stringify({ query }),
            type: "object",
          },
        },
      });

      const result = await performBrowserbaseSearch(v3, query, apiKey);

      v3.recordAgentReplayStep({
        type: "search",
        instruction: query,
        playwrightArguments: { query },
        message: result.error ?? `Found ${result.results.length} results`,
      });

      return { ...result, timestamp: Date.now() };
    },
  });
