/**
 * Web Performance Vitals Measurement with Stagehand Agent
 *
 * Measures REAL web performance metrics (LCP, FCP, TTFB, CLS) using Stagehand
 * Agent custom tools — without AI thinking time polluting the results.
 *
 * The Problem:
 *   Customers using Stagehand Agent with Date.now() to measure page load times
 *   get inflated numbers because the AI "thinking time" (LLM inference, DOM
 *   analysis) is included in the measurement.
 *
 * The Solution:
 *   Use the browser's native Performance APIs via custom agent tools. These
 *   measure what the BROWSER actually experiences, not the AI overhead.
 *
 * Two measurement approaches:
 *
 * 1. Navigation Timing (get_navigation_timing) — Use AFTER arriving at a new
 *    page via full navigation. Reads from the browser's built-in
 *    PerformanceNavigationTiming entry which persists across page loads.
 *    This is the PRIMARY measurement tool.
 *
 * 2. Observer-based (start/collect_perf_measurement) — Use for SPA transitions
 *    or interactions that DON'T cause a full page load (e.g., clicking a tab,
 *    opening a modal, lazy-loading content). These use PerformanceObservers
 *    that live in the page's JS context and are LOST on full navigation.
 *
 * Usage:
 *   npm install
 *   cp .env.example .env  # Add your API keys
 *   npm run demo
 *
 * @author Browserbase
 * @created 2025-02-12
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { tool } from "ai";
import "dotenv/config";

// ─── Collected metrics store (Node.js side, survives navigations) ────────────

interface PageMetrics {
  label: string;
  url: string;
  timestamp: string;
  first_paint_ms: number | null;
  fcp_ms: number | null;
  lcp_ms: number | null;
  lcp_element: string | null;
  cls: number | null;
  ttfb_ms: number | null;
  dom_interactive_ms: number | null;
  dom_content_loaded_ms: number | null;
  full_load_ms: number | null;
  dns_ms: number | null;
  tcp_ms: number | null;
  tls_ms: number | null;
  transfer_size_bytes: number | null;
  long_tasks_count: number | null;
  long_task_total_ms: number | null;
}

const allMetrics: PageMetrics[] = [];

// ─── Custom Performance Tools ────────────────────────────────────────────────

/**
 * Injects PerformanceObservers into the page to passively collect
 * LCP, CLS, and Long Task entries. Use for SPA transitions (no full nav).
 */
const startPerfMeasurement = tool({
  description:
    "Start measuring web performance metrics for a SPA transition or interaction " +
    "that does NOT cause a full page navigation. Sets up PerformanceObservers for " +
    "LCP, CLS, and Long Tasks. NOTE: These observers live in the page JS context " +
    "and will be LOST if a full page navigation occurs. For full navigations, use " +
    "get_navigation_timing AFTER the new page loads instead.",
  inputSchema: z.object({
    label: z
      .string()
      .describe(
        "A descriptive label for this measurement, e.g. 'open_modal', 'switch_tab', 'lazy_load_content'",
      ),
  }),
  execute: async ({ label }) => {
    const page = (globalThis as any).__stagehandPage;
    if (!page) return { success: false, error: "No page reference available" };

    await page.evaluate((measureLabel: string) => {
      (window as any).__perfMeasurements = (window as any).__perfMeasurements || {};
      (window as any).__perfMeasurements[measureLabel] = {
        startTime: performance.now(),
        lcp: null,
        lcpElement: null,
        fcp: null,
        cls: 0,
        clsEntries: 0,
        longTasks: 0,
        longTaskDuration: 0,
      };

      const m = (window as any).__perfMeasurements[measureLabel];

      // LCP Observer
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            const last = entries[entries.length - 1] as any;
            m.lcp = Math.round(last.startTime);
            m.lcpElement = last.element?.tagName || "unknown";
          }
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        /* not supported */
      }

      // CLS Observer
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!(entry as any).hadRecentInput) {
              m.cls += (entry as any).value;
              m.clsEntries++;
            }
          }
        }).observe({ type: "layout-shift", buffered: true });
      } catch {
        /* not supported */
      }

      // Long Tasks Observer
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            m.longTasks++;
            m.longTaskDuration += entry.duration;
          }
        }).observe({ type: "longtask", buffered: true });
      } catch {
        /* not supported */
      }

      // FCP — grab from paint entries if already fired
      const paintEntries = performance.getEntriesByType("paint");
      const fcp = paintEntries.find((e) => e.name === "first-contentful-paint");
      if (fcp) {
        m.fcp = Math.round(fcp.startTime);
      }
    }, label);

    return {
      success: true,
      message: `Performance measurement '${label}' started. Observers recording LCP, CLS, and Long Tasks. Remember: these will be lost on full page navigation.`,
    };
  },
});

