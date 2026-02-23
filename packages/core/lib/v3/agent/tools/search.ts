import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";

export interface BraveSearchResult {
  title: string;
  url: string;
  description?: string;
}

interface SearchResponse {
  data?: {
    results: BraveSearchResult[];
  };
  error?: string;
}

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  meta_url?: {
    favicon?: string;
  };
}

interface BraveApiResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

async function performBraveSearch(query: string): Promise<SearchResponse> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": process.env.BRAVE_API_KEY!,
        },
      },
    );

    if (!response.ok) {
      return {
        error: `Brave API error: ${response.status} ${response.statusText}`,
        data: { results: [] },
      };
    }

    const data = (await response.json()) as BraveApiResponse;
    const results: BraveSearchResult[] = [];

    if (data?.web?.results && Array.isArray(data.web.results)) {
      for (const item of data.web.results.slice(0, 5)) {
        if (item.title && item.url) {
          results.push({
            title: item.title,
            url: item.url,
            description: item.description,
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

export const searchTool = (v3: V3) =>
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

      const result = await performBraveSearch(query);

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
