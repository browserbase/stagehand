import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "multi_tab" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/",
      );

      await stagehand.act("click the button to open the other page");
      await stagehand.act("click the button to open the other page");
      await stagehand.act("click the button to open the other page");
      await stagehand.act("click the button to open the other page");
      // v3: v3.context.awaitActivePage(); v4: context.activePage()
      let activePage = await stagehand.context.activePage();
      if (!activePage) {
        throw new Error("no active page after opening tabs");
      }

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
      // V4 GAP: stagehand.act has no { page } option (v3:
      // v3.act(instruction, { page: page1 })) — activate the target page
      // via setActivePage before acting instead.
      await stagehand.context.setActivePage(page1);
      await stagehand.act("click the button to open the other page");

      activePage = await stagehand.context.activePage();
      if (!activePage) {
        throw new Error("no active page after acting on the first page");
      }
      currentPageUrl = await activePage.url();
      expectedUrl =
        "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page2.html";
      if (currentPageUrl !== expectedUrl) {
        return {
          _success: false,
          message: "expected URL does not match current URL",
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      // V4 GAP: extract has no { page } option (v3:
      // v3.extract({ page: activePage })) — the target page is already the
      // active page here, so extract operates on it. v3 also used schemaless
      // extract (V4_API_LOGS #2); v4 requires a schema. Single-word key to
      // stay clear of the snake_case wire-casing bug (#14).
      const page2text = await stagehand.extract(
        "extract the entire page text",
        z.object({ extraction: z.string() }),
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