/**
 * Collects metrics from PerformanceObservers set up by startPerfMeasurement.
 * Only works if the page hasn't fully navigated away.
 */
const collectPerfMetrics = tool({
  description:
    "Collect web performance metrics from a previous start_perf_measurement call. " +
    "Only works for SPA transitions — if a full page navigation occurred, the " +
    "measurement data will be gone. Use get_navigation_timing instead for full navs.",
  inputSchema: z.object({
    label: z
      .string()
      .describe(
        "The label of the measurement to collect — must match a previous start_perf_measurement call",
      ),
  }),
  execute: async ({ label }) => {
    const page = (globalThis as any).__stagehandPage;
    if (!page) return { success: false, error: "No page reference available" };

    const metrics = await page.evaluate((measureLabel: string) => {
      const m = (window as any).__perfMeasurements?.[measureLabel];
      if (!m) {
        return {
          error: `No measurement found with label '${measureLabel}'. This likely means a full page navigation occurred and wiped the observers. Use get_navigation_timing instead.`,
        };
      }

      const endTime = performance.now();
      const navEntries = performance.getEntriesByType("navigation");
      const nav = navEntries.length > 0 ? (navEntries[0] as any) : null;

      // Re-check FCP in case it fired after start
      if (!m.fcp) {
        const paintEntries = performance.getEntriesByType("paint");
        const fcp = paintEntries.find((e: PerformanceEntry) => e.name === "first-contentful-paint");
        if (fcp) m.fcp = Math.round(fcp.startTime);
      }

      return {
        label: measureLabel,
        url: window.location.href,
        lcp_ms: m.lcp,
        lcp_element: m.lcpElement,
        fcp_ms: m.fcp,
        cls: Math.round(m.cls * 1000) / 1000,
        cls_shift_count: m.clsEntries,
        ttfb_ms: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
        dom_content_loaded_ms: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        full_load_ms: nav ? Math.round(nav.loadEventEnd) : null,
        dom_interactive_ms: nav ? Math.round(nav.domInteractive) : null,
        dns_ms: nav ? Math.round(nav.domainLookupEnd - nav.domainLookupStart) : null,
        tcp_ms: nav ? Math.round(nav.connectEnd - nav.connectStart) : null,
        tls_ms:
          nav && nav.secureConnectionStart > 0
            ? Math.round(nav.connectEnd - nav.secureConnectionStart)
            : null,
        transfer_size_bytes: nav ? nav.transferSize : null,
        long_tasks_count: m.longTasks,
        long_task_total_ms: Math.round(m.longTaskDuration),
        wall_clock_ms: Math.round(endTime - m.startTime),
      };
    }, label);

    if (metrics.error) {
      return { success: false, error: metrics.error };
    }

    // Store metrics on Node.js side
    allMetrics.push({
      label: metrics.label,
      url: metrics.url,
      timestamp: new Date().toISOString(),
      first_paint_ms: null,
      fcp_ms: metrics.fcp_ms,
      lcp_ms: metrics.lcp_ms,
      lcp_element: metrics.lcp_element,
      cls: metrics.cls,
      ttfb_ms: metrics.ttfb_ms,
      dom_interactive_ms: metrics.dom_interactive_ms,
      dom_content_loaded_ms: metrics.dom_content_loaded_ms,
      full_load_ms: metrics.full_load_ms,
      dns_ms: metrics.dns_ms,
      tcp_ms: metrics.tcp_ms,
      tls_ms: metrics.tls_ms,
      transfer_size_bytes: metrics.transfer_size_bytes,
      long_tasks_count: metrics.long_tasks_count,
      long_task_total_ms: metrics.long_task_total_ms,
    });

    const lines = [
      `Performance metrics for '${label}':`,
      `  LCP: ${metrics.lcp_ms ?? "N/A"}ms | FCP: ${metrics.fcp_ms ?? "N/A"}ms | CLS: ${metrics.cls ?? "N/A"}`,
      `  TTFB: ${metrics.ttfb_ms ?? "N/A"}ms | Full Load: ${metrics.full_load_ms ?? "N/A"}ms`,
      `  Long Tasks: ${metrics.long_tasks_count} (${metrics.long_task_total_ms}ms total)`,
    ];

    console.log(`\n  [TOOL] ${lines.join("\n         ")}\n`);

    return { success: true, metrics, message: lines.join("\n") };
  },
});

