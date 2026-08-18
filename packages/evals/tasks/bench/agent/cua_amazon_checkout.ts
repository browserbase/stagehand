import { defineBenchTask } from "../../../framework/defineTask.js";

/**
 * Deterministic CUA agent regression task (see #2188).
 *
 * Unlike the rubric-graded agent benchmarks, this task runs against a pinned
 * static fixture and passes only when the agent reaches an exact, known URL.
 * A failure is therefore attributable to a real provider/plumbing regression
 * rather than to page drift or LLM-judge noise. It exercises the full
 * computer-use loop (provider function-response decoding -> browser action)
 * end to end — the path that broke in #2046 (fixed by #2159) and #2035, and
 * which is otherwise only covered transitively by the heavyweight
 * WebVoyager / OnlineMind2Web suites.
 *
 * The task is mode-agnostic; point it at a CUA model to exercise the CUA path:
 *   evals run agent/cua_amazon_checkout --agent-mode cua \
 *     --model google/gemini-2.5-computer-use-preview-10-2025
 *
 * To keep failures easy to attribute (per review discussion on #2188), the
 * result records the model/agent-mode path that ran and whether the agent ever
 * left the start page — i.e. whether a failure occurred before or after the
 * first browser action. Finer-grained path attribution (function-response vs
 * browser-execution) lives in the per-step trajectory logged below.
 */
export default defineBenchTask(
  { name: "agent/cua_amazon_checkout" },
  async ({ debugUrl, sessionUrl, logger, agent, v3, input, modelName }) => {
    const startUrl =
      "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/";
    const expectedUrl =
      "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/sign-in.html";

    try {
      if (!agent) {
        throw new Error(
          "agent/cua_amazon_checkout requires an agent instance — run it under an agent mode (e.g. --agent-mode cua).",
        );
      }

      const page = v3.context.pages()[0];
      await page.goto(startUrl);

      const agentResult = await agent.execute({
        instruction:
          "Add the product to the cart and proceed to checkout. Stop when you reach the sign-in page.",
        maxSteps: Number(process.env.AGENT_EVAL_MAX_STEPS) || 10,
      });
      logger.log(agentResult);

      const currentUrl = page.url();

      return {
        _success: currentUrl === expectedUrl,
        currentUrl,
        expectedUrl,
        // Attribution context (see #2188): which provider/model path ran, and
        // whether the agent got past the initial page before failing.
        modelName,
        agentMode: input.agentMode,
        isCUA: input.isCUA,
        leftStartPage: currentUrl !== startUrl,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error,
        modelName,
        agentMode: input.agentMode,
        isCUA: input.isCUA,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await v3.close();
    }
  },
);
