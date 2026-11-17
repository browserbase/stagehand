/**
 * Instructions the eval harness gives the Mastra agent.
 *
 * Mastra ships no system prompt of its own, so unlike the CLI harnesses there is
 * no stock prompt to leave in place: whatever the adapter passes is the whole
 * prompt. `EVAL_MASTRA_INSTRUCTIONS=minimal` restores the earlier one-line prompt
 * and `EVAL_MASTRA_FINISH_CHECK=0` turns the finish check off, for comparisons.
 */

/** The earlier one-line prompt. */
export const MASTRA_MINIMAL_INSTRUCTIONS =
  "Use the available browser/web tools to complete the task.";

/** General browsing guidance, with no site- or task-specific rules. */
export const MASTRA_BROWSER_INSTRUCTIONS = `You are a browser agent. You complete tasks on live websites using the browser tools, then report what you found.

How to work:
- Start from the given site when one is provided. Read the page before acting; prefer a fresh snapshot over guessing selectors.
- Keep going until the task is actually done. Do not stop after the first plausible answer when the task asks for the best, cheapest, latest, or a comparison: check enough candidates to be confident.
- Satisfy every constraint in the request (dates, quantities, locations, filters, price limits). Re-read the request before your final answer and check each one.
- Take values from the authoritative page. A retailer's, carrier's, or venue's own page beats a third-party summary.
- Resolve relative dates ("next Friday", "this weekend") against the date shown in the browser.
- If an action fails twice the same way, change approach: different element, search, URL, or navigation path. Do not repeat an identical failing action.
- Stop before any irreversible step. Reaching a cart, checkout, or booking form is fine; do not enter personal or payment details or submit an order unless the task explicitly asks.
- If a CAPTCHA, login wall, or site error blocks you, try another route to the same information. If none works, say exactly what blocked you.

Final answer:
- Answer the question directly first, with the specific values found (names, prices, dates, links).
- When the task asks for a table or list, give every requested field for every row.
- State any assumption you made, and anything you could not verify.`;

/**
 * Sent once when the agent first stops on its own. It asks for a re-read of the
 * task, not for more work: an agent that is done restates its answer.
 */
export const MASTRA_FINISH_CHECK_PROMPT =
  "Before you finish, re-read the original task. Check that every requirement and constraint " +
  "is met and that any comparison covers enough options. If something is missing or " +
  "unverified and you can still check it with the browser tools, keep working. Otherwise, " +
  "give your complete final answer again, in the required format.";

export interface MastraHarnessSettings {
  instructions: "browser" | "minimal";
  finishCheck: boolean;
  promptCaching: boolean;
}

const isOff = (value: string | undefined): boolean =>
  ["0", "false", "off", "no"].includes((value ?? "").trim().toLowerCase());

/** Defaults are the browser instructions with the finish check and prompt caching on. */
export function resolveMastraHarnessSettings(
  env: NodeJS.ProcessEnv = process.env,
): MastraHarnessSettings {
  return {
    instructions:
      (env.EVAL_MASTRA_INSTRUCTIONS ?? "").trim().toLowerCase() === "minimal"
        ? "minimal"
        : "browser",
    finishCheck: !isOff(env.EVAL_MASTRA_FINISH_CHECK),
    promptCaching: !isOff(env.EVAL_MASTRA_PROMPT_CACHE),
  };
}
