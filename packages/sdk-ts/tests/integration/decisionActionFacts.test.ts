import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFacts } from "../../../extension/services/decisions/actionFacts.js";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("decision action facts in Chrome", () => {
  let stagehand: Stagehand;

  beforeAll(async () => {
    stagehand = await createStagehand();
  });
  afterAll(() => closeStagehand(stagehand));

  it("resolves absolute paths again when a DOM getter replaces an indexed ancestor", async () => {
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<section><button>Original</button></section>");
    await page.evaluate(() => {
      const section = document.querySelector("section")!;
      Object.defineProperty(section, "value", {
        get() {
          section.outerHTML = "<section><button>Replacement</button></section>";
          return "";
        },
      });
    });
    const body = "/html[1]/body[1]";
    const facts = await page.evaluate(readFacts, {
      html: "/html[1]",
      body,
      section: body + "/section[1]",
      button: body + "/section[1]/button[1]",
    });
    expect(facts.button?.text).toBe("Replacement");
  });

  it("keeps all matches of an unindexed ancestor available to its descendants", async () => {
    const page = await firstPage(stagehand);
    await page.goto("data:text/html,<main></main><main><button>Second main</button></main>");
    const facts = await page.evaluate(readFacts, {
      main: "//main",
      button: "//main/button[1]",
      text: "//main/button[1]/text()[1]",
    });
    expect(facts.button?.text).toBe("Second main");
    expect(facts.text?.text).toBe("Second main");
  });
});
