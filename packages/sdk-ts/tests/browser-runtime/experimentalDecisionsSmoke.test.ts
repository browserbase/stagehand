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
          const plan = JSON.parse(criteria[id]);
          return plan.method === method && state.instruction.includes(plan.target.name);
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

  const ownerMarkup = '<div class="control"><span>Resize canvas</span></div>';
  const bindOwner = `
    const owner = document.querySelector(".control");
    const makeListener = value => event => document.body.dataset.action = value + "/" + event.isTrusted;
    const listener = makeListener("resize");
    owner.addEventListener("click", listener);
  `;
  function customControl(markup = ownerMarkup, script = bindOwner) {
    const html = `<style>
      .control { cursor: pointer; padding: 4px; display: inline-block }
      .control span { pointer-events: none }
      .cover { position: fixed; inset: 0 }
    </style>${markup}<script>
      document.addEventListener("click", () => document.body.dataset.clicked = "yes", true);
      ${script}
    </script>`;
    return "data:text/html;charset=utf-8," + encodeURIComponent(html);
  }

  it.each([ownerMarkup, "<button>Undo</button>" + ownerMarkup])(
    "clicks the registered owner of a transparent caption in %s",
    async (markup) => {
      const [page] = await browser.context.pages();
      await page.goto(customControl(markup));
      const result = await stagehand.experimentalDecisions.act("Click Resize canvas", {
        page,
        cache: false,
      });
      expect(result.data.success).toBe(true);
      expect(await page.evaluate(() => document.body.dataset.action)).toBe("resize/true");
      expect(generate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["only a delegated listener", ownerMarkup, 'document.body.addEventListener("click", () => {})'],
    [
      "a listener on a more distant ancestor",
      '<div class="outer">' + ownerMarkup + "</div>",
      'document.querySelector(".outer").addEventListener("click", () => {})',
    ],
    ["a covered caption", ownerMarkup + '<div class="cover"></div>', bindOwner],
    ["a disabled owner", '<div aria-disabled="true">' + ownerMarkup + "</div>", bindOwner],
    [
      "competing owners",
      ownerMarkup.repeat(2),
      'document.querySelectorAll(".control").forEach(el => el.addEventListener("click", () => {}))',
    ],
  ])("abstains with %s", async (_label, markup, script) => {
    const [page] = await browser.context.pages();
    await page.goto(customControl(markup, script));
    const result = await stagehand.experimentalDecisions.act("Click Resize canvas", {
      page,
      cache: false,
    });
    expect(result.data.success).toBe(false);
    expect(await worker("globalThis.__decisionRequested")).toBe(false);
    expect(await page.evaluate(() => !!document.body.dataset.clicked)).toBe(false);
    expect(generate).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "Click the first Resize canvas",
      '<div style="cursor:pointer">Resize canvas</div>' + ownerMarkup,
    ],
    ["Click Resize canvas", '<div style="cursor:pointer">Resize canvas</div>' + ownerMarkup],
    [
      "Click Resize canvas",
      ownerMarkup.replace('class="control"', 'class="control" aria-label="Delete canvas"'),
    ],
    [
      "Click Resize canvas",
      '<iframe srcdoc="<button>Resize canvas</button>"></iframe>' + ownerMarkup,
    ],
    ["Click Resize canvas, except in the Personal account", ownerMarkup],
    ['Open the "Resize canvas" dropdown', ownerMarkup],
    ['Click the "Resize canvas" button', ownerMarkup],
    ["Press Resize canvas", ownerMarkup],
  ])(
    "declines recovery for an unsupported or competing target in %s",
    async (instruction, markup) => {
      const [page] = await browser.context.pages();
      await page.goto(customControl(markup));
      const result = await stagehand.experimentalDecisions.act(instruction, { page, cache: false });
      expect(result.data.success).toBe(false);
      expect(await page.evaluate(() => !!document.body.dataset.clicked)).toBe(false);
      expect(generate).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["stays closed", "", false],
    ["opens after the click", "setTimeout(() => { menu.hidden = false }, 100)", true],
    [
      "is replaced by an open copy",
      "const copy = menu.cloneNode(true); copy.hidden = false; menu.replaceWith(copy)",
      false,
    ],
  ] as const)("checks the same requested menu when it %s", async (_label, change, opens) => {
    const [page] = await browser.context.pages();
    const markup =
      '<div class="control"><span>Resize canvas</span><div role="menu" hidden><div role="menuitem">Fit</div></div></div>';
    const script = `const menu = document.querySelector("[role=menu]");
      document.querySelector(".control").addEventListener("click", e => {
        document.body.dataset.count = String(Number(document.body.dataset.count || 0) + Number(e.isTrusted));
        ${change}
      });`;
    await page.goto(customControl(markup, script));
    const result = await stagehand.experimentalDecisions.act('Open the "Resize canvas" menu', {
      page,
      cache: false,
    });
    expect(result.data.success).toBe(opens);
    expect(result.data.actions).toHaveLength(1);
    expect(await page.evaluate(() => document.body.dataset.count)).toBe("1");
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(["rebound listener", "replacement owner", "additional owner"] as const)(
    "stops before dispatch when selection encounters a changed target (%s)",
    async (change) => {
      const [page] = await browser.context.pages();
      await page.goto(customControl());
      await worker("globalThis.__holdDecision = true");
      const pending = stagehand.experimentalDecisions.act("Click Resize canvas", {
        page,
        cache: false,
        timeout: 10_000,
      });
      try {
        await expect.poll(() => worker("globalThis.__decisionRequested")).toBe(true);
        const mutate = {
          "rebound listener":
            'owner.removeEventListener("click", listener); owner.addEventListener("click", makeListener("remove"))',
          "replacement owner": "owner.replaceWith(owner.cloneNode(true))",
          "additional owner":
            'owner.after(owner.cloneNode(true)); owner.nextElementSibling.addEventListener("click", makeListener("remove"))',
        };
        await page.evaluate(mutate[change]);
      } finally {
        await worker("globalThis.__releaseDecision?.()");
      }
      const result = await pending;
      expect(result.data.success).toBe(false);
      expect(result.data.message).toContain("changed before dispatch");
      expect(await page.evaluate(() => !!document.body.dataset.clicked)).toBe(false);
      expect(generate).not.toHaveBeenCalled();
    },
  );

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