/**
 * Grabs navigation timing + paint metrics for the current page.
 * This is the PRIMARY tool for measuring full page navigations because it reads
 * from the browser's built-in Navigation Timing API which persists across loads.
 */
const getNavigationTiming = tool({
  description:
    "Get detailed performance metrics for the CURRENT page load including Core Web " +
    "Vitals (FCP, LCP, TTFB), navigation phases (DNS, TCP, TLS, DOM parsing), and " +
    "transfer sizes. This is the PRIMARY tool for measuring full page navigations. " +
    "Call this AFTER navigating to a new page. Does NOT require a prior " +
    "start_perf_measurement call — it reads from the browser's built-in Navigation " +
    "Timing API which persists across page loads.",
  inputSchema: z.object({
    label: z
      .string()
      .describe(
        "A descriptive label for this page measurement, e.g. 'homepage', 'newest_stories', 'article_page'",
      ),
  }),
  execute: async ({ label }) => {
    const page = (globalThis as any).__stagehandPage;
    if (!page) return { success: false, error: "No page reference available" };

    const timing = await page.evaluate(() => {
      const navEntries = performance.getEntriesByType("navigation");
      const nav = navEntries.length > 0 ? (navEntries[0] as any) : null;
      if (!nav) return { error: "No navigation entry available" };

      // Paint timings
      const paintEntries = performance.getEntriesByType("paint");
      const fcp = paintEntries.find((e: PerformanceEntry) => e.name === "first-contentful-paint");
      const fp = paintEntries.find((e: PerformanceEntry) => e.name === "first-paint");

      // LCP — attempt to read via getEntriesByType
      let lcpValue: number | null = null;
      let lcpElement: string | null = null;
      try {
        const lcpEntries = (performance as any).getEntriesByType("largest-contentful-paint");
        if (lcpEntries && lcpEntries.length > 0) {
          const last = lcpEntries[lcpEntries.length - 1];
          lcpValue = Math.round(last.startTime);
          lcpElement = last.element?.tagName || null;
        }
      } catch {
        /* LCP not available via getEntriesByType */
      }

      // CLS — sum all layout shift entries
      let clsValue = 0;
      try {
        const clsEntries = (performance as any).getEntriesByType("layout-shift");
        if (clsEntries) {
          for (const entry of clsEntries) {
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
            }
          }
        }
      } catch {
        /* CLS not available */
      }

      return {
        url: nav.name,
        first_paint_ms: fp ? Math.round(fp.startTime) : null,
        fcp_ms: fcp ? Math.round(fcp.startTime) : null,
        lcp_ms: lcpValue,
        lcp_element: lcpElement,
        cls: Math.round(clsValue * 1000) / 1000,
        redirect_ms: Math.round(nav.redirectEnd - nav.redirectStart),
        dns_ms: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
        tcp_ms: Math.round(nav.connectEnd - nav.connectStart),
        tls_ms:
          nav.secureConnectionStart > 0
            ? Math.round(nav.connectEnd - nav.secureConnectionStart)
            : null,
        ttfb_ms: Math.round(nav.responseStart - nav.requestStart),
        response_download_ms: Math.round(nav.responseEnd - nav.responseStart),
        dom_parsing_ms: Math.round(nav.domInteractive - nav.responseEnd),
        dom_interactive_ms: Math.round(nav.domInteractive),
        dom_content_loaded_ms: Math.round(nav.domContentLoadedEventEnd),
        dom_complete_ms: Math.round(nav.domComplete),
        full_load_ms: Math.round(nav.loadEventEnd),
        transfer_size_bytes: nav.transferSize,
        encoded_body_size_bytes: nav.encodedBodySize,
        decoded_body_size_bytes: nav.decodedBodySize,
      };
    });

    if (timing.error) {
      return { success: false, error: timing.error };
    }

    // Store metrics on Node.js side
    allMetrics.push({
      label,
      url: timing.url,
      timestamp: new Date().toISOString(),
      first_paint_ms: timing.first_paint_ms,
      fcp_ms: timing.fcp_ms,
      lcp_ms: timing.lcp_ms,
      lcp_element: timing.lcp_element,
      cls: timing.cls,
      ttfb_ms: timing.ttfb_ms,
      dom_interactive_ms: timing.dom_interactive_ms,
      dom_content_loaded_ms: timing.dom_content_loaded_ms,
      full_load_ms: timing.full_load_ms,
      dns_ms: timing.dns_ms,
      tcp_ms: timing.tcp_ms,
      tls_ms: timing.tls_ms,
      transfer_size_bytes: timing.transfer_size_bytes,
      long_tasks_count: null,
      long_task_total_ms: null,
    });

    // Pretty console output
    const lines = [
      `Navigation Timing for '${label}' (${timing.url}):`,
      `  Core Web Vitals:`,
      `    FCP:  ${timing.fcp_ms ?? "N/A"}ms`,
      `    LCP:  ${timing.lcp_ms ?? "N/A"}ms${timing.lcp_element ? ` (${timing.lcp_element})` : ""}`,
      `    CLS:  ${timing.cls}`,
      `    TTFB: ${timing.ttfb_ms}ms`,
      `  Navigation Phases:`,
      `    DNS: ${timing.dns_ms}ms -> TCP: ${timing.tcp_ms}ms -> TLS: ${timing.tls_ms ?? "N/A"}ms -> TTFB: ${timing.ttfb_ms}ms`,
      `    Response: ${timing.response_download_ms}ms -> DOM Parse: ${timing.dom_parsing_ms}ms`,
      `    DOM Interactive: ${timing.dom_interactive_ms}ms -> DCL: ${timing.dom_content_loaded_ms}ms -> Complete: ${timing.dom_complete_ms}ms`,
      `    Full Load: ${timing.full_load_ms}ms`,
      `  Transfer: ${timing.transfer_size_bytes} bytes (${timing.decoded_body_size_bytes} decoded)`,
    ];

    console.log(`\n  [TOOL] ${lines.join("\n         ")}\n`);

    return { success: true, timing, message: lines.join("\n") };
  },
});

