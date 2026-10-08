import { afterEach, describe, expect, it } from "vitest";
import type { ClientLLM, Stagehand } from "../../src/index.js";
import type { LLMGenerateParams } from "@browserbasehq/stagehand-protocol/types";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

const cases = [
  {
    name: "button after hidden filler nodes",
    instruction: "Find the Target Checkout button",
    targetText: "Target Checkout",
    marker: "checkout",
    html: `${Array.from({ length: 80 }, (_, index) => `<span hidden>filler ${index}</span>`).join("")}<button onclick="document.body.dataset.clicked='checkout'">Target Checkout</button>`,
  },
  {
    name: "navigation link",
    instruction: "Find the Pricing Plans link",
    targetText: "Pricing Plans",
    marker: "pricing",
    html: `<a href="#pricing" onclick="document.body.dataset.clicked='pricing'">Pricing Plans</a>`,
  },
  {
    name: "form input",
    instruction: "Find the Company Email input",
    targetText: "Company Email",
    marker: "email",
    html: `<label>Company Email <input onclick="document.body.dataset.clicked='email'"></label>`,
  },
] as const;

function promptText(params: LLMGenerateParams): string {
  return [
    params.systemPrompt ?? "",
    ...params.messages.flatMap((message) =>
      (Array.isArray(message.content) ? message.content : [message.content])
        .filter((content) => content.type === "text")
        .map((content) => content.text),
    ),
  ].join("\n");
}

describe("observe main-frame element IDs", () => {
  let stagehand: Stagehand | undefined;

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  for (const testCase of cases) {
    it(`keeps complete 0-ordinal element IDs for ${testCase.name}`, async () => {
      let observedElementId: string | undefined;
      const model: ClientLLM = {
        generate: async (params) => {
          const prompt = promptText(params);
          expect(prompt).toContain(testCase.targetText);
          const targetLine = prompt
            .split("\n")
            .find((line) => line.includes(testCase.targetText) && /\[\d+-\d+\]/.test(line));
          observedElementId = targetLine?.match(/\[(\d+-\d+)\]/)?.[1];
          expect(observedElementId).toMatch(/^0-\d+$/);

          return {
            role: "assistant",
            content: { type: "text", text: "structured observation" },
            outputFormat: "json_schema",
            structuredContent: {
              elements: [
                {
                  elementId: observedElementId!,
                  description: testCase.targetText,
                  method: "click",
                  arguments: [],
                },
              ],
            },
          };
        },
      };

      stagehand = await createStagehand({ model });
      const page = await firstPage(stagehand);
      await page.goto(`data:text/html,${encodeURIComponent(testCase.html)}`);

      const observed = await stagehand.observe(testCase.instruction);
      expect(observedElementId).toMatch(/^0-\d+$/);
      expect(observed.data).toHaveLength(1);
      expect(observed.data[0]?.selector).toMatch(/^xpath=/);

      const acted = await stagehand.act(observed.data[0]!);
      expect(acted.data.success).toBe(true);
      expect(await page.evaluate(() => document.body.dataset.clicked)).toBe(testCase.marker);
    });
  }
});
