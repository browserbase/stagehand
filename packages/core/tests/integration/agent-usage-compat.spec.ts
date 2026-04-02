import { expect, test } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import { closeV3, createScriptedAisdkTestLlmClient } from "./testUtils.js";
import { getV3TestConfig } from "./v3.config.js";

function encodeHtml(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

test.describe("agent usage compatibility", () => {
  test("agent.execute() preserves the legacy usage shape", async () => {
    const llmClient = createScriptedAisdkTestLlmClient({
      generateResponses: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "done-1",
              toolName: "done",
              input: JSON.stringify({
                reasoning: "Task completed successfully",
                taskComplete: true,
              }),
            },
          ],
          finishReason: { unified: "tool-calls", raw: "tool-calls" },
          usage: {
            inputTokens: {
              total: 11,
              noCache: 9,
              cacheRead: 2,
              cacheWrite: 0,
            },
            outputTokens: {
              total: 7,
              text: 2,
              reasoning: 5,
            },
          },
        },
      ],
    });

    const v3 = new V3(
      getV3TestConfig({
        experimental: true,
        llmClient,
      }),
    );

    await v3.init();

    try {
      const page = v3.context.pages()[0];
      await page.goto(
        encodeHtml(`
          <!doctype html>
          <html>
            <body>
              <h1>Agent Usage Compat</h1>
            </body>
          </html>
        `),
      );

      const result = await v3.agent().execute({
        instruction: "Finish immediately.",
        maxSteps: 1,
      });

      expect(result.success).toBe(true);
      expect(result.completed).toBe(true);
      expect(result.usage).toEqual({
        input_tokens: 11,
        output_tokens: 7,
        reasoning_tokens: 5,
        cached_input_tokens: 2,
        inference_time_ms: expect.any(Number),
      });
      expect(result.usage).not.toHaveProperty("inputTokens");
      expect(result.usage).not.toHaveProperty("outputTokens");
      expect(result.usage).not.toHaveProperty("reasoningTokens");
      expect(result.usage).not.toHaveProperty("cachedInputTokens");
      expect(result.usage?.inference_time_ms).toBeGreaterThanOrEqual(0);
    } finally {
      await closeV3(v3);
    }
  });
});