// ─── Utility: print metrics summary ──────────────────────────────────────────

function printMetricsSummary() {
  console.log("=".repeat(50));
  console.log("  COLLECTED PERFORMANCE METRICS SUMMARY");
  console.log("=".repeat(50));
  console.log();

  for (const m of allMetrics) {
    console.log(`  ${m.label}`);
    console.log(`  ${m.url}`);
    console.log(`  +-------------------------------------------+`);
    console.log(
      `  |  FCP:  ${String(m.fcp_ms ?? "N/A").padStart(7)}ms   LCP:  ${String(m.lcp_ms ?? "N/A").padStart(7)}ms  |`,
    );
    console.log(
      `  |  TTFB: ${String(m.ttfb_ms ?? "N/A").padStart(7)}ms   CLS:  ${String(m.cls ?? "N/A").padStart(7)}     |`,
    );
    console.log(
      `  |  Full: ${String(m.full_load_ms ?? "N/A").padStart(7)}ms   DCL:  ${String(m.dom_content_loaded_ms ?? "N/A").padStart(7)}ms  |`,
    );
    console.log(
      `  |  DNS:  ${String(m.dns_ms ?? "N/A").padStart(7)}ms   TCP:  ${String(m.tcp_ms ?? "N/A").padStart(7)}ms  |`,
    );
    console.log(
      `  |  TLS:  ${String(m.tls_ms ?? "N/A").padStart(7)}ms   Size: ${String(m.transfer_size_bytes ?? "N/A").padStart(7)} B  |`,
    );
    console.log(`  +-------------------------------------------+`);
    console.log();
  }

  if (allMetrics.length === 0) {
    console.log("  No metrics were collected. Check agent output above.\n");
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n  Web Performance Vitals Agent\n");
  console.log("  Measures REAL browser performance metrics — not AI thinking time.\n");

  const env = (process.env.STAGEHAND_ENV as "LOCAL" | "BROWSERBASE") || "LOCAL";

  const stagehand = new Stagehand({
    env,
    verbose: 1,
    experimental: true,
    disableAPI: true,
  });
  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];

    // Store page ref so tools can access it
    (globalThis as any).__stagehandPage = page;

    // Navigate to Hacker News
    await page.goto("https://news.ycombinator.com", {
      waitUntil: "networkidle",
    });

    console.log("  Page loaded. Starting agent...\n");

    // Create agent with performance measurement tools
    const agent = stagehand.agent({
      model: "anthropic/claude-sonnet-4-20250514",
      systemPrompt: `You are a web performance analyst. You have tools to measure real browser
performance metrics like LCP, FCP, TTFB, and CLS.

IMPORTANT — Two measurement approaches:

1. **get_navigation_timing** — Use AFTER a full page navigation (clicking a link
   that loads a new page, or using goto). This reads from the browser's built-in
   Navigation Timing API and always works. This is your PRIMARY measurement tool.

2. **start_perf_measurement + collect_perf_metrics** — Use for SPA transitions
   (interactions that change content WITHOUT a full page load, like tabs, modals,
   lazy loading). These observers live in the page JS and are LOST on full navigation.

WORKFLOW:
1. Navigate to a page (via goto or clicking a link)
2. After the page loads, call get_navigation_timing with a descriptive label
3. Repeat for each page you visit
4. At the end, summarize ALL metrics

The metrics you collect are REAL browser metrics from the Performance API — they
accurately reflect actual website performance regardless of AI processing time.`,
      tools: {
        start_perf_measurement: startPerfMeasurement,
        collect_perf_metrics: collectPerfMetrics,
        get_navigation_timing: getNavigationTiming,
      },
    });

    const instruction = `
You are on Hacker News (news.ycombinator.com). Please do the following:

1. Measure the navigation timing for this initial Hacker News homepage load (label: "hn_homepage").
2. Click the "new" link in the top navigation to go to newest stories. After it loads, measure navigation timing (label: "hn_newest").
3. Click on any story link (an external article link, not a comments link). After it loads, measure navigation timing (label: "external_article").
4. Give me a clear performance comparison of all three pages.

For each page, report: FCP, LCP, TTFB, CLS, and full load time.
    `.trim();

    console.log("  Instruction:", instruction, "\n");

    const result = await agent.execute({
      instruction,
      maxSteps: 30,
    });

    console.log("\n  Agent finished\n");

    // Print collected metrics
    printMetricsSummary();

    console.log("  Agent's Analysis:");
    console.log(result.message);
    console.log(`\n  Completed: ${result.completed} | Steps: ${result.actions.length}\n`);
  } catch (error) {
    console.error("  Error:", error);
    if (error instanceof Error && error.stack) {
      console.error(error.stack.split("\n").slice(1).join("\n"));
    }
  } finally {
    await stagehand.close();
  }
}

main().catch((error) => {
  console.error("  Unhandled error:", error);
  process.exit(1);
});
