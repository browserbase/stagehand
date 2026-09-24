import "dotenv/config";
import { openai } from "@ai-sdk/openai";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { generateText, Output, stepCountIs, tool } from "ai";
import { z } from "zod/v4";

const sourceUrls = [
  "https://docs.stagehand.dev/v4/basics/act",
  "https://docs.stagehand.dev/v4/basics/extract",
] as const;
const factsSchema = z.object({
  title: z.string().min(1),
  facts: z.array(z.string().min(1)).min(1).max(8),
});
const reportSchema = z.object({
  answer: z.string().min(1),
  sources: z
    .array(
      z.object({
        url: z.url(),
        factsUsed: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(2),
});
const browserbaseKey = process.env.BROWSERBASE_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
if (!browserbaseKey || !openaiKey)
  throw new Error("BROWSERBASE_API_KEY and OPENAI_API_KEY are required");
const browser = await browserbase.launch({ apiKey: browserbaseKey });
try {
  const stagehand = await Stagehand.create({
    browser,
    model: { modelName: "openai/gpt-5.4-mini", apiKey: openaiKey },
  });
  try {
    const page = await browser.context.activePage();
    if (!page) throw new Error("No active page");
    const visited = new Set<string>();
    const extracted = new Set<string>();
    const tools = {
      visitSource: tool({
        description: "Visit one of the two approved Stagehand documentation pages.",
        inputSchema: z.object({ url: z.url() }),
        execute: async ({ url }) => {
          if (!sourceUrls.includes(url as (typeof sourceUrls)[number]))
            throw new Error(`URL is not an approved source: ${url}`);
          await page.goto(url);
          visited.add(url);
          return { url: await page.url(), title: await page.title() };
        },
      }),
      readCurrentPage: tool({
        description: "Extract typed facts from the current approved source.",
        inputSchema: z.object({ question: z.string().min(1) }),
        execute: async ({ question }) => {
          const url = await page.url();
          if (!sourceUrls.includes(url as (typeof sourceUrls)[number]))
            throw new Error("Current page is not an approved source");
          const result = await stagehand.extract(
            `Extract facts relevant to this question: ${question}`,
            factsSchema,
            { page },
          );
          extracted.add(url);
          return { url, ...factsSchema.parse(result.data) };
        },
      }),
    };
    const result = await generateText({
      model: openai(process.env.OPENAI_MODEL ?? "gpt-5.4"),
      instructions:
        "Visit and read both approved pages. Cite only URLs returned by the tools. Compare act and extract. Do not invent facts.",
      prompt: `Compare when to use act() and extract(). Read ${sourceUrls.join(" and ")}.`,
      tools,
      output: Output.object({ schema: reportSchema }),
      stopWhen: stepCountIs(10),
    });
    const report = reportSchema.parse(result.output);
    for (const url of sourceUrls) {
      if (
        !visited.has(url) ||
        !extracted.has(url) ||
        !report.sources.some((source) => source.url === url)
      ) {
        throw new Error(`Research is incomplete for ${url}`);
      }
    }
    if (
      report.sources.some(
        (source) => !sourceUrls.includes(source.url as (typeof sourceUrls)[number]),
      )
    ) {
      throw new Error("Report cites an unapproved source");
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await stagehand.close();
  }
} finally {
  await browser.close();
}
