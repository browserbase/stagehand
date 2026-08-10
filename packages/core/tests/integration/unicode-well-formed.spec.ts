import { expect, test } from "@playwright/test";
import { V3 } from "../../lib/v3/v3.js";
import {
  closeV3,
  createScriptedAisdkTestLlmClient,
  promptToText,
} from "./testUtils.js";
import { getV3TestConfig } from "./v3.config.js";

function encodeHtml(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

test("repairs page text before local SDK model calls", async () => {
  let observedPromptText = "";
  const llmClient = createScriptedAisdkTestLlmClient({
    modelId: "mock/unicode-well-formed",
    jsonResponses: {
      Observation: (options) => {
        observedPromptText = promptToText(options.prompt);
        expect(
          (
            observedPromptText as string & { isWellFormed(): boolean }
          ).isWellFormed(),
        ).toBe(true);
        expect(observedPromptText).toContain("Draw Again. \uFFFD");
        return { elements: [] };
      },
    },
  });

  const v3 = new V3(getV3TestConfig({ llmClient }));
  await v3.init();

  try {
    const page = v3.context.pages()[0];
    await page.goto(
      encodeHtml(`<!doctype html>
<meta charset="utf-8">
<h1 id="target"></h1>
<script>
  document.getElementById("target").textContent =
    "Draw Again. " + String.fromCharCode(0xd83c);
</script>`),
    );

    const observed = await v3.observe("Find the promo banner text");

    expect(observed).toEqual([]);
    expect(observedPromptText).not.toBe("");
  } finally {
    await closeV3(v3);
  }
});
