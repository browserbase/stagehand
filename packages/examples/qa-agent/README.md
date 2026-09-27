# QA AI Agent Demo — Browserbase + Stagehand

Location in the Stagehand repository: `packages/examples/qa-agent`.

A demo showing how to build an AI-powered QA agent using [Browserbase](https://browserbase.com) and [Stagehand](https://stagehand.dev), with the [Vercel AI SDK](https://ai-sdk.dev) for tool orchestration.

The demo includes a **buggy e-commerce app** with 20 intentional bugs and a **QA agent** that automatically finds them using two different architectural approaches.

## Architecture

```
┌──────────────────────┐
│   Vercel AI SDK      │  Claude orchestrates the QA session
│   (Claude Sonnet)    │  via tool calls
└──────────┬───────────┘
           │ tool calls
           ▼
┌──────────────────────┐
│   Stagehand Tools    │  act(), extract(), observe(),
│   (or Agent)         │  screenshot(), a11y, UX audit
└──────────┬───────────┘
           │ browser commands
           ▼
┌──────────────────────┐
│   Browserbase        │  Cloud browser session
│   (Chrome)           │  with session recording
└──────────┬───────────┘
           │ navigates
           ▼
┌──────────────────────┐
│   BugMart App        │  Next.js app with
│   (target URL)       │  20 intentional bugs
└──────────────────────┘
```

## Two Approaches

### Approach A: Primitives as Tools

Each Stagehand primitive is exposed as an individual Vercel AI SDK tool. The LLM (Claude) decides which tool to call and when, maintaining full control over the testing flow. Includes programmatic checks like accessibility audits and a **UI/UX best practices audit** based on [userinterface.wiki](https://userinterface.wiki) (152 rules).

**Tools:** `navigate`, `act`, `extract`, `observe`, `screenshot`, `get_console_logs`, `check_accessibility`, `check_ux_best_practices`, `get_page_url`

### Approach B: Agent as Tool

Stagehand's built-in `agent()` is wrapped as a single tool in hybrid mode (DOM + screenshot-based). The outer LLM acts as a coordinator, delegating high-level testing tasks to the agent which autonomously navigates and interacts.

**Tools:** `stagehand_agent`, `extract_data`, `screenshot`, `get_console_logs`

### Comparison

| Dimension           | Approach A (Primitives)                        | Approach B (Agent)                                 |
| ------------------- | ---------------------------------------------- | -------------------------------------------------- |
| **Control**         | Full — LLM decides every click                 | Delegated — agent navigates autonomously           |
| **Custom checks**   | Can run JS (console logs, a11y, UX audit)      | Limited to what the agent sees visually            |
| **Token usage**     | Higher outer-loop (every step hits LLM)        | Lower outer-loop, but agent uses tokens internally |
| **Debugging**       | Every action visible as a tool call            | Agent steps are partially opaque                   |
| **Code complexity** | More tool definitions to write                 | Fewer, simpler tools                               |
| **Flexibility**     | Mix browser actions with custom logic          | Constrained to agent capabilities                  |
| **Best for**        | Protocol-driven testing with custom assertions | Exploratory testing, quick coverage                |
| **Bug types found** | Visual + programmatic + UX violations          | Primarily visual + functional                      |

## Benchmark Results

We ran both approaches against the same buggy app. Results are non-deterministic (LLM-based), but the pattern is consistent across runs:

| Metric         | Approach A (Primitives) | Approach B (Agent) |
| -------------- | ----------------------- | ------------------ |
| **Duration**   | ~139s                   | ~337s              |
| **Tool calls** | 34                      | 15 (outer)         |
| **Bugs found** | 11                      | 6                  |

### What Each Approach Catches

| Bug                               | Approach A         | Approach B         |
| --------------------------------- | ------------------ | ------------------ |
| Negative price (-$5.00)           | :white_check_mark: | :white_check_mark: |
| Price 10x on detail pages         | :white_check_mark: | :white_check_mark: |
| Broken image (keyboard 404)       | :white_check_mark: | :x:                |
| "Prodcuts" typo                   | :white_check_mark: | :x:                |
| Missing alt text (a11y)           | :white_check_mark: | :x:                |
| Heading hierarchy skip (a11y)     | :white_check_mark: | :x:                |
| Console errors / 404s             | :white_check_mark: | :white_check_mark: |
| Low contrast text (a11y)          | :white_check_mark: | :x:                |
| Small click targets (UX)          | :white_check_mark: | :x:                |
| Typography violations (UX)        | :white_check_mark: | :x:                |
| Disabled button no indicator (UX) | :white_check_mark: | :x:                |
| Cart nav link → /carts (404)      | :x:                | :white_check_mark: |

### Key Insights

1. **Approach A excels at systematic, programmatic testing.** The `check_accessibility` and `check_ux_best_practices` tools run JavaScript audits that catch issues no amount of visual browsing would find (missing alt text, heading hierarchy, click target sizes, font-variant-numeric).

2. **Approach B excels at exploratory, user-like testing.** The autonomous agent naturally clicks nav links and follows user flows, which is how it caught the broken cart link (`/carts` instead of `/cart`) that Approach A missed by navigating directly via URL.

3. **Custom `page.evaluate()` tools don't mix well with the agent approach.** Adding UX audit tools to Approach B caused a regression (from 10 bugs to 5) because the coordinator had to waste steps navigating the agent back to pages just to run JS checks. Removing them restored performance. The lesson: **let each approach play to its strengths**.

4. **Combine both for maximum coverage.** Run Approach A for protocol-driven testing with custom assertions, then run Approach B for exploratory testing that mimics real user behavior. Together they catch more than either alone.

## Bug Catalog

The buggy app contains 20 intentional bugs across different categories:

| #   | Type           | Page           | Description                                       | Difficulty  |
| --- | -------------- | -------------- | ------------------------------------------------- | ----------- |
| 01  | Missing image  | Homepage       | Product image returns 404                         | Obvious     |
| 02  | Wrong price    | Product detail | Price displayed 10x too high                      | Non-obvious |
| 03  | Negative price | Homepage       | Product shows -$5.00                              | Obvious     |
| 04  | Race condition | Cart           | Double-click adds item twice                      | Non-obvious |
| 05  | Off-by-one     | Cart           | Quantity goes to 0 instead of removing item       | Non-obvious |
| 06  | Typo           | Homepage       | Heading says "Our Prodcuts"                       | Obvious     |
| 07  | Console error  | All pages      | Failed fetch to /api/analytics                    | Non-obvious |
| 08  | Dead button    | Homepage       | Add to Cart disabled on product #3, no visual cue | Non-obvious |
| 09  | Accessibility  | Homepage       | Images missing alt text                           | Non-obvious |
| 10  | Layout         | Product detail | Description overlaps button on narrow viewport    | Non-obvious |
| 11  | Calculation    | Cart           | Tax = subtotal x 0.8 instead of 0.08 (80% tax!)   | Non-obvious |
| 12  | Calculation    | Cart           | Total doesn't include tax                         | Non-obvious |
| 13  | Validation     | Checkout       | Email field accepts any string                    | Non-obvious |
| 14  | Validation     | Checkout       | Card number accepts letters                       | Non-obvious |
| 15  | Dead button    | Checkout       | "Place Order" does nothing (TODO in code)         | Obvious     |
| 16  | Accessibility  | About          | Light gray text (#ccc) on white background        | Non-obvious |
| 17  | Broken link    | About          | "Contact Us" links to /contact (404)              | Obvious     |
| 18  | Accessibility  | About          | Heading jumps h1 to h4                            | Non-obvious |
| 19  | Broken link    | Navbar         | Cart link points to /carts (typo)                 | Obvious     |
| 20  | CSS            | Global         | Modal z-index: -1 (behind content)                | Non-obvious |

## Setup

### Prerequisites

- Node.js 18+
- A [Browserbase](https://browserbase.com) account
- An [Anthropic](https://console.anthropic.com) API key
- An [OpenAI](https://platform.openai.com) API key
- [ngrok](https://ngrok.com) (if running the buggy app locally — Browserbase needs a public URL)

### 1. Start the Buggy App

```bash
cd buggy-app
npm install
npm run dev
# Runs on http://localhost:3000
```

If using Browserbase (cloud browser), expose your local app via ngrok:

```bash
ngrok http 3000
# Copy the https://xxxx.ngrok-free.app URL
```

### 2. Configure the QA Agent

```bash
cd qa-agent
npm install
cp .env.example .env
```

Edit `.env` with your keys:

```
BROWSERBASE_API_KEY=your-key
BROWSERBASE_PROJECT_ID=your-project-id
OPENAI_API_KEY=your-key
ANTHROPIC_API_KEY=your-key
APP_URL=https://your-ngrok-url.ngrok-free.app
```

### 3. Run the QA Agent

```bash
# Approach A: Primitives as Tools (with UX audit)
npm run approach-a

# Approach B: Agent as Tool (exploratory)
npm run approach-b

# Or use the CLI
npm start -- a
npm start -- b
```

Watch the live browser session in your [Browserbase dashboard](https://browserbase.com/sessions).

## How It Works

### Approach A Flow

1. Claude receives a system prompt with the testing strategy
2. It calls `navigate` to go to each page
3. It uses `extract` to check data, `act` to interact, `observe` to plan
4. It runs `check_accessibility` and `check_ux_best_practices` for programmatic checks
5. It takes `screenshot`s to visually inspect pages
6. After testing all pages, it compiles a bug report

### Approach B Flow

1. Claude acts as a coordinator, breaking testing into chunks
2. Each chunk is delegated to `stagehand_agent` (e.g., "test the homepage for all visible issues")
3. The agent autonomously navigates, clicks, and explores in hybrid mode (DOM + screenshots)
4. Claude reviews agent results and extracts additional data
5. Console logs are checked between agent tasks
6. All findings are compiled into a final report

## The UX Best Practices Tool

Approach A includes a `check_ux_best_practices` tool that runs automated checks based on [userinterface.wiki](https://userinterface.wiki) — 152 rules across 12 categories. The tool runs `page.evaluate()` to programmatically check:

- **Fitts's Law**: Interactive targets must be at least 32x32px
- **Hick's Law**: Navigation shouldn't have >7 items without grouping
- **Z-index hierarchy**: Flags negative z-index values
- **Tabular numbers**: Prices should use `font-variant-numeric: tabular-nums`
- **Text-wrap balance**: Headings should use `text-wrap: balance`
- **Active states**: Buttons should have transitions for feedback
- **Input types**: Email fields should use `type="email"`, not `type="text"`
- **Disabled states**: Disabled buttons must have visual indicators (opacity, cursor)
- **Progressive disclosure**: Forms with >6 fields should be broken into sections

This tool is only effective in Approach A because it requires direct browser control via `page.evaluate()`. The agent in Approach B navigates autonomously and can't run custom JavaScript checks.

## Extending This Demo

- **Add more bugs**: Edit the app files in `buggy-app/src/`
- **Add more tools**: Extend `qa-agent/src/approach-a/tools.ts`
- **Add more UX rules**: Extend the `check_ux_best_practices` tool with rules from [userinterface.wiki](https://userinterface.wiki)
- **Custom test plans**: Modify the system prompts in the run files
- **Different models**: Change the model in `stagehand-init.ts` or the `generateText` calls
- **Combine approaches**: Run A then B for maximum coverage
