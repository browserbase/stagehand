import { Stagehand } from "../../lib/v3/index.js";
import { createReporter } from "crawldex-report";
import { reportStagehandRun } from "crawldex-report/stagehand";

type CrawlDexConfig = {
  crawldex: boolean;
  site: string;
  task: string;
  reportUrl?: string;
  agentKey?: string;
};

const crawldex: CrawlDexConfig = {
  crawldex: true,
  site: "example.com",
  task: "subscriptions.cancel",
  reportUrl: process.env.CRAWLDEX_REPORT_URL,
  agentKey: process.env.CRAWLDEX_AGENT_KEY,
};

export async function runSubscriptionCancellation(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  const reporter = createReporter({
    reportUrl: crawldex.reportUrl,
    agentKey: crawldex.agentKey,
  });

  if (crawldex.crawldex) {
    const preflight = await reporter.preflight(crawldex.site, crawldex.task);
    if (preflight.warning) {
      console.warn(`CrawlDex preflight warning: ${preflight.warning}`);
    }
    if (
      preflight.verdict === "avoid_until_fresh_evidence" ||
      preflight.verdict === "collect_evidence_first"
    ) {
      console.warn(
        `CrawlDex recommends caution for ${crawldex.site} ${crawldex.task}`,
      );
    }
  }

  if (!crawldex.crawldex) {
    await page.goto("https://example.com/account");
    await stagehand.act("Open subscription settings", { page });
    await stagehand.act(
      "Start cancellation and stop before final confirmation",
      { page },
    );
    return { outcome: "success_with_handoff" as const };
  }

  return reportStagehandRun({
    reporter,
    stagehand: { page },
    site: crawldex.site,
    task: crawldex.task,
    agentProfile: {
      stack: "stagehand",
      browser_runtime: "chromium",
    },
    async run({ page: runPage, mark }) {
      const activePage = runPage as typeof page;
      await activePage.goto("https://example.com/account");
      await stagehand.act("Open subscription settings", { page: activePage });
      mark("subscription_settings_visible");
      await stagehand.act(
        "Start cancellation and stop before final confirmation",
        { page: activePage },
      );
      mark("cancel_flow_reached");
      return {
        outcome: "success_with_handoff",
        friction: ["final_confirmation_user_present"],
        evidenceSignals: ["handoff_before_final_submit"],
      };
    },
  });
}
