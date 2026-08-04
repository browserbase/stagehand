import { defineBenchTask } from "../../../framework/defineTask.js";
import type { Action } from "@browserbasehq/stagehand";

const filler = Array.from(
  // Keep backend node IDs large enough to exercise Anthropic's bare-id failure mode.
  { length: 2500 },
  (_, index) => `<span hidden data-filler="${index}">filler ${index}</span>`,
).join("");

const cases = [
  {
    instruction: "Find the Target Checkout button",
    marker: "checkout",
    label: "Target Checkout",
  },
  {
    instruction: "Find the Pricing Plans button",
    marker: "pricing",
    label: "Pricing Plans",
  },
  {
    instruction: "Find the Request Demo button",
    marker: "demo",
    label: "Request Demo",
  },
] as const;

function buildHtml(): string {
  const buttons = cases
    .map(
      ({ marker, label }) => `
        ${filler}
        <section>
          <button onclick="document.body.dataset.clicked = '${marker}'">
            ${label}
          </button>
        </section>
      `,
    )
    .join("");

  return `data:text/html,${encodeURIComponent(`
    <!doctype html>
    <html>
      <body>
        <main>${buttons}</main>
      </body>
    </html>
  `)}`;
}

export default defineBenchTask(
  { name: "observe_main_frame_element_ids" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(buildHtml());

      const results: Array<{
        instruction: string;
        clicked: string | undefined;
        observations: Action[];
      }> = [];
      for (const testCase of cases) {
        await page.evaluate(() => {
          delete document.body.dataset.clicked;
        });

        const { data: observations } = await stagehand.observe(testCase.instruction);
        if (observations.length === 0) {
          return {
            _success: false,
            failedInstruction: testCase.instruction,
            reason: "observe returned no elements",
            results,
            debugUrl,
            sessionUrl,
            logs: logger.getLogs(),
          };
        }

        await stagehand.act(observations[0]);
        const clicked = await page.evaluate<string | undefined>(
          () => document.body.dataset.clicked,
        );
        results.push({
          instruction: testCase.instruction,
          clicked,
          observations,
        });

        if (clicked !== testCase.marker) {
          return {
            _success: false,
            failedInstruction: testCase.instruction,
            expectedClicked: testCase.marker,
            clicked,
            results,
            debugUrl,
            sessionUrl,
            logs: logger.getLogs(),
          };
        }
      }

      return {
        _success: true,
        results,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
