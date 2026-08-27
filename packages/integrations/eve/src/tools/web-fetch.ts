import { defineTool } from "eve/tools";
import { z } from "zod";

import { createBrowserbaseWebClient, type BrowserbaseWebToolConfig } from "./client.js";

const jsonSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    'A JSON Schema for structured extraction. It must declare a top-level type such as "object" or "array". Required with the json format and invalid with other formats.',
  );

export const browserbaseWebFetchInputSchema = z
  .object({
    url: z.url().describe("The absolute URL to retrieve."),
    format: z
      .enum(["raw", "markdown", "json"])
      .default("markdown")
      .describe("The response content format."),
    schema: jsonSchema,
    allowRedirects: z.boolean().default(true).describe("Whether to follow HTTP redirects."),
    allowInsecureSsl: z
      .boolean()
      .default(false)
      .describe("Whether to bypass TLS certificate verification."),
    proxies: z
      .boolean()
      .default(false)
      .describe("Whether to route the request through Browserbase proxies."),
  })
  .superRefine(({ format, schema }, context) => {
    if (format === "json" && !schema) {
      context.addIssue({ code: "custom", message: "schema is required when format is json." });
    }
    if (
      format === "json" &&
      schema &&
      (typeof schema.type !== "string" || schema.type.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "schema.type must declare a top-level JSON Schema type.",
        path: ["schema", "type"],
      });
    }
    if (format !== "json" && schema) {
      context.addIssue({ code: "custom", message: "schema can only be used when format is json." });
    }
  });

export const browserbaseWebFetchOutputSchema = z.object({
  id: z.string(),
  content: z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  contentType: z.string(),
  encoding: z.string(),
  headers: z.record(z.string(), z.string()),
  statusCode: z.number().int(),
});

export function browserbaseWebFetch(config: BrowserbaseWebToolConfig = {}) {
  return defineTool({
    description:
      "Retrieve a URL through Browserbase Fetch without starting a browser session. Use raw for the original response, markdown for agent-friendly content, or json with a schema for structured extraction.",
    inputSchema: browserbaseWebFetchInputSchema,
    outputSchema: browserbaseWebFetchOutputSchema,
    execute({ url, format, schema, allowRedirects, allowInsecureSsl, proxies }, context) {
      const browserbase = createBrowserbaseWebClient(config);
      return browserbase.fetchAPI.create(
        {
          url,
          format,
          schema,
          allowRedirects,
          allowInsecureSsl,
          proxies,
        },
        { signal: context.abortSignal },
      );
    },
  });
}
