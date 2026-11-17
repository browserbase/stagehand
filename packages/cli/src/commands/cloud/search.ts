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

const PARALLEL_MODES = new Set(["fast", "advanced"]);
const EXA_MODES = new Set(["fast", "deep-lite", "deep"]);

export default class Search extends BrowseCommand {
  static override description =
    "Search the web using the Browserbase Search API.\n\n" +
    "Filter results by domain, date, location, and content freshness. " +
    "Use --excerpts to get the most relevant passages from each result.\n\n" +
    "Provider/mode: When --provider is omitted, the API picks a provider that supports your params. " +
    "Parallel supports fast and advanced modes. Exa supports fast, deep-lite, and deep modes.";

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
      description:
        "Search provider. Omit to let the API pick based on params. " +
        "Set explicitly to enforce provider-specific validation.",
      options: ["parallel", "exa"],
    }),
    mode: Flags.string({
      description:
        "Search mode. Parallel: fast, advanced. Exa: fast, deep-lite, deep. " +
        "Requires --provider, or infers exa for deep modes.",
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
        "or wildcard (*.example.com). With --provider parallel: max 200, mutually exclusive with --exclude-domains.",
      helpValue: "<domains>",
    }),
    "exclude-domains": Flags.string({
      description:
        "Never return results from these domains (comma-separated). " +
        "Same format as --include-domains. With --provider parallel: max 200, mutually exclusive with --include-domains.",
      helpValue: "<domains>",
    }),
    "start-published-date": Flags.string({
      description:
        "Only return results published after this date (YYYY-MM-DD or RFC 3339 date-time). " +
        "Parallel rounds to UTC day.",
      helpValue: "<date>",
    }),
    "end-published-date": Flags.string({
      description:
        "Only return results published before this date (YYYY-MM-DD or RFC 3339). " +
        "Requires --provider exa.",
      helpValue: "<date>",
    }),
    category: Flags.string({
      description: "Focus on a content category. Requires --provider exa.",
      options: ["company", "publication", "news", "personal site", "financial report", "people"],
    }),
    "user-location": Flags.string({
      description:
        "Two-letter country code (ISO 3166-1) to localize ranking. " +
        "With --provider parallel: limited to supported countries.",
      helpValue: "<code>",
    }),
    moderation: Flags.boolean({
      description: "Filter unsafe content. Requires --provider exa.",
      allowNo: true,
    }),
    objective: Flags.string({
      description:
        "Natural-language task intent that adds context to the query (up to 4096 code points).",
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

    const queryLength = [...args.query].length;
    if (queryLength < 1 || queryLength > 200) {
      this.error(`Query must be 1-200 characters (got ${queryLength}).`);
    }

    const includeDomains = this.parseDomainList(flags["include-domains"], "--include-domains");
    const excludeDomains = this.parseDomainList(flags["exclude-domains"], "--exclude-domains");

    const resolvedProvider = this.resolveProvider(flags);

    this.validateSearchFlags(flags, resolvedProvider, includeDomains, excludeDomains);

    const startPublishedDate = this.parseDate(
      flags["start-published-date"],
      "--start-published-date",
    );
    const endPublishedDate = this.parseDate(flags["end-published-date"], "--end-published-date");

    if (startPublishedDate && endPublishedDate) {
      const startMs = new Date(startPublishedDate).getTime();
      const endMs = new Date(endPublishedDate).getTime();
      if (startMs > endMs) {
        this.error("--start-published-date cannot be after --end-published-date.");
      }
    }

    const body: Record<string, unknown> = {
      query: args.query,
    };

    if (flags["num-results"] !== undefined) body.numResults = flags["num-results"];
    if (resolvedProvider) body.provider = resolvedProvider;
    if (flags.mode) body.mode = flags.mode;
    if (includeDomains.length > 0) body.includeDomains = includeDomains;
    if (excludeDomains.length > 0) body.excludeDomains = excludeDomains;
    if (startPublishedDate) body.startPublishedDate = startPublishedDate;
    if (endPublishedDate) body.endPublishedDate = endPublishedDate;
    if (flags.category) body.category = flags.category;
    if (flags["user-location"]) body.userLocation = flags["user-location"].toUpperCase();
    if (flags.moderation !== undefined) body.moderation = flags.moderation;
    if (flags.objective !== undefined) body.objective = flags.objective;
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

  private resolveProvider(flags: { provider?: string; mode?: string }): string | undefined {
    if (flags.provider) {
      return flags.provider;
    }
    if (flags.mode && (flags.mode === "deep" || flags.mode === "deep-lite")) {
      return "exa";
    }
    return undefined;
  }

  private parseDomainList(value: string | undefined, flagName: string): string[] {
    if (value === undefined) return [];

    const domains = value
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);

    if (domains.length === 0) {
      this.error(`${flagName} was provided but contains no valid domains.`);
    }

    const unique = [...new Set(domains)];
    if (unique.length < domains.length) {
      this.warn(`${flagName} contains duplicate domains; duplicates will be removed.`);
    }

    return unique;
  }

  private parseDate(value: string | undefined, flagName: string): string | undefined {
    if (value === undefined) return undefined;

    const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
    const dateTimePattern =
      /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/;

    const dateOnlyMatch = value.match(dateOnlyPattern);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      if (!isValidDate(Number(year), Number(month), Number(day))) {
        this.error(`${flagName} contains an invalid date: ${value}`);
      }
      return `${year}-${month}-${day}T00:00:00Z`;
    }

    const dateTimeMatch = value.match(dateTimePattern);
    if (dateTimeMatch) {
      const [, year, month, day] = dateTimeMatch;
      if (!isValidDate(Number(year), Number(month), Number(day))) {
        this.error(`${flagName} contains an invalid date: ${value}`);
      }
      let normalized = value.toUpperCase();
      if (
        !normalized.endsWith("Z") &&
        !normalized.includes("+") &&
        !normalized.slice(10).includes("-")
      ) {
        normalized += "Z";
      }
      return normalized;
    }

    this.error(
      `${flagName} must be YYYY-MM-DD or RFC 3339 date-time (e.g. 2026-01-01 or 2026-01-01T00:00:00Z). Got: ${value}`,
    );
  }

  private validateSearchFlags(
    flags: {
      provider?: string;
      mode?: string;
      "include-domains"?: string;
      "exclude-domains"?: string;
      "user-location"?: string;
      objective?: string;
      "end-published-date"?: string;
      category?: string;
      moderation?: boolean;
    },
    resolvedProvider: string | undefined,
    includeDomains: string[],
    excludeDomains: string[],
  ): void {
    const isExplicitParallel = flags.provider === "parallel";

    if (flags.mode && !flags.provider && flags.mode !== "deep" && flags.mode !== "deep-lite") {
      this.error("--mode requires --provider to be set (or use deep/deep-lite to infer exa).");
    }

    if (resolvedProvider === "parallel" && flags.mode && !PARALLEL_MODES.has(flags.mode)) {
      this.error(
        `--provider parallel does not support --mode ${flags.mode}. Use fast or advanced.`,
      );
    }

    if (resolvedProvider === "exa" && flags.mode && !EXA_MODES.has(flags.mode)) {
      this.error(
        `--provider exa does not support --mode ${flags.mode}. Use fast, deep-lite, or deep.`,
      );
    }

    if (isExplicitParallel) {
      if (flags["end-published-date"]) {
        this.error("--end-published-date is only supported with --provider exa.");
      }
      if (flags.category) {
        this.error("--category is only supported with --provider exa.");
      }
      if (flags.moderation !== undefined) {
        this.error("--moderation is only supported with --provider exa.");
      }

      if (includeDomains.length > 0 && excludeDomains.length > 0) {
        this.error(
          "--provider parallel does not support both --include-domains and --exclude-domains. " +
            "Use only one, or switch to --provider exa.",
        );
      }

      const totalDomains = includeDomains.length + excludeDomains.length;
      if (totalDomains > 200) {
        this.error(
          `--provider parallel supports at most 200 domains total (got ${totalDomains}). ` +
            "Reduce the list or switch to --provider exa.",
        );
      }
    }

    for (const domain of [...includeDomains, ...excludeDomains]) {
      if (domain.includes("://")) {
        this.error(
          `Domain "${domain}" includes a scheme (e.g. https://). ` +
            "Remove it and use just the hostname, path prefix, or wildcard.",
        );
      }
      const hostPart = domain.split("/")[0] ?? "";
      if (hostPart.includes(":")) {
        this.error(
          `Domain "${domain}" appears to include a port. Remove it and use just the hostname.`,
        );
      }
      if (domain.includes("?") || domain.includes("#")) {
        this.error(
          `Domain "${domain}" includes a query string or fragment. ` +
            "Remove it and use just the hostname or path prefix.",
        );
      }
    }

    if (includeDomains.length > 0 && excludeDomains.length > 0) {
      const includeSet = new Set(includeDomains);
      const overlap = excludeDomains.filter((d) => includeSet.has(d));
      if (overlap.length > 0) {
        this.warn(
          `The following domains appear in both --include-domains and --exclude-domains: ${overlap.join(", ")}`,
        );
      }
    }

    if (flags["user-location"]) {
      const code = flags["user-location"].toUpperCase();
      if (!/^[A-Za-z]{2}$/.test(code)) {
        this.error(`--user-location must be a two-letter country code (got "${code}").`);
      }
      if (isExplicitParallel && !PARALLEL_SUPPORTED_COUNTRIES.has(code)) {
        this.error(
          `--provider parallel does not support country code "${code}". ` +
            "Use --provider exa for broader country support, or omit --provider to let the API choose.",
        );
      }
    }

    if (flags.objective !== undefined) {
      if (flags.objective.trim().length === 0) {
        this.error("--objective cannot be empty or whitespace-only.");
      }
      const codePoints = [...flags.objective].length;
      if (codePoints > 4096) {
        this.error(`--objective exceeds 4096 code points (got ${codePoints}).`);
      }
    }
  }
}

function isValidDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
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
        console.log(`[${index}] ${sanitizeOutput(result.title)}`);
        for (const excerpt of result.excerpts || []) {
          const sanitized = sanitizeOutput(excerpt.slice(0, 200));
          console.log(`    ${sanitized}${excerpt.length > 200 ? "..." : ""}`);
        }
        console.log();
      }
    }
  }
}

function sanitizeOutput(value: string): string {
  // eslint-disable-next-line no-control-regex -- intentionally stripping control chars from output
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ");
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
