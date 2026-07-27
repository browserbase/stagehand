import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "observe_file_uploads" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/file-uploads-3/",
      );

      const observations = await stagehand.observe(
        "find the file upload element",
      );

      if (observations.length === 0) {
        return {
          _success: false,
          message: "observe returned no results",
          observations,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }

      const expectedLocator = `xpath=/html/body/input`;

      // v3 compares backendNodeIds; the v4 Locator exposes no node identity
      // (V4_API_LOGS.md #3), so the same element-identity check is
      // re-expressed in-page: resolve the observed selector and the expected
      // selector and compare element references.
      const foundMatch = await page.evaluate(
        ({
          observedSelector,
          expectedSelector,
        }: {
          observedSelector: string;
          expectedSelector: string;
        }) => {
          const resolve = (selector: string): Element | null => {
            const raw = selector.startsWith("xpath=")
              ? selector.slice("xpath=".length)
              : selector;
            if (raw.startsWith("/") || raw.startsWith("(")) {
              const result = document.evaluate(
                raw,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null,
              );
              return result.singleNodeValue as Element | null;
            }
            return document.querySelector(raw);
          };

          const expected = resolve(expectedSelector);
          const observed = resolve(observedSelector);
          return expected !== null && expected === observed;
        },
        {
          observedSelector: observations[0].selector,
          expectedSelector: expectedLocator,
        },
      );

      return {
        _success: foundMatch,
        observations,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error,
        message: "returned selector does not resolve to same node as expected",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
