import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import type { LLMGenerateParams, LLMGenerateResult } from "@browserbasehq/stagehand-protocol/types";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

describe("public locator chaining", () => {
  let stagehand: Stagehand;
  let server: FixtureServer;
  const modelCalls: string[] = [];

  beforeAll(async () => {
    const child = `<section id="scope"><button id="save" onclick="this.dataset.clicked='yes'">Save target</button><button class="omit">Excluded choice</button></section><button>Outside child</button><div id="open"></div><div id="closed"></div><script>
      for (const mode of ['open', 'closed']) document.getElementById(mode).attachShadow({mode}).innerHTML = '<button>Shadow ' + mode + '</button>';
    </script>`;
    server = await startFixtureServer({
      "/": () => {
        const url = new URL("/child", server.url);
        url.hostname = "child.test";
        return `<button>Outside parent</button><section class="card"><button>A</button></section><section class="card"><button onclick="this.dataset.clicked='yes'">B</button><button>C</button></section><iframe id="checkout" src="${url}"></iframe><iframe id="nested" src="/nested"></iframe>`;
      },
      "/child": child,
      "/nested": '<iframe src="/child"></iframe>',
    });
    stagehand = await createStagehand({
      browser: {
        args: [
          "--host-resolver-rules=MAP child.test 127.0.0.1",
          "--site-per-process",
          "--no-proxy-server",
        ],
      },
      model: {
        generate: async (params: LLMGenerateParams): Promise<LLMGenerateResult> => {
          const text = params.messages
            .flatMap(({ content }) => (Array.isArray(content) ? content : [content]))
            .filter((content) => content.type === "text")
            .map((content) => content.text)
            .join("\n");
          const name =
            params.responseFormat?.type === "json_schema" ? params.responseFormat.name : "";
          modelCalls.push(name);
          if (name !== "Metadata") {
            expect(text).toContain("Save target");
            expect(text).not.toMatch(
              /Outside parent|Outside child|Excluded choice|Shadow open|Shadow closed/,
            );
          }
          const line = text
            .split("\n")
            .find((value) => value.includes("Save target") && /\[\d+-\d+\]/.test(value));
          const elementId = line?.match(/\[(\d+-\d+)\]/)?.[1];
          if (name === "Act" || name === "Observation") expect(elementId).toBeTruthy();
          const action = {
            elementId: elementId ?? "",
            description: "Save target",
            method: "click",
            arguments: [],
          };
          return {
            role: "assistant",
            content: { type: "text", text: "fixture response" },
            outputFormat: "json_schema",
            structuredContent:
              name === "Act"
                ? { action, twoStep: false }
                : name === "Observation"
                  ? { elements: [action] }
                  : name === "Extraction"
                    ? { label: "Save target" }
                    : { completed: true, progress: "Read label" },
          };
        },
      },
    });
    const page = await firstPage(stagehand);
    await page.goto(server.url, { waitUntil: "load" });
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await server?.close();
  });

  it("preserves positions & independent branches within elements", async () => {
    const page = await firstPage(stagehand);
    const cards = page.locator(".card");
    const buttons = cards.nth(1).locator("button");
    expect(await cards.count()).toBe(2);
    expect(await buttons.count()).toBe(2);
    expect(await buttons.nth(1).first().textContent()).toBe("C");
    expect(await buttons.first().nth(1).count()).toBe(0);
    expect(await cards.first().locator("button").textContent()).toBe("A");
    await buttons.first().click({ timeout: 5000 });
    expect(
      await page.evaluate(() =>
        document.querySelectorAll(".card button")[1]?.getAttribute("data-clicked"),
      ),
    ).toBe("yes");
  });

  it("enters nested & cross-origin frames, preserves explicit hops & searches both shadow modes", async () => {
    const page = await firstPage(stagehand);
    expect(await page.locator("button").count()).toBe(4);
    expect(
      await page.locator("#checkout").locator("#scope").locator("xpath=.//button").count(),
    ).toBe(2);
    expect(
      await page.locator("#checkout >> #scope").locator("text=Save target").textContent(),
    ).toBe("Save target");
    expect(await page.locator("body").locator("#nested >> iframe >> #save").textContent()).toBe(
      "Save target",
    );
    expect(await page.locator("#nested").locator("iframe").locator("#save").count()).toBe(1);
    const shadows = page.locator("#checkout").locator("#open, #closed").locator("button");
    expect(await shadows.count()).toBe(2);
    expect(await shadows.first().textContent()).toBe("Shadow open");
    expect(await shadows.nth(1).textContent()).toBe("Shadow closed");
    const screenshot = await page.screenshot({
      mask: [shadows, page.locator(".card").locator("button")],
    });
    expect(screenshot.length).toBeGreaterThan(0);
  });

  it("uses chained scopes & exclusions in act, observe & extract", async () => {
    const page = await firstPage(stagehand);
    const scope = page.locator("#checkout").locator("#scope");
    const options = {
      page,
      locator: scope,
      ignoreLocators: [scope.locator(".omit")],
      timeout: 15000,
    };
    expect((await stagehand.observe("Find the button", options)).data).toHaveLength(1);
    expect(
      (await stagehand.extract("Read the button label", z.object({ label: z.string() }), options))
        .data,
    ).toEqual({ label: "Save target" });
    expect((await stagehand.act("Click the button", options)).data.success).toBe(true);
    expect(await scope.locator("button[data-clicked=yes]").count()).toBe(1);
    expect(modelCalls).toEqual(expect.arrayContaining(["Observation", "Extraction", "Act"]));
  });
});
