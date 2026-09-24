import { Args, Flags } from "@oclif/core";

import {
  outputJson,
  requestBrowserbaseJson,
  writeOutputFile,
} from "../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../lib/cloud/flags.js";
import { BrowseCommand } from "../../base.js";
import {
  outputFormatFlags,
  outputTable,
  resolveOutputFormat,
} from "../../lib/output.js";

interface SearchResult {
  id: string;
  url: string;
  title: string;
  author?: string;
  publishedDate?: string;
  image?: string;
  favicon?: string;
}

interface SearchResponse {
  requestId: string;
  query: string;
  results: SearchResult[];
}

export default class Search extends BrowseCommand {
  static override description =
    "Search the web using the Browserbase Search API.";

  static override examples = [
    `browse cloud search "best restaurants in SF"`,
    `browse cloud search "web scraping tools" --num-results 5`,
    `browse cloud search "browserbase docs" --json`,
    `browse cloud search "browserbase docs" --output results.json`,
  ];

  static override args = {
    query: Args.string({ required: true, description: "Search query." }),
  };

  static override flags = {
    ...apiCommonFlags,
    ...outputFormatFlags,
    "num-results": Flags.integer({
      description: "Number of results to return (1-25, default 10).",
      helpValue: "<count>",
      min: 1,
      max: 25,
    }),
    output: Flags.string({
      description: "Write the search results as JSON to a file.",
      helpValue: "<output>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Search);
    const numResults = flags["num-results"];

    const result = await requestBrowserbaseJson<SearchResponse>(
      toApiOptions(flags),
      "/v1/search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: args.query, numResults }),
      },
    );

    const outputFormat = resolveOutputFormat(flags);
    if (flags.output) {
      await writeOutputFile(flags.output, JSON.stringify(result, null, 2));
      if (outputFormat === "table") {
        console.log(
          `Wrote ${result.results.length} results for "${result.query}" to ${flags.output}.`,
        );
        return;
      }

      outputJson({
        ok: true,
        outputPath: flags.output,
        requestId: result.requestId,
        query: result.query,
        resultCount: result.results.length,
      });
      return;
    }

    if (outputFormat === "table") {
      outputSearchTable(result.results, { wide: flags.wide });
      return;
    }

    outputJson(result);
  }
}

function outputSearchTable(
  results: SearchResult[],
  options: { wide?: boolean },
): void {
  if (results.length === 0) {
    console.log("No search results found.");
    return;
  }

  outputTable(
    results.map((result, index) => ({ ...result, index: index + 1 })),
    [
      {
        align: "right",
        header: "#",
        maxWidth: 3,
        value: (result) => result.index,
      },
      {
        header: "Title",
        maxWidth: 56,
        value: (result) => result.title,
      },
      {
        header: "URL",
        maxWidth: 64,
        value: (result) => result.url,
      },
      {
        header: "Published",
        maxWidth: 10,
        value: (result) => formatDate(result.publishedDate),
      },
      {
        header: "Author",
        maxWidth: 24,
        value: (result) => result.author,
      },
    ],
    { wide: options.wide },
  );
}

function formatDate(value: string | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}
