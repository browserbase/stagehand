import { Args, Flags } from "@oclif/core";

import { outputJson, requestBrowserbaseJson, writeOutputFile } from "../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../lib/cloud/flags.js";
import { BrowseCommand } from "../../base.js";
import { outputFormatFlags, outputTable, resolveOutputFormat } from "../../lib/output.js";

interface SearchResult {
  id: string;
  url: string;
  title: string;
  author?: string;
  publishedDate?: string;
  image?: string;
  favicon?: string;
  excerpts?: string[];
}

interface SearchResponse {
  requestId: string;
  query: string;
  provider?: "parallel" | "exa";
  mode?: "fast" | "advanced" | "deep-lite" | "deep";
  results: SearchResult[];
}

const PARALLEL_SUPPORTED_COUNTRIES = new Set([
  "AR",
  "AU",
  "AT",
  "BE",
  "BR",
  "CA",
  "CL",
  "CN",
  "DK",
  "FI",
  "FR",
  "DE",
  "GR",
  "HK",
  "IN",
  "ID",
  "IT",
  "JP",
  "MY",
  "MX",
  "NL",
  "NZ",
  "NO",
  "PH",
  "PL",
  "PT",
  "RU",
  "SA",
  "ZA",
  "KR",
  "ES",
  "SE",
  "CH",
  "TW",
  "TR",
  "GB",
  "US",
]);

export default class Search extends BrowseCommand {
  static override description =
    "Search the web using the Browserbase Search API.\n\n" +
    "Filter results by domain, date, location, and content freshness. " +
    "Use --excerpts to get the most relevant passages from each result.\n\n" +
    "Provider/mode: Parallel (default) supports fast and advanced modes. " +
    "Exa supports fast, deep-lite, and deep modes.";

  static override examples = [
    `browse cloud search "best restaurants in SF"`,
    `browse cloud search "web scraping tools" --num-results 5`,
    `browse cloud search "browserbase docs" --provider parallel --mode fast`,
    `browse cloud search "browser automation research" --provider parallel --mode advanced`,
    `browse cloud search "browserbase docs" --provider exa --mode deep`,
    `browse cloud search "browserbase docs" --json`,
    `browse cloud search "browserbase docs" --output results.json`,
    `browse cloud search "AI news" --include-domains techcrunch.com,wired.com --excerpts`,
    `browse cloud search "climate research" --start-published-date 2026-01-01 --max-age-hours 24`,
    `browse cloud search "local events" --user-location US --objective "Find tech meetups in San Francisco"`,
  ];

  static override args = {
    query: Args.string({ required: true, description: "Search query (1-200 characters)." }),
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
    provider: Flags.string({
      description: "Search provider: parallel (default) or exa.",
      options: ["parallel", "exa"],
    }),
    mode: Flags.string({
      description:
        "Search mode. Parallel: fast, advanced (default). Exa: fast (default), deep-lite, deep.",
      options: ["fast", "advanced", "deep-lite", "deep"],
    }),
    output: Flags.string({
      description: "Write the search results as JSON to a file.",
      helpValue: "<output>",
    }),
    "include-domains": Flags.string({
      description:
        "Only return results from these domains (comma-separated). " +
        "Accepts hostname (example.com), path prefix (example.com/docs), " +
        "or wildcard (*.example.com). Parallel: max 200, mutually exclusive with --exclude-domains.",
      helpValue: "<domains>",
    }),
    "exclude-domains": Flags.string({
      description:
        "Never return results from these domains (comma-separated). " +
        "Same format as --include-domains. Parallel: max 200, mutually exclusive with --include-domains.",
      helpValue: "<domains>",
    }),
    "start-published-date": Flags.string({
      description:
        "Only return results published after this date (ISO 8601, e.g. 2026-01-01 or 2026-01-01T00:00:00Z). " +
        "Parallel rounds to UTC day.",
      helpValue: "<date>",
    }),
    "end-published-date": Flags.string({
      description: "Only return results published before this date (ISO 8601). Exa only.",
      helpValue: "<date>",
    }),
    category: Flags.string({
      description: "Focus on a content category. Exa only.",
      options: ["company", "publication", "news", "personal site", "financial report", "people"],
    }),
    "user-location": Flags.string({
      description:
        "Two-letter country code (ISO 3166-1) to localize ranking. " +
        "Parallel supports a limited set of countries.",
      helpValue: "<code>",
    }),
    moderation: Flags.boolean({
      description: "Filter unsafe content. Exa only.",
      allowNo: true,
    }),
    objective: Flags.string({
      description:
        "Natural-language task intent that adds context to the query (up to 4096 characters).",
      helpValue: "<text>",
    }),
    "max-age-hours": Flags.integer({
      description: "Refetch cached pages older than this many hours (1-720).",
      helpValue: "<hours>",
      min: 1,
      max: 720,
    }),
    excerpts: Flags.boolean({
      description: "Return the most relevant passages from each result.",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Search);

    const includeDomains = parseDomainList(flags["include-domains"]);
    const excludeDomains = parseDomainList(flags["exclude-domains"]);

    this.validateSearchFlags(flags, includeDomains, excludeDomains);

    const startPublishedDate = normalizeDate(flags["start-published-date"]);
    const endPublishedDate = normalizeDate(flags["end-published-date"]);

    const body: Record<string, unknown> = {
      query: args.query,
    };

    if (flags["num-results"] !== undefined) body.numResults = flags["num-results"];
    if (flags.provider) body.provider = flags.provider;
    if (flags.mode) body.mode = flags.mode;
    if (includeDomains.length > 0) body.includeDomains = includeDomains;
    if (excludeDomains.length > 0) body.excludeDomains = excludeDomains;
    if (startPublishedDate) body.startPublishedDate = startPublishedDate;
    if (endPublishedDate) body.endPublishedDate = endPublishedDate;
    if (flags.category) body.category = flags.category;
    if (flags["user-location"]) body.userLocation = flags["user-location"].toUpperCase();
    if (flags.moderation !== undefined) body.moderation = flags.moderation;
    if (flags.objective) body.objective = flags.objective;
    if (flags["max-age-hours"] !== undefined) body.maxAgeHours = flags["max-age-hours"];
    if (flags.excerpts) body.excerpts = flags.excerpts;

    const result = await requestBrowserbaseJson<SearchResponse>(toApiOptions(flags), "/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

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
        provider: result.provider,
        mode: result.mode,
        resultCount: result.results.length,
      });
      return;
    }

