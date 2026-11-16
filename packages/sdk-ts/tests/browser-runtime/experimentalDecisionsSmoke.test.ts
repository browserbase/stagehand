import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Stagehand, localBrowser, type StagehandBrowser } from "../../src/index.js";
import { CDPClient } from "../../src/cdpClient.js";
import { startFixtureServer, type FixtureServer } from "../integration/_support.js";

describe("experimental decisions in a real browser", () => {
  let browser: StagehandBrowser;
  let stagehand: Stagehand;
  let server: FixtureServer;
  const generate = vi.fn(async () => ({
    role: "assistant" as const,
    content: { type: "text" as const, text: "No matching action" },
    outputFormat: "json_schema" as const,
    structuredContent: { action: null, twoStep: false },
  }));

  async function worker(expression: string) {
    const transport = stagehand.rpcClient!.cdp;
    if (!(transport instanceof CDPClient)) throw new Error("Expected a local CDP client");
    const result = await transport.sendCommand<{
      result: { value?: unknown };
      exceptionDetails?: { text: string };
    }>(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      transport.sessionId,
    );
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  beforeAll(async () => {
    server = await startFixtureServer(`
      <label>Email <input id="email" /></label>
      <button id="submit" onclick="document.body.dataset.clicked='yes'">Submit</button>
    `);
    browser = await localBrowser.launch({ headless: true });
    stagehand = await Stagehand.create({
      browser,
      model: { generate },
      experimentalDecisions: { apiKey: "fixture", apiUrl: "https://decisions.invalid" },
      logging: { level: "off" },
    });
    // Stub only the provider boundary. Snapshots, evidence checks and input use the real runtime.
    await worker(`(() => {
      const original = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (url !== "https://decisions.invalid/v1/decisions") return original(url, init);
        globalThis.__decisionRequested = true;
        if (globalThis.__holdDecision) {
          await new Promise(resolve => { globalThis.__releaseDecision = resolve; });
        }
        const { questions, state } = JSON.parse(init.body);
        const criteria = questions.action.criteria;
        const method = state.instruction.includes("Fill") ? "fill" : "click";
        const choice = Object.keys(criteria).find(id => {
          if (id === "none_match") return false;
          return JSON.parse(criteria[id]).method === method;
        }) ?? "none_match";
        return Response.json({
          answers: { action: { type: "choice", choice, confidence: 0.99,
            probabilities: { [choice]: 0.99 } } },
          usage: { input_tokens: 10, output_tokens: 1 },
        });
      };
    })()`);
  }, 45_000);

  beforeEach(async () => {
    generate.mockClear();
    await worker("globalThis.__holdDecision = false; globalThis.__decisionRequested = false");
    const pages = await browser.context.pages();
    await pages[0].goto(server.url);
  });

  afterAll(async () => {
    try {
      await stagehand?.close();
    } finally {
      try {
        await browser?.close();
      } finally {
        await server?.close();
      }
    }
  });

  it("executes a selected click and reports decision usage without LLM fallback", async () => {
    const [page] = await browser.context.pages();
    const result = await stagehand.experimentalDecisions.act("Click Submit", { page });
    expect(result.data.success).toBe(true);
    expect(result.metadata.usage).toMatchObject({ inputTokens: 10, outputTokens: 1 });
    expect(await page.evaluate(() => document.body.dataset.clicked)).toBe("yes");
    expect(generate).not.toHaveBeenCalled();
  });

  it("fills a grounded value and verifies it through the real locator", async () => {
    const [page] = await browser.context.pages();
    const result = await stagehand.experimentalDecisions.act(
      'Fill Email with "person@example.com"',
      {
        page,
      },
    );
    expect(result.data.success).toBe(true);
    expect(await page.locator("#email").inputValue()).toBe("person@example.com");
    expect(generate).not.toHaveBeenCalled();
  });

  it("discovers controls without provider or LLM requests", async () => {
    const [page] = await browser.context.pages();
    const results = await stagehand.experimentalDecisions.observe(undefined, { page });
    expect(results.data).toHaveLength(2);
    expect(results.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "click" }),
        expect.objectContaining({ method: "fill" }),
      ]),
    );
    expect(await worker("globalThis.__decisionRequested")).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not click a replacement inserted while the decision is pending", async () => {
    const [page] = await browser.context.pages();
    await worker("globalThis.__holdDecision = true");
    const pending = stagehand.experimentalDecisions.act("Click Submit", { page, timeout: 10_000 });
    try {
      await expect.poll(() => worker("globalThis.__decisionRequested")).toBe(true);
      await page.evaluate(() => {
        const original = document.querySelector("#submit")!;
        original.replaceWith(original.cloneNode(true));
      });
    } finally {
      await worker("globalThis.__releaseDecision?.()");
    }
    const result = await pending;
    expect(result.data.success).toBe(false);
    expect(await page.evaluate(() => document.body.dataset.clicked === "yes")).toBe(false);
    expect(generate).toHaveBeenCalledOnce();
  });
});
