import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { z } from "zod";
import { createServer, type Server } from "node:http";
import { Stagehand, localBrowser, type ClientLLM } from "@browserbasehq/stagehand";
import { writeObservationFixture } from "../../fixtures/record.js";

// Historical bug: https://github.com/browserbase/stagehand/pull/2624
// Exercise real SDK -> extension -> snapshot -> model -> result, substituting
// only model generation so this transport regression requires no API keys.
const schema = z.object({ company_name: z.string(), employee_count: z.number() });
let directory: string;
let server: Server;
let serverUrl: string;
let recordedHtml: string;
const observations: string[] = [];

describe.sequential("recorded extraction regression", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "fixture-extraction-"));
    const sourceHtml = await readFile(
      new URL("../../fixtures/examples/schema-keys.html", import.meta.url),
      "utf8",
    );
    server = createServer((request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      if (request.url === "/source") response.end(sourceHtml);
      else if (request.url === "/recorded") response.end(recordedHtml);
      else {
        response.writeHead(404);
        response.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    serverUrl = `http://127.0.0.1:${address.port}/`;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(`${serverUrl}source`);
      await page.getByRole("button", { name: "Load company" }).click();
      await page.getByText("Acme Labs").waitFor();
      await writeObservationFixture(page, join(directory, "recorded"));
      recordedHtml = await readFile(join(directory, "recorded/index.html"), "utf8");
      expect(recordedHtml).not.toContain("<script");
    } finally {
      await browser.close();
    }
  });

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  for (const variant of ["source", "recorded"] as const) {
    test(`extract preserves snake_case schema keys on ${variant}`, async () => {
      let modelCalls = 0;
      const model: ClientLLM = {
        generate: async (params) => {
          const format = params.responseFormat;
          expect(format?.type).toBe("json_schema");
          if (format?.type !== "json_schema") throw new Error("Expected extraction schema");
          if (format.name === "Metadata")
            return {
              role: "assistant",
              content: { type: "text", text: "complete" },
              outputFormat: "json_schema",
              structuredContent: { progress: "Extracted both fields", completed: true },
            };
          modelCalls++;
          // This is the exact invariant broken by #2624. Check the schema that
          // actually reaches the model, not the original SDK argument.
          expect(
            format.schema,
            `Schema received by model: ${JSON.stringify(format.schema)}`,
          ).toMatchObject({
            properties: { company_name: { type: "string" }, employee_count: { type: "number" } },
            required: ["company_name", "employee_count"],
          });
          expect(format.schema).not.toHaveProperty("properties.companyName");
          const prompt = params.messages
            .flatMap((message) =>
              (Array.isArray(message.content) ? message.content : [message.content])
                .filter((content) => content.type === "text")
                .map((content) => content.text),
            )
            .join("\n");
          // Read values from Stagehand's browser observation, rather than returning
          // canned success independent of the page. Node IDs are session-local.
          const company = prompt.match(/Acme Labs/);
          const employees = prompt.match(/\b42\b/);
          expect(company).not.toBeNull();
          expect(employees).not.toBeNull();
          observations.push(prompt.replace(/\[\d+-\d+\]/g, "[id]"));
          return {
            role: "assistant",
            content: { type: "text", text: "deterministic extraction" },
            outputFormat: "json_schema",
            structuredContent: { company_name: company![0], employee_count: Number(employees![0]) },
          };
        },
      };
      const browser = await localBrowser.launch({ headless: true });
      let stagehand: Stagehand | undefined;
      try {
        stagehand = await Stagehand.create({ browser, model, logging: { level: "off" } });
        const page = await browser.context.newPage();
        await page.goto(`${serverUrl}${variant}`);
        if (variant === "source") await page.locator("#load").click();
        const result = await stagehand.extract(
          "Extract the company name and employee count.",
          schema,
          { page },
        );
        expect(result.data).toEqual({ company_name: "Acme Labs", employee_count: 42 });
        expect(modelCalls).toBe(1);
      } finally {
        try {
          await stagehand?.close();
        } finally {
          await browser.close();
        }
      }
    });
  }

  test("recording preserves the extraction prompt apart from session-local element IDs", () => {
    expect(observations).toHaveLength(2);
    expect(observations[1]).toBe(observations[0]);
  });
});
