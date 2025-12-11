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

interface ExaSearchResponse {
  results?: Array<{ id?: string; title?: string; url?: string }>;
}

async function performExaSearch(query: string): Promise<SearchResponse> {
  try {
    if (!process.env.EXA_API_KEY) {
      return {
        error: "EXA_API_KEY environment variable is not set",
        data: { results: [] },
      };
    }

    // Dynamic import to avoid requiring exa-js if not installed
    let ExaModule: { default: new (apiKey: string) => { search: (query: string, options: { type: string; numResults: number }) => Promise<ExaSearchResponse> } };
    try {
      // @ts-expect-error - exa-js is an optional dependency
      ExaModule = await import("exa-js");
    } catch {
      return {
        error:
          "exa-js package is not installed. Install it with: npm install exa-js",
        data: { results: [] },
      };
    }

    const Exa = ExaModule.default;
    const exa = new Exa(process.env.EXA_API_KEY);

    const response = await exa.search(query, {
      type: "auto",
      numResults: 5,
    });

    const results: ExaSearchResult[] = [];

    if (response?.results && Array.isArray(response.results)) {
      response.results.forEach(
        (item: { id?: string; title?: string; url?: string }) => {
          if (item.id && item.title && item.url) {
            results.push({
              id: item.id,
              title: item.title,
              url: item.url,
            });
          }
        },
      );
    }

    return {
      data: {
        results: results,
      },
    };
  } catch (error) {
    console.error("Search error", error);
    return {
      error: `Error performing search: ${(error as Error).message}`,
      data: {
        results: [],
      },
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
