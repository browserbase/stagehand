import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createStagehand } from "../shared/stagehand-init.js";
import { createTools } from "./tools.js";
import "dotenv/config";

const BASE_URL = process.env.APP_URL || "http://localhost:3000";

const SYSTEM_PROMPT = `You are a senior QA engineer performing comprehensive testing on a web application.
The application is an e-commerce store called "BugMart" running at ${BASE_URL}.

Your mission: Systematically test every page and feature, finding as many bugs as possible.

## Testing Strategy

Test each page in this order:
1. **Homepage** (${BASE_URL}/) - Check product listing, images, prices, text, buttons
2. **Product Detail Pages** (${BASE_URL}/product/1 through /product/6) - Check prices, descriptions, layout, add-to-cart
3. **Cart** (${BASE_URL}/cart) - Add items first, then check calculations, quantities, remove functionality
4. **Checkout** (${BASE_URL}/checkout) - Test form validation with invalid inputs, test submission
5. **About** (${BASE_URL}/about) - Check content, links, accessibility
6. **Navigation** - Test all nav links, check for broken links

## What to Check on Each Page
- Visual: broken images, layout overlaps, typos in text
- Functional: buttons that don't work, forms that don't validate, broken links
- Data: incorrect prices, wrong calculations, negative values
- Console: JavaScript errors, failed network requests
- Accessibility: missing alt text, contrast issues, heading hierarchy, missing labels
- UX Best Practices: click target sizes, typography, spacing, z-index issues, disabled button indicators, form field types

## Tools Available
- navigate: Go to a page
- act: Click buttons, fill forms, interact with elements
- extract: Pull data from the page to verify correctness
- observe: See what interactive elements are available
- screenshot: Take a screenshot for visual inspection
- get_console_logs: Check for JS errors
- check_accessibility: Run automated accessibility checks
- check_ux_best_practices: Run UI/UX best practices audit (userinterface.wiki 152 rules)
- get_page_url: Verify current URL

## Bug Report Format
After testing all pages, output a comprehensive bug report with:
- Bug ID, title, severity (critical/major/minor/cosmetic)
- Page where it occurs
- Steps to reproduce
- Expected vs actual behavior

Be thorough! A good QA engineer catches both obvious and subtle bugs.`;

async function main() {
  console.log("=".repeat(60));
  console.log("QA Agent - Approach A: Stagehand Primitives as Tools");
  console.log("=".repeat(60));
  console.log(`Target: ${BASE_URL}`);
  console.log();

  const stagehand = await createStagehand();
  const tools = createTools(stagehand);
  const startTime = Date.now();

  try {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      system: SYSTEM_PROMPT,
      prompt:
        "Begin your QA testing now. Start with the homepage and work through every page systematically. Use all available tools to find bugs. Report everything you find.",
      tools,
      maxSteps: 50,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log("\n" + "=".repeat(60));
    console.log("QA REPORT - Approach A: Primitives as Tools");
    console.log("=".repeat(60));
    console.log(result.text);
    console.log("\n" + "-".repeat(60));
    console.log(`Duration: ${duration}s`);
    console.log(`Steps: ${result.steps?.length || "N/A"}`);
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
