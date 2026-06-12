/**
 * This example shows how to use the Yutori Navigator n1.5 computer-use model
 * as a Stagehand CUA agent.
 *
 * Navigator n1.5 is served via an OpenAI-compatible Chat Completions API at
 * https://api.yutori.com/v1 and reasons over screenshots with coordinate-based
 * actions in a normalized 1000x1000 space.
 *
 * It demonstrates:
 *   1. Basic CUA usage
 *   2. Structured output via `execute({ output })`
 *   3. Extra page capabilities as custom tools via `agent({ tools })`
 *
 * Setup:
 *   export YUTORI_API_KEY=yt-...
 *
 * @see https://docs.yutori.com/reference/n1-5.md
 *
 * NOTE: Configure browser dimensions when using a computer use agent.
 */
import { z } from "zod";
import { tool } from "ai";
import { Stagehand } from "../lib/v3/index.js";
import chalk from "chalk";

async function main() {
  console.log(`\n${chalk.bold("Stagehand 🤘 Yutori Navigator n1.5 Demo")}\n`);

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    experimental: true, // Required for custom agent tools (part 3)
    localBrowserLaunchOptions: {
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    },
  });
  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto("https://www.yutori.com");

    // ── 1. Basic CUA usage ──────────────────────────────────────────────
    const agent = stagehand.agent({
      mode: "cua",
      model: "yutori/n1.5-latest",
      // Auth defaults to process.env.YUTORI_API_KEY and https://api.yutori.com/v1.
      // To override, pass a model object instead:
      // model: {
      //   modelName: "yutori/n1.5-latest",
      //   apiKey: process.env.YUTORI_API_KEY,
      //   baseURL: "https://api.yutori.com/v1",
      // },
    });

    const instruction = "List the names of the team members on this site.";
    console.log(`Instruction: ${chalk.white(instruction)}`);

    const result = await agent.execute({
      instruction,
      maxSteps: 30,
    });

    console.log(`${chalk.green("✓")} Execution complete`);
    console.log(`${chalk.yellow("⤷")} Message: ${chalk.white(result.message)}`);

    // ── 2. Structured output ────────────────────────────────────────────
    // Pass a Zod schema as `output` and the agent returns matching JSON in
    // `result.output` when the task completes.
    const structured = await agent.execute({
      instruction: "Collect the names of the team members on this site.",
      maxSteps: 30,
      output: z.object({
        teamMembers: z.array(z.string().describe("A team member's name")),
      }),
    });

    console.log(`${chalk.green("✓")} Structured output:`);
    console.log(chalk.white(JSON.stringify(structured.output, null, 2)));

    // ── 3. Custom tools ─────────────────────────────────────────────────
    // Extra page capabilities come in as user-provided tools: define them
    // with the AI SDK `tool()` helper, close over the Stagehand page, and
    // the model drives them like any other tool. (This replaces the previous
    // Navigator "expanded tool set" — DOM-level capabilities are supplied by
    // the user rather than built into the provider.)
    const extractLinks = tool({
      description:
        "Extract all link URLs and their text from the current page DOM. " +
        "Faster and more reliable than reading links off the screenshot.",
      inputSchema: z.object({}),
      execute: async () => {
        const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]"))
            .slice(0, 100)
            .map((a) => ({
              text: (a.textContent ?? "").trim(),
              href: (a as HTMLAnchorElement).href,
            })),
        );
        return { links };
      },
    });

    const executeJs = tool({
      description:
        "Evaluate a JavaScript expression in the current page and return " +
        "its JSON-serialized result.",
      inputSchema: z.object({
        expression: z
          .string()
          .describe("A JavaScript expression to evaluate in the page"),
      }),
      execute: async ({ expression }) => {
        const value = await page.evaluate(expression);
        return { value };
      },
    });

    const agentWithTools = stagehand.agent({
      mode: "cua",
      model: "yutori/n1.5-latest",
      tools: { extractLinks, executeJs },
    });

    const toolsResult = await agentWithTools.execute({
      instruction:
        "Use the extractLinks tool to list the social media profiles this site links to.",
      maxSteps: 15,
    });

    console.log(`${chalk.green("✓")} Custom-tools run complete`);
    console.log(
      `${chalk.yellow("⤷")} Message: ${chalk.white(toolsResult.message)}`,
    );
  } catch (error) {
    console.log(`${chalk.red("✗")} Error: ${error}`);
    if (error instanceof Error && error.stack) {
      console.log(chalk.dim(error.stack.split("\n").slice(1).join("\n")));
    }
  } finally {
    await stagehand.close();
  }
}

main().catch((error) => {
  console.log(`${chalk.red("✗")} Unhandled error in main function`);
  console.log(chalk.red(error));
});
