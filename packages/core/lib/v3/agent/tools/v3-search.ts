import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";

export interface ExaSearchResult {
  id: string;
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
  favicon?: string;
  score?: number;
  image?: string;
}

interface SearchResponse {
  data?: {
    results: ExaSearchResult[];
  };
  error?: string;
}

interface ExaApiResponse {
  results?: Array<{
    id?: string;
    title?: string;
    url?: string;
    publishedDate?: string;
    author?: string;
    favicon?: string;
    score?: number;
    image?: string;
  }>;
}

async function performExaSearch(query: string): Promise<SearchResponse> {
  try {
    if (!process.env.EXA_API_KEY) {
      return {
        error: "EXA_API_KEY environment variable is not set",
        data: { results: [] },
      };
    }

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": process.env.EXA_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: 5,
      }),
    });

    if (!response.ok) {
      return {
        error: `Exa API error: ${response.status} ${response.statusText}`,
        data: { results: [] },
      };
    }

    const data = (await response.json()) as ExaApiResponse;
    const results: ExaSearchResult[] = [];

    if (data?.results && Array.isArray(data.results)) {
      for (const item of data.results) {
        if (item.id && item.title && item.url) {
          results.push({
            id: item.id,
            title: item.title,
            url: item.url,
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

export const createSearchTool = (v3: V3) =>
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
            type: "string",
          },
        },
      });

      const result = await performExaSearch(query);

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
