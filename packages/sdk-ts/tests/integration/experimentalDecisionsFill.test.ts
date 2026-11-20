import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage, startFixtureServer } from "./_support.js";

describe("experimentalDecisions fill dispatch", () => {
  let stagehand: Stagehand;

  beforeAll(async () => {
    stagehand = await createStagehand({ experimentalDecisions: { apiKey: "fixture" } });
  });
  afterAll(() => closeStagehand(stagehand));

  it("rejects redirected input even when the intended field already matches", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      "data:text/html,<input id=first value=expected><input id=second value=original>",
    );
    await page.evaluate(() => {
      const first = document.querySelector<HTMLInputElement>("#first")!;
      const second = document.querySelector<HTMLInputElement>("#second")!;
      first.addEventListener("beforeinput", () => second.focus());
      document.addEventListener("input", () => document.body.setAttribute("data-edited", "yes"));
    });
    const result = await stagehand.experimentalDecisions.act(
      { method: "fill", selector: "#first", arguments: ["expected"], description: "Fill first" },
      { page },
    );
    expect(result.data.success).toBe(false);
    expect(await page.locator("#second").inputValue()).toBe("original");
    expect(await page.evaluate(() => document.body.hasAttribute("data-edited"))).toBe(false);
  });

  it("verifies the edit inside a closed shadow root when the page advances focus", async () => {
    const fixture = await startFixtureServer(`
      <div id="host"></div><input id="next" value="untouched">
      <script>
        const root = document.querySelector("#host").attachShadow({ mode: "closed" });
        const input = document.createElement("input");
        input.id = "code";
        root.append(input);
        input.oninput = () => {
          document.body.dataset.code = input.value;
          document.querySelector("#next").focus();
        };
      </script>
    `);
    try {
      const page = await firstPage(stagehand);
      await page.goto(fixture.url);
      const { data } = await stagehand.experimentalDecisions.act(
        {
          method: "fill",
          selector: "//input[@id='code']",
          arguments: ["42"],
          description: "Fill code",
        },
        { page },
      );
      expect(data.success).toBe(true);
      expect(await page.evaluate(() => document.body.dataset.code)).toBe("42");
      expect(await page.locator("#next").inputValue()).toBe("untouched");
    } finally {
      await fixture.close();
    }
  });

  it("uses the native number input's prepared value", async () => {
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<input type=number value=12>");
    const result = await stagehand.experimentalDecisions.act(
      { method: "fill", selector: "input", arguments: [" 42 "], description: "Fill number" },
      { page },
    );
    expect(result.data.success).toBe(true);
    expect(await page.locator("input").inputValue()).toBe("42");
  });
});
