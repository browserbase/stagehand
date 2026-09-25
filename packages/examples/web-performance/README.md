# Web Performance Vitals with Stagehand Agent

Location in the Stagehand repository: `packages/examples/web-performance`.

Measure **real** web performance metrics (LCP, FCP, TTFB, CLS) using Stagehand Agent custom tools — without AI thinking time polluting the results.

## The Problem

When customers use Stagehand Agent with `Date.now()` to measure page load times:

```typescript
const start = Date.now();
await stagehand.act({ action: "click login button" });
await stagehand.act({ action: "wait for dashboard" });
const elapsed = Date.now() - start; // 8000ms!!! (but real load was only 1200ms)
```

The measurement includes AI inference time (1-5s per action), DOM analysis, and element identification — none of which represent actual website performance.

## The Solution

Use the browser's native Performance APIs via Stagehand Agent custom tools. The agent decides **when** to measure, but the measurements come from the browser engine itself.

```
Stagehand Agent = the robot driving the car
Performance APIs = the speedometer
```

### Three Custom Tools

| Tool                     | When to Use                                 | Survives Navigation?                   |
| ------------------------ | ------------------------------------------- | -------------------------------------- |
| `get_navigation_timing`  | After a full page load (click link, goto)   | Yes — reads from Navigation Timing API |
| `start_perf_measurement` | Before a SPA transition (tab switch, modal) | No — lives in page JS context          |
| `collect_perf_metrics`   | After a SPA transition completes            | No — paired with start above           |

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment variables
cp .env.example .env
# Add your ANTHROPIC_API_KEY (or OPENAI_API_KEY) to .env

# Run the demo
npm run demo
```

## What It Measures

For each page the agent visits, you get:

**Core Web Vitals:**

- **FCP** (First Contentful Paint) — When the first content appears
- **LCP** (Largest Contentful Paint) — When the main content is visible
- **CLS** (Cumulative Layout Shift) — Visual stability score
- **TTFB** (Time to First Byte) — Server response time

**Navigation Phases:**

- DNS lookup, TCP connect, TLS negotiation
- Response download, DOM parsing
- DOM Interactive, DOMContentLoaded, Full Load

**Transfer Sizes:**

- Compressed and decompressed payload sizes

## Example Output

```
==================================================
  COLLECTED PERFORMANCE METRICS SUMMARY
==================================================

  hn_homepage
  https://news.ycombinator.com/
  +-------------------------------------------+
  |  FCP:      352ms   LCP:      N/Ams  |
  |  TTFB:     313ms   CLS:        0     |
  |  Full:     332ms   DCL:      332ms  |
  |  DNS:        0ms   TCP:        0ms  |
  |  TLS:        0ms   Size:    6224 B  |
  +-------------------------------------------+

  external_article
  https://example.com/article
  +-------------------------------------------+
  |  FCP:      960ms   LCP:      N/Ams  |
  |  TTFB:     256ms   CLS:        0     |
  |  Full:    1433ms   DCL:      936ms  |
  |  DNS:      271ms   TCP:      139ms  |
  |  TLS:       77ms   Size:    5507 B  |
  +-------------------------------------------+
```

## How It Works

1. The script creates three custom tools using the AI SDK `tool()` function
2. These tools are passed to `stagehand.agent()` via the `tools` parameter
3. The agent autonomously navigates and decides when to call measurement tools
4. Each tool uses `page.evaluate()` to run Performance API calls in the browser
5. Results are stored on the Node.js side (surviving page navigations)
6. A summary table is printed at the end

### Key Insight: Why Measurements Are Accurate

The Performance APIs (Navigation Timing, PerformanceObserver) are part of the browser engine. They measure real network latency, rendering time, and paint events **regardless of what's happening in the Node.js process**. The AI can take 10 seconds to "think" and the TTFB will still correctly report 200ms.

## Adapting for Your Use Case

### Measuring Login Performance

```typescript
const instruction = `
  1. Go to https://app.example.com/login
  2. Measure the login page load (label: "login_page")
  3. Fill in username "test@example.com" and password "testpass"
  4. Before clicking submit, start a perf measurement (label: "login_submit")
  5. Click the login/submit button
  6. After the dashboard loads, measure navigation timing (label: "dashboard_load")
  7. Report all metrics
`;
```

### Measuring Multiple Pages in a Flow

```typescript
const instruction = `
  1. Go to https://app.example.com and measure (label: "homepage")
  2. Click "Products" and measure (label: "products_page")
  3. Click on the first product and measure (label: "product_detail")
  4. Click "Add to Cart" — this is a SPA transition, so start_perf_measurement first
  5. After the cart updates, collect_perf_metrics (label: "add_to_cart")
  6. Compare all page load times
`;
```

## Environment Variables

| Variable                 | Required | Description                               |
| ------------------------ | -------- | ----------------------------------------- |
| `ANTHROPIC_API_KEY`      | Yes\*    | Anthropic API key for Claude              |
| `OPENAI_API_KEY`         | Yes\*    | OpenAI API key (alternative to Anthropic) |
| `BROWSERBASE_API_KEY`    | No       | For running in Browserbase cloud          |
| `BROWSERBASE_PROJECT_ID` | No       | For running in Browserbase cloud          |
| `STAGEHAND_ENV`          | No       | `LOCAL` (default) or `BROWSERBASE`        |

\*At least one LLM API key is required.

## Running in Browserbase Cloud

```bash
# Set Browserbase credentials in .env, then:
npm run demo:bb
```

## File Structure

```
web-perf-vitals-demo/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── src/
    └── perf-vitals-agent.ts   # Main demo script with tools
```
