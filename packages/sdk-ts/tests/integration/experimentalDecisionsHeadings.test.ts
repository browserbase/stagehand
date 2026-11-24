import { expect, it } from "vitest";
import { z } from "zod/v4";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

it("copies rendered whitespace in a complete heading list", async () => {
  const stagehand = await createStagehand({ experimentalDecisions: { apiKey: "fixture" } });
  try {
    const page = await firstPage(stagehand);
    const html =
      '<h2 style="white-space:pre">git  log</h2><h2>Hard&nbsp;space</h2>' +
      '<h2>API<span style="display:block">reference</span></h2><h2>First<br>second</h2>';
    await page.goto("data:text/html;charset=utf-8," + encodeURIComponent(html));
    const result = await stagehand.experimentalDecisions.extract(
      "Copy all H2 headings in document order.",
      z.object({ headings: z.array(z.string()) }),
      { page, cache: false },
    );
    expect(result.data.headings).toEqual([
      "git  log",
      "Hard\u00a0space",
      "API reference",
      "First\nsecond",
    ]);
    expect(result.metadata.usage.inputTokens).toBe(0);
  } finally {
    await closeStagehand(stagehand);
  }
});
