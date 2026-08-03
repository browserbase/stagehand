import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "heal_simple_google_search" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/google/");

      // Self-healing act(Action) replay (restored by
      // stagehand#2427): same intentionally invalid selector as the v3
      // twin — healing must re-locate "The search bar" and fill it.
      const { data: healed } = await stagehand.act({
        description: "The search bar",
        selector: "/html/not-the-search-bar",
        arguments: ["OpenAI"],
        method: "fill",
      });

      // Without this the task presses Enter on an empty field and reports a
      // URL mismatch, hiding why healing did not happen. Note that healing
      // only runs when the client was initialized with selfHeal: true — the
      // server defaults it to false (actService.ts), and it cannot be set
      // per-call, so a failure here usually means an init-level difference.
      if (!healed.success) {
        return {
          _success: false,
          message: `self-heal did not fill the search bar: ${healed.message}`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      await stagehand.act("press enter");
      await new Promise((resolve) => setTimeout(resolve, 3000));

      const expectedUrl =
        "https://browserbase.github.io/stagehand-eval-sites/sites/google/openai.html";
      const currentUrl = await page.url();

      return {
        _success: currentUrl.startsWith(expectedUrl),
        currentUrl,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
