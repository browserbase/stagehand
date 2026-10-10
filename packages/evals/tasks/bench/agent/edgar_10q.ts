import { defineBenchTask } from "../../../framework/defineTask.js";

/**
 * Multi-company SEC 10-Q extraction — a long-horizon agent eval.
 *
 * For three companies, the agent must: find the most recent 10-Q on EDGAR,
 * open the actual primary document (not the filing index/cover page or an
 * exhibit), extract quarterly revenue / YoY growth / RPO / top risk factor,
 * and return a comparison table. This exercises long-horizon navigation across
 * an unknown number of pages plus synthesis across multiple documents.
 *
 * Scoring is OBJECTIVE: the agent's FINAL answer must contain the correct
 * quarterly revenue for all three companies. We score the final answer (not
 * intermediate tool output) on purpose — returning the synthesized result is
 * part of the task. An agent that extracts the data but reports only "task
 * complete" without the numbers has not finished the job, and this catches that.
 *
 * NOTE: the task targets the "MOST RECENT" 10-Q, so the ground-truth figures
 * below are a dated snapshot and must be refreshed when newer filings post.
 * Verified against SEC XBRL (data.sec.gov/api/xbrl/companyconcept) as of
 * 2026-06: SNOW & MDB quarter ended 2026-04-30, DDOG quarter ended 2026-03-31.
 * (Reviewers: an alternative is to pin the instruction to specific filing
 * periods so the ground truth never drifts — happy to switch if preferred.)
 */
const GROUND_TRUTH = [
  // Accept the figure as filed (thousands) or the rounded-millions form.
  { ticker: "SNOW", revenueTokens: ["1390951", "1390.9"] },
  { ticker: "DDOG", revenueTokens: ["1006426", "1006.4"] },
  { ticker: "MDB", revenueTokens: ["687616", "687.6"] },
];

const INSTRUCTION = `You are researching SEC filings on SEC EDGAR. For EACH of these three companies — Snowflake (ticker SNOW), Datadog (ticker DDOG), and MongoDB (ticker MDB):

1. Find the company's MOST RECENT 10-Q filing (use EDGAR full-text search at https://efts.sec.gov or company search at https://www.sec.gov/cgi-bin/browse-edgar).
2. Open the ACTUAL 10-Q document (the primary financial .htm document — NOT the filing index/cover page and NOT an exhibit).
3. From inside that document extract: (a) total revenue for the most recent quarter, with the dollar figure; (b) year-over-year revenue growth %; (c) RPO (remaining performance obligations) if disclosed; (d) the single top/most significant risk factor.

Do all three companies, then output a clear 3-company comparison table (Company, filing period, total revenue, YoY growth, RPO, top risk factor). Report the verbatim numbers you actually saw. Write "N/A" if you cannot find a value — do not guess.`;

export default defineBenchTask(
  { name: "agent/edgar_10q", tags: ["agent", "extraction", "long-horizon"] },
  async ({ debugUrl, sessionUrl, logger, agent, v3 }) => {
    try {
      const page = v3.context.pages()[0];
      try {
        await page.goto("https://efts.sec.gov", {
          waitUntil: "domcontentloaded",
          timeoutMs: 30000,
        });
      } catch {
        // non-fatal: let the agent navigate from a blank page
      }

      const agentResult = await agent.execute({
        instruction: INSTRUCTION,
        maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 50,
      });

      const answer = String(agentResult.message ?? "")
        .toLowerCase()
        .replace(/[\s,$]/g, "");
      const perCompany = GROUND_TRUTH.map((c) => ({
        ticker: c.ticker,
        revenueOk: c.revenueTokens.some((t) => answer.includes(t)),
      }));
      const revenueHits = perCompany.filter((c) => c.revenueOk).length;
      const success = revenueHits === GROUND_TRUTH.length;
      const detail = perCompany
        .map((c) => `${c.ticker}=${c.revenueOk ? "ok" : "miss"}`)
        .join(" ");

      logger.log({
        category: "evaluation",
        message: `edgar_10q: correct revenue for ${revenueHits}/${GROUND_TRUTH.length} companies (${detail})`,
        level: 1,
      });

      return {
        _success: success,
        message: success
          ? undefined
          : `Final answer was missing the correct revenue for one or more companies (${detail}).`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        _success: false,
        message: errorMessage,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await v3.close();
    }
  },
);
