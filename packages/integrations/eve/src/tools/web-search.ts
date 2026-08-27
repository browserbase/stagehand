import { defineTool } from "eve/tools";
import { z } from "zod";

import { createBrowserbaseWebClient, type BrowserbaseWebToolConfig } from "./client.js";

const searchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  author: z.string().nullish(),
  favicon: z.string().nullish(),
  image: z.string().nullish(),
  publishedDate: z.string().nullish(),
});

export const browserbaseWebSearchOutputSchema = z.object({
  query: z.string(),
  requestId: z.string(),
  results: z.array(searchResultSchema),
});

export function browserbaseWebSearch(config: BrowserbaseWebToolConfig = {}) {
  return defineTool({
    description:
      "Search the public web with Browserbase Search. Use this to discover relevant URLs before fetching content or opening a browser session.",
    inputSchema: z.object({
      query: z.string().min(1).max(200).describe("The web search query."),
      numResults: z
        .number()
        .int()
        .min(1)
        .max(25)
        .default(10)
        .describe("The number of results to return."),
    }),
    outputSchema: browserbaseWebSearchOutputSchema,
    execute({ query, numResults }, context) {
      const browserbase = createBrowserbaseWebClient(config);
      return browserbase.search.web({ query, numResults }, { signal: context.abortSignal });
    },
  });
}
