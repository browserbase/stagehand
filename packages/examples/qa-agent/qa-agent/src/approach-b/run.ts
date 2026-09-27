import { generateText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { createStagehand } from "../shared/stagehand-init.js";
import "dotenv/config";

const BASE_URL = process.env.APP_URL || "http://localhost:3000";

async function main() {
  console.log("=".repeat(60));
  console.log("QA Agent - Approach B: Stagehand Agent as Tool");
  console.log("=".repeat(60));
  console.log(`Target: ${BASE_URL}`);
  console.log();

  const stagehand = await createStagehand();
  const page = stagehand.page;
  const startTime = Date.now();

  const consoleLogs: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleLogs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });
  page.on("requestfailed", (req) => {
    consoleLogs.push(`[NETWORK_ERROR] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
  });

  // Define tools for the outer coordinator
  const tools = {
    // The main tool: delegate a QA task to the Stagehand autonomous agent
    stagehand_agent: tool({
      description:
        "Delegate a QA testing task to an autonomous browser agent. The agent will navigate, click, type, scroll, and inspect the page on its own. Give it a specific testing goal. The agent is best for exploratory testing of a page or flow.",
      parameters: z.object({
        instruction: z
          .string()
          .describe(
            "Detailed QA testing instruction for the agent. Be specific about what page to visit and what to test.",
          ),
        maxSteps: z.number().default(15).describe("Maximum steps the agent can take (default 15)"),
      }),
      execute: async ({ instruction, maxSteps }) => {
        console.log(`\n🤖 Agent task: ${instruction.substring(0, 100)}...`);
        try {
          const agent = stagehand.agent({
            modelName: "anthropic/claude-sonnet-4-20250514",
            mode: "hybrid", // Uses both DOM + CUA (screenshot-based) tools
          });
          const result = await agent.execute({
            instruction,
            maxSteps,
          });
          // Aggressively truncate to avoid blowing up the 200k token context
          // The agent result can contain screenshots (base64) and verbose logs
          const safeStringify = (obj: any, maxLen: number) => {
            try {
              const s = typeof obj === "string" ? obj : JSON.stringify(obj);
              return s?.substring(0, maxLen) || "no data";
            } catch {
              return "could not serialize";
            }
          };
          return {
            success: true,
            completed: result.completed,
            message: safeStringify(result.message, 1500),
            actionCount: result.actions?.length || 0,
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message?.substring(0, 500),
          };
        }
      },
    }),

    // Extract structured data (useful after agent completes a flow)
    extract_data: tool({
      description:
        "Extract structured data from the current page. Use after the agent has navigated to a page to pull specific information for verification.",
      parameters: z.object({
        instruction: z.string().describe("What to extract from the page"),
      }),
      execute: async ({ instruction }) => {
        try {
          const result = await stagehand.extract({
            instruction,
            schema: z.object({
              data: z.any().describe("The extracted data"),
            }),
          });
          // Truncate to avoid token explosion
          const extracted = JSON.stringify(result)?.substring(0, 3000);
          return { success: true, extracted };
        } catch (error: any) {
          return { success: false, error: error.message?.substring(0, 300) };
        }
      },
    }),

    // Get console logs accumulated during testing
    get_console_logs: tool({
      description:
        "Get JavaScript console errors and network failures captured during the session.",
      parameters: z.object({}),
      execute: async () => ({
        logs: consoleLogs.slice(0, 30).map((l) => l.substring(0, 200)),
        count: consoleLogs.length,
      }),
    }),

    // Take a screenshot and save to disk (not inline to avoid token explosion)
    screenshot: tool({
      description:
        "Take a screenshot of the current page state. Saves to disk and returns page text for analysis.",
      parameters: z.object({}),
      execute: async () => {
        try {
          const { mkdirSync, writeFileSync } = await import("fs");
          mkdirSync("screenshots", { recursive: true });
          const filename = `screenshots/screenshot-${Date.now()}.png`;
          const buffer = await page.screenshot({ fullPage: true });
          writeFileSync(filename, buffer);
          const textContent = await page.evaluate(() => document.body.innerText.substring(0, 2000));
          return { success: true, savedTo: filename, url: page.url(), pageText: textContent };
        } catch (error: any) {
          return { success: false, error: error.message?.substring(0, 200) };
        }
      },
    }),
  };

  try {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: `You are a QA test coordinator. You break testing into logical tasks and delegate each to an autonomous browser agent.

The application under test is "BugMart", an e-commerce store at ${BASE_URL}.

## Your Workflow
1. Delegate focused testing tasks to the stagehand_agent tool
2. After each agent task, review its findings
3. Use extract_data to verify specific data points (prices, calculations)
4. Use screenshot to visually inspect pages
5. Check get_console_logs periodically for JS errors
6. Compile all findings into a comprehensive bug report

## Pages to Test
- Homepage: ${BASE_URL}/
- Product details: ${BASE_URL}/product/1 through /product/6
- Cart: ${BASE_URL}/cart (need to add items first)
- Checkout: ${BASE_URL}/checkout
- About: ${BASE_URL}/about
- All navigation links

## Testing Areas
- Visual bugs (broken images, layout, typos)
- Functional bugs (broken buttons, forms, links)
- Data bugs (wrong prices, bad calculations)
- Validation bugs (forms accepting invalid input)
- Accessibility (alt text, contrast, headings)
- Console errors

After all testing, output a comprehensive bug report.`,
      prompt: `Begin QA testing of the BugMart application at ${BASE_URL}.

Delegate these tasks to the agent one at a time:
1. Test the homepage - check all products, images, prices, buttons, and text for issues
2. Test product detail pages (visit at least products 1, 2, 3, and 5) - check prices match, descriptions visible, add-to-cart works
3. Test the cart - add a few items first, then check calculations (subtotal, tax, total), and quantity controls
4. Test checkout - fill the form with invalid data (bad email, letters in card number), try to submit
5. Test the about page and all navigation links - check for broken links, accessibility issues

After each task, use extract_data or screenshot to verify specific concerns.
Check console logs periodically. Compile your complete bug report.`,
      tools,
      maxSteps: 25,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("\n" + "=".repeat(60));
    console.log("QA REPORT - Approach B: Agent as Tool");
    console.log("=".repeat(60));
    console.log(result.text);
    console.log("\n" + "-".repeat(60));
    console.log(`Duration: ${duration}s`);
    console.log(`Outer steps: ${result.steps?.length || "N/A"}`);
    console.log(
      `Tool calls: ${result.steps?.reduce((sum, s) => sum + (s.toolCalls?.length || 0), 0) || "N/A"}`,
    );
    console.log("=".repeat(60));
  } finally {
    await stagehand.close();
    console.log("\nSession closed.");
  }
}

main().catch(console.error);
