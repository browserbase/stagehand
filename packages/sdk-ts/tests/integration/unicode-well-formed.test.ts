import { expect, it } from "vitest";
import type { ClientLLM } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

it("repairs page text before local SDK model calls", async () => {
  let observedPromptText = "";
  const model: ClientLLM = {
    generate: async (params) => {
      observedPromptText = params.messages
        .flatMap((message) =>
          Array.isArray(message.content) ? message.content : [message.content],
        )
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n");
      expect((observedPromptText as string & { isWellFormed(): boolean }).isWellFormed()).toBe(
        true,
      );
      expect(observedPromptText).toContain("Draw Again. �");
      return {
        role: "assistant",
        content: { type: "text", text: "structured observation" },
        outputFormat: "json_schema",
        structuredContent: { elements: [] },
      };
    },
  };

  const stagehand = await createStagehand({ model });
  try {
    const page = await firstPage(stagehand);
    await page.goto(
      `data:text/html,${encodeURIComponent(`<meta charset="utf-8"><h1 id="target"></h1><script>target.textContent = "Draw Again. " + String.fromCharCode(0xd83c)</script>`)}`,
    );

    const observed = await stagehand.observe("Find the promo banner text");
    expect(observed.data).toEqual([]);
    const scoped = await stagehand.observe("Find the promo banner text", {
      locator: { selector: "#target" },
    });
    expect(scoped.data).toEqual([]);
    expect(observedPromptText).not.toBe("");
  } finally {
    await closeStagehand(stagehand);
  }
});
