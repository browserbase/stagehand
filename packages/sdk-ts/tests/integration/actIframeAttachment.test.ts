import { afterEach, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("iframe attachment after string act", () => {
  let stagehand: Stagehand | undefined;
  let fixture: FixtureServer | undefined;

  afterEach(async () => {
    await closeStagehand(stagehand);
    await fixture?.close();
  });

  it("keeps newly created cross-origin iframes visible to snapshots and actions", async () => {
    let childClicks = 0;
    fixture = await startFixtureServer({
      "/": "<!doctype html><button onclick=\"this.dataset.clicked='yes'\">Continue</button>",
      "/child":
        '<!doctype html><button id="child" onclick="fetch(\'/clicked\')">Child action</button>',
      "/clicked": () => {
        childClicks++;
        return "ok";
      },
    });
    let targetText = "Continue";
    stagehand = await createStagehand({
      browser: {
        args: ["--host-resolver-rules=MAP child.test 127.0.0.1", "--site-per-process"],
      },
      model: {
        generate: async (params) => {
          const prompt = params.messages
            .flatMap(({ content }) => (Array.isArray(content) ? content : [content]))
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          const elementId = prompt
            .split("\n")
            .find((line) => line.includes(targetText) && /\[\d+-\d+\]/.test(line))
            ?.match(/\[(\d+-\d+)\]/)?.[1];
          expect(elementId).toBeDefined();
          return {
            role: "assistant",
            content: { type: "text", text: "Click " + targetText },
            outputFormat: "json_schema",
            structuredContent: {
              action: {
                elementId: elementId!,
                description: targetText,
                method: "click",
                arguments: [],
              },
              twoStep: false,
            },
          };
        },
      },
    });
    const page = await firstPage(stagehand);
    await page.goto(fixture.url);
    const childUrl = new URL("/child", fixture.url);
    childUrl.hostname = "child.test";
    const addChild = () =>
      page.evaluate(
        (url) =>
          new Promise<void>((resolve) => {
            const iframe = document.createElement("iframe");
            iframe.onload = () => resolve();
            iframe.src = url;
            document.body.append(iframe);
          }),
        childUrl.href,
      );
    const expectChildInSnapshot = () =>
      expect
        .poll(
          async () => (await page.snapshot({ includeIframes: true, timeout: 2_000 })).formattedTree,
          { timeout: 5_000 },
        )
        .toContain("Child action");

    // Control: this same cross-site fixture is accessible before the string act.
    await addChild();
    await expectChildInSnapshot();
    await page.locator("iframe >> #child").click();
    await expect.poll(() => childClicks).toBe(1);
    await page.evaluate(() => document.querySelector("iframe")!.remove());

    const result = await stagehand.act("Click Continue", { page });
    expect(result.data.success).toBe(true);
    await expect(
      page.evaluate(() => document.querySelector("button")!.dataset.clicked),
    ).resolves.toBe("yes");

    // Create a fresh OOPIF after act's network-settling helper has run.
    await addChild();
    await expectChildInSnapshot();
    targetText = "Child action";
    const childResult = await stagehand.act("Click Child action", { page });
    expect(childResult.data.success).toBe(true);
    await expect.poll(() => childClicks).toBe(2);
  });
});
