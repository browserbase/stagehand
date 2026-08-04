import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "multi_tab" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/");

      // v3-parity form: activePage() polls until Chrome's active target
      // registers (stagehand#2458), and act resolves its target through it,
      // so back-to-back tab-opening acts chain without explicit waits.
      await stagehand.act("click the button to open the other page");
      await stagehand.act("click the button to open the other page");
      await stagehand.act("click the button to open the other page");
      await stagehand.act("click the button to open the other page");
      let activePage = await stagehand.context.activePage();
      if (!activePage) throw new Error("no active page after opening tabs");

      let currentPageUrl = await activePage.url();
      let expectedUrl =
        "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page5.html";

      if (currentPageUrl !== expectedUrl) {
        return {
          _success: false,
          message: "expected URL does not match current URL",
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      // try acting on the first page again
      const pages = await stagehand.context.pages();
      const page1 = pages[0];
      await stagehand.act("click the button to open the other page", { page: page1 });

      activePage = await stagehand.context.activePage();
      if (!activePage) throw new Error("no active page after acting on page 1");
      currentPageUrl = await activePage.url();
      expectedUrl = "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page2.html";
      if (currentPageUrl !== expectedUrl) {
        return {
          _success: false,
          message: "expected URL does not match current URL",
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      // Target the page the URL assertion just verified. Without { page },
      // extract resolves its own target through activePage() again, so a
      // focus change between the check and the extract would silently move
      // the assertion to another tab. v3 also used schemaless extract; v4
      // requires a schema. Single-word key to stay clear of the snake_case
      // wire-casing bug (#14).
      const { data: page2text } = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
        { page: activePage },
      );
      const expectedPage2text = "You've made it to page 2";

      if (page2text.extraction.includes(expectedPage2text)) {
        return {
          _success: true,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
        message: `extracted page text: ${page2text.extraction} does not match expected page text: ${expectedPage2text}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        message: (error as Error).message,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
