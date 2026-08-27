import { Args, Flags } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  parseOptionalJsonObjectArg,
  withBrowserbaseApi,
  writeOutputFile,
} from "../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../lib/cloud/flags.js";
import { BrowseCommand } from "../../base.js";
import { fail } from "../../lib/errors.js";

const fetchFormats = ["raw", "markdown", "json"] as const;
type FetchFormat = (typeof fetchFormats)[number];

export default class Fetch extends BrowseCommand {
  static override description =
    "Retrieve webpage content using the lightweight Browserbase Fetch API.";

  static override examples = [
    "browse cloud fetch https://www.google.com",
    "browse cloud fetch https://example.com --format raw",
    "browse cloud fetch https://example.com --allow-insecure-ssl --output page.html",
    `browse cloud fetch https://example.com --format json --schema '{"type":"object","properties":{"title":{"type":"string"}},"required":["title"]}'`,
  ];

  static override args = {
    url: Args.string({ required: true, description: "URL to fetch." }),
  };

  static override flags = {
    ...apiCommonFlags,
    "allow-insecure-ssl": Flags.boolean({
      description: "Bypass TLS certificate verification.",
    }),
    "allow-redirects": Flags.boolean({
      description: "Follow HTTP redirects.",
    }),
    proxies: Flags.boolean({
      description: "Enable Browserbase proxy support.",
    }),
    format: Flags.string({
      description:
        "Fetched content format. Defaults to markdown for token-efficient output.",
      helpValue: "<format>",
      options: [...fetchFormats],
      default: "markdown",
    }),
    schema: Flags.string({
      description:
        "JSON Schema for structured extraction. Required when --format json.",
      helpValue: "<schema>",
    }),
    output: Flags.string({
      description: "Write the fetched content to a file.",
      helpValue: "<output>",
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Fetch);
    const format = flags.format as FetchFormat;
    const schema = resolveFetchSchema(format, flags.schema);
    const client = createBrowserbaseClient(toApiOptions(flags));
    const result = await withBrowserbaseApi(
      "fetch",
      async () =>
        await client.fetchAPI.create({
          url: args.url,
          allowInsecureSsl: flags["allow-insecure-ssl"],
          allowRedirects: flags["allow-redirects"],
          format,
          proxies: flags.proxies,
          schema,
        }),
    );

    if (flags.output) {
      const contents = stringifyFetchContent(result.content);
      await writeOutputFile(flags.output, contents);
      outputJson({
        ok: true,
        outputPath: flags.output,
        contentType: result.contentType,
        statusCode: result.statusCode,
        sizeBytes: Buffer.byteLength(contents, "utf8"),
      });
      return;
    }

    outputJson(result);
  }
}

function resolveFetchSchema(
  format: FetchFormat,
  schemaFlag: string | undefined,
): Record<string, unknown> | undefined {
  if (format !== "json") {
    if (schemaFlag) {
      fail("--schema can only be used with --format json.");
    }
    return undefined;
  }

  if (!schemaFlag) {
    fail("--schema is required when --format json.");
  }

  return parseOptionalJsonObjectArg(schemaFlag, "schema");
}

function stringifyFetchContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  return JSON.stringify(content, null, 2);
}
