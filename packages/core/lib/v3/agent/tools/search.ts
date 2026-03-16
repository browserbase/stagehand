import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";

export interface SearchResult {
  title: string;
  url: string;
  publishedDate?: string;
}

interface SearchResponse {
  data?: {
    results: SearchResult[];
  };
  error?: string;
}

interface BrowserbaseSearchResult {
  title?: string;
  url?: string;
  publishedDate?: string;
}

interface BrowserbaseApiResponse {
  results?: BrowserbaseSearchResult[];
}

async function performBrowserbaseSearch(
  query: string,
  apiKey: string,
  numResults: number = 5,
): Promise<SearchResponse> {
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
        error: `Browserbase Search API error: ${response.status} ${response.statusText}`,
        data: { results: [] },
      };
    }

    const data = (await response.json()) as BrowserbaseApiResponse;
    const results: SearchResult[] = [];

    if (data?.results && Array.isArray(data.results)) {
      for (const item of data.results.slice(0, numResults)) {
        if (item.title && item.url) {
          results.push({
            title: item.title,
            url: item.url,
            publishedDate: item.publishedDate,
          });
        }
      }
    }

    return { data: { results } };
  } catch (error) {
    console.error("Search error", error);
    return {
      error: `Error performing search: ${(error as Error).message}`,
      data: { results: [] },
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

      const result = await performBrowserbaseSearch(query, apiKey);
      v3.recordAgentReplayStep({
        type: "search",
        instruction: query,
        playwrightArguments: { query },
        message:
          result.error ?? `Found ${result.data?.results.length ?? 0} results`,
      });

      return {
        ...result,
        timestamp: Date.now(),
      };
    },
  });
