import { expect, test } from "@playwright/test";
import type { LanguageModelV2CallOptions } from "@ai-sdk/provider";
import { V3 } from "../../lib/v3/v3.js";
import { getV3TestConfig } from "./v3.config.js";
import {
  closeV3,
  createScriptedAisdkTestLlmClient,
  findLastEncodedId,
  promptToText,
} from "./testUtils.js";

const encodedIdPattern = /^\d+-\d+$/;
const mainFrameEncodedIdPattern = /^0-\d+$/;

function encodeHtml(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

type MainFrameCase = {
  name: string;
  instruction: string;
  targetText: string;
  marker: string;
  html: string;
};

const filler = Array.from(
  { length: 80 },
  (_, index) => `<span hidden data-filler="${index}">filler ${index}</span>`,
).join("");

const cases: MainFrameCase[] = [
  {
    name: "button after hidden filler nodes",
    instruction: "Find the Target Checkout button",
    targetText: "Target Checkout",
    marker: "checkout",
    html: `
      <!doctype html>
      <html>
        <body>
          ${filler}
          <main>
            <button onclick="document.body.dataset.clicked = 'checkout'">
              Target Checkout
            </button>
          </main>
        </body>
      </html>
    `,
  },
  {
    name: "navigation link",
    instruction: "Find the Pricing Plans link",
    targetText: "Pricing Plans",
    marker: "pricing",
    html: `
      <!doctype html>
      <html>
        <body>
          <nav>
            <a href="#pricing" onclick="document.body.dataset.clicked = 'pricing'">
              Pricing Plans
            </a>
          </nav>
        </body>
      </html>
    `,
  },
  {
    name: "form input",
    instruction: "Find the Company Email input",
    targetText: "Company Email",
    marker: "email",
    html: `
      <!doctype html>
      <html>
        <body>
          <form>
            <label>
              Company Email
              <input
                type="email"
                onclick="document.body.dataset.clicked = 'email'"
              />
            </label>
          </form>
        </body>
      </html>
    `,
  },
];

function observeResponseForTarget(
  testCase: MainFrameCase,
  onElementId: (elementId: string, options: LanguageModelV2CallOptions) => void,
) {
  return (options: LanguageModelV2CallOptions) => {
    const promptText = promptToText(options.prompt);
    expect(promptText).toContain(
      "Always copy the complete ID exactly as shown inside the brackets into elementId",
    );
    expect(promptText).toContain('return elementId "0-18372"');

    expect(promptText).toContain(testCase.targetText);

    const elementId = findLastEncodedId(options);
    expect(elementId).toMatch(encodedIdPattern);
    expect(elementId).toMatch(mainFrameEncodedIdPattern);
    onElementId(elementId, options);

    return {
      elements: [
        {
          elementId,
          description: testCase.targetText,
          method: "click",
          arguments: [] as string[],
        },
      ],
    };
  };
}

test.describe("observe main frame element IDs", () => {
  for (const testCase of cases) {
    test(`keeps complete 0-ordinal element IDs for ${testCase.name}`, async () => {
      let observedElementId: string | undefined;
      const llmClient = createScriptedAisdkTestLlmClient({
        modelId: "mock/observe-main-frame-element-id-format",
        jsonResponses: {
          Observation: observeResponseForTarget(testCase, (elementId) => {
            observedElementId = elementId;
          }),
        },
      });

      const v3 = new V3(
        getV3TestConfig({
          llmClient,
        }),
      );
      await v3.init();

      try {
        const page = v3.context.pages()[0];
        await page.goto(encodeHtml(testCase.html));

        const observed = await v3.observe(testCase.instruction);

        expect(observedElementId).toMatch(mainFrameEncodedIdPattern);
        expect(observed).toHaveLength(1);
        expect(observed[0].selector).toMatch(/^xpath=/);

        const actResult = await v3.act(observed[0]);
        expect(actResult.success).toBe(true);

        const clicked = await page.evaluate(
          () => document.body.dataset.clicked,
        );
        expect(clicked).toBe(testCase.marker);
      } finally {
        await closeV3(v3);
      }
    });
  }
});
