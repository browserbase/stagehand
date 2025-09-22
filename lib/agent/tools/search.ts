import { tool } from "ai";
import { z } from "zod";
import Exa from "exa-js";

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

async function performExaSearch(query: string): Promise<SearchResponse> {
  try {
    const exa = new Exa(process.env.EXA_API_KEY);

    const response = await exa.search(query, {
      type: "auto",
      numResults: 5,
    });

    const responseObj = response;
    const results: ExaSearchResult[] = [];

    if (responseObj?.results && Array.isArray(responseObj.results)) {
      responseObj.results.forEach((item) => {
        if (item.id && item.title && item.url) {
          results.push({
            id: item.id,
            title: item.title,
            url: item.url,
          });
        }
      });
    }

    return {
      data: {
        results: results,
      },
    };
  } catch (error) {
    console.error("Search error", error);
    return {
      error: `Error performing search`,
      data: {
        results: [],
      },
    };
  }
}

export const createSearchTool = () => {
  return tool({
    description:
      "Perform a web search and returns results. Use this tool when you need information from the web or when you are unsure of the exact URL you want to navigate to. This can be used to find the ideal entry point, resulting in a task that is easier to complete due to starting further in the process.",
    parameters: z.object({
      query: z.string().describe("The search query to look for on the page"),
    }),
    execute: async ({ query }: { query: string }) => {
      const result = await performExaSearch(query);
      return {
        ...result,
        timestamp: Date.now(),
      };
    },
  });
};