    if (outputFormat === "table") {
      outputSearchTable(result.results, { wide: flags.wide, showExcerpts: flags.excerpts });
      return;
    }

    outputJson(result);
  }

  private validateSearchFlags(
    flags: {
      provider?: string;
      mode?: string;
      "include-domains"?: string;
      "exclude-domains"?: string;
      "user-location"?: string;
      objective?: string;
    },
    includeDomains: string[],
    excludeDomains: string[],
  ): void {
    const isParallel = !flags.provider || flags.provider === "parallel";

    if (isParallel && flags.mode && (flags.mode === "deep" || flags.mode === "deep-lite")) {
      this.error(
        `The parallel provider does not support --mode ${flags.mode}. ` +
          "Use --mode fast or --mode advanced, or switch to --provider exa.",
      );
    }

    if (isParallel && includeDomains.length > 0 && excludeDomains.length > 0) {
      this.error(
        "The parallel provider does not support both --include-domains and --exclude-domains. " +
          "Use only one, or switch to --provider exa.",
      );
    }

    const totalDomains = includeDomains.length + excludeDomains.length;
    if (isParallel && totalDomains > 200) {
      this.error(
        `The parallel provider supports at most 200 domains total (got ${totalDomains}). ` +
          "Reduce the list or switch to --provider exa.",
      );
    }

    for (const domain of [...includeDomains, ...excludeDomains]) {
      if (domain.includes("://")) {
        this.error(
          `Domain "${domain}" includes a scheme (e.g. https://). ` +
            "Remove it and use just the hostname, path prefix, or wildcard.",
        );
      }
      if (/^[^/]*:/.test(domain)) {
        this.error(
          `Domain "${domain}" appears to include a port. ` + "Remove it and use just the hostname.",
        );
      }
      if (domain.includes("?") || domain.includes("#")) {
        this.error(
          `Domain "${domain}" includes a query string or fragment. ` +
            "Remove it and use just the hostname or path prefix.",
        );
      }
    }

    if (flags["user-location"]) {
      const code = flags["user-location"].toUpperCase();
      if (!/^[A-Za-z]{2}$/.test(code)) {
        this.error(`--user-location must be a two-letter country code (got "${code}").`);
      }
      if (isParallel && !PARALLEL_SUPPORTED_COUNTRIES.has(code)) {
        this.error(
          `The parallel provider does not support country code "${code}". ` +
            "Use --provider exa for broader country support.",
        );
      }
    }

    if (flags.objective && flags.objective.length > 4096) {
      this.error(`--objective exceeds 4096 characters (got ${flags.objective.length}).`);
    }
  }
}

function parseDomainList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.includes("T")) {
    return value;
  }
  return `${value}T00:00:00Z`;
}

function outputSearchTable(
  results: SearchResult[],
  options: { wide?: boolean; showExcerpts?: boolean },
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

  if (options.showExcerpts) {
    const resultsWithExcerpts = results.filter((r) => r.excerpts && r.excerpts.length > 0);
    if (resultsWithExcerpts.length > 0) {
      console.log("\nExcerpts:\n");
      for (const result of resultsWithExcerpts) {
        const index = results.indexOf(result) + 1;
        console.log(`[${index}] ${result.title}`);
        for (const excerpt of result.excerpts || []) {
          console.log(`    ${excerpt.slice(0, 200)}${excerpt.length > 200 ? "..." : ""}`);
        }
        console.log();
      }
    }
  }
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
