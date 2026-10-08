import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { createPlaywrightCompatRuntime } from "../src/facade/runtime.js";

// Local, static DOM fixtures only. No extension, remote site, credentials or model.
// Run separately with pnpm --filter @browserbasehq/stagehand-integrations test:browser.
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ?? "chrome" }),
    headless: true,
  });
});
afterAll(async () => {
  await browser?.close();
});

describe("facade DOM compatibility against native Playwright", () => {
  it("matches native labels, priority, whitespace and shadow roots", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
    <section id="booking"><select id="age" aria-label="Child 1 age">
      <option value="">Age needed</option><option value="8">8 years</option>
    </select></section>
    <input id="unnamed">
    <label for="native">Native label</label><input id="native">
    <label>Wrapped label <input id="wrapped"></label>
    <label for="multi">First label</label><label for="multi">Second label</label><input id="multi">
    <span id="ref-one">First reference</span><span id="ref-two">Second reference</span>
    <input id="refs" aria-labelledby="ref-one ref-two" aria-label="Overridden ARIA">
    <span id="blank"></span><input id="blank-ref" aria-labelledby="blank" aria-label="Ignored fallback">
    <label for="aria-first">Ignored native</label><input id="aria-first" aria-label="ARIA wins">
    <input id="broken-ref" aria-labelledby="missing-reference" aria-label="Fallback label">
    <input id="spaces" aria-label="  Child   2\n age  ">
    <input id="empty-aria" aria-label="  "><label for="empty-aria">Empty ARIA fallback</label>
    <label for="mixed">Clean<script>contamination</script><style>.ignored{}</style><span> label</span></label>
    <input id="mixed">
    <input id="regex" aria-label="Line\nBreak">
    <span id="shadow-ref">Wrong outer label</span><div id="shadow-host"></div>
  `);
      await page.locator("#shadow-host").evaluate((host) => {
        host.attachShadow({ mode: "open" }).innerHTML =
          '<span id="shadow-ref">Shadow label</span><input id="shadow-input" aria-labelledby="shadow-ref">' +
          '<input id="shadow-aria" aria-label="Shadow ARIA">';
      });
      const runtime = await createPlaywrightCompatRuntime({
        page,
        context: { pages: async () => [page], activePage: async () => page },
      } as unknown as Parameters<typeof createPlaywrightCompatRuntime>[0]);
      const facade = runtime.page as Pick<Page, "getByLabel" | "locator">;
      const cases: Array<{
        name: string;
        label: string | RegExp;
        exact?: boolean;
        scope?: string;
        expected: string[];
      }> = [
        {
          name: "Booking child age aria-label",
          expected: ["age"],
          label: "Child 1 age",
          exact: true,
        },
        {
          name: "scoped aria-label",
          expected: ["age"],
          label: "Child 1 age",
          exact: true,
          scope: "#booking",
        },
        { name: "case-insensitive substring", expected: ["age"], label: "CHILD 1" },
        { name: "exact case sensitivity", expected: [], label: "child 1 age", exact: true },
        { name: "native label", expected: ["native"], label: "Native label", exact: true },
        { name: "wrapped label", expected: ["wrapped"], label: "Wrapped label", exact: true },
        { name: "first associated label", expected: ["multi"], label: "First label", exact: true },
        {
          name: "second associated label",
          expected: ["multi"],
          label: "Second label",
          exact: true,
        },
        {
          name: "labels are not concatenated",
          expected: [],
          label: "First label Second label",
          exact: true,
        },
        { name: "first ARIA reference", expected: ["refs"], label: "First reference", exact: true },
        {
          name: "second ARIA reference",
          expected: ["refs"],
          label: "Second reference",
          exact: true,
        },
        {
          name: "ARIA references are not concatenated",
          expected: [],
          label: "First reference Second reference",
          exact: true,
        },
        { name: "labelledby takes priority", expected: [], label: "Overridden ARIA", exact: true },
        {
          name: "empty referenced label takes priority",
          expected: [],
          label: "Ignored fallback",
          exact: true,
        },
        {
          name: "ARIA takes priority over native label",
          expected: [],
          label: "Ignored native",
          exact: true,
        },
        { name: "ARIA priority match", expected: ["aria-first"], label: "ARIA wins", exact: true },
        {
          name: "broken labelledby falls back",
          expected: ["broken-ref"],
          label: "Fallback label",
          exact: true,
        },
        {
          name: "normalized string whitespace",
          expected: ["spaces"],
          label: "Child 2 age",
          exact: true,
        },
        {
          name: "empty ARIA falls back",
          expected: ["empty-aria"],
          label: "Empty ARIA fallback",
          exact: true,
        },
        {
          name: "label text excludes script/style",
          expected: ["mixed"],
          label: "Clean label",
          exact: true,
        },
        { name: "regular expression", expected: ["age"], label: /^child 1 age$/i },
        { name: "regex keeps original whitespace", expected: ["regex"], label: /^Line\nBreak$/ },
        {
          name: "empty query excludes unlabeled elements",
          expected: ["blank-ref"],
          label: "",
          exact: true,
        },
        {
          name: "shadow-root reference",
          expected: ["shadow-input"],
          label: "Shadow label",
          exact: true,
        },
        { name: "shadow-root ARIA", expected: ["shadow-aria"], label: "Shadow ARIA", exact: true },
        {
          name: "reference cannot cross shadow boundary",
          expected: [],
          label: "Wrong outer label",
          exact: true,
        },
      ];
      const results = [];
      for (const test of cases) {
        const nativeScope = test.scope ? page.locator(test.scope) : page;
        const facadeScope = test.scope ? facade.locator(test.scope) : facade;
        const options = { exact: test.exact };
        const native = await nativeScope
          .getByLabel(test.label, options)
          .evaluateAll((els) => els.map((el) => el.id));
        const actual = await facadeScope
          .getByLabel(test.label, options)
          .evaluateAll((els) => els.map((el) => el.id));
        results.push({
          name: test.name,
          native,
          actual,
          expected: test.expected,
          pass:
            JSON.stringify(native) === JSON.stringify(actual) &&
            JSON.stringify(actual) === JSON.stringify(test.expected),
        });
      }
      assert.ok(
        results.every((r) => r.pass),
        `Facade label mismatch: ${JSON.stringify(results.filter((result) => !result.pass))}`,
      );
      await facade.getByLabel("Child 1 age", { exact: true }).selectOption("8");
      assert.equal(await page.locator("#age").inputValue(), "8");
    } finally {
      await page.close();
    }
  });
  it("resolves nested role filters before applying hasNot or invoking callbacks", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`
        <section id="pay"><div><button><img alt="Pay now"></button></div></section>
        <section id="cancel"><div><button><img alt="Cancel order"></button></div></section>
      `);
      // This snapshot is the browser-computed name that the DOM approximation
      // misses for image-only buttons. Native Playwright independently checks it.
      const rawPage = {
        url: () => page.url(),
        evaluate: page.evaluate.bind(page),
        snapshot: async () => ({
          formattedTree: "[1] button: Pay now\n[2] button: Cancel order",
          xpathMap: {
            "1": "/html/body/section[1]/div/button",
            "2": "/html/body/section[2]/div/button",
          },
        }),
      };
      const runtime = await createPlaywrightCompatRuntime({
        page: rawPage,
        context: { pages: async () => [rawPage] },
      } as unknown as Parameters<typeof createPlaywrightCompatRuntime>[0]);
      const facade = runtime.page as Page;
      for (const scope of [page, facade]) {
        const pay = scope.getByRole("button", { name: "Pay now", exact: true });
        assert.deepEqual(
          await scope
            .locator("section")
            .filter({ has: pay })
            .evaluateAll((els) => els.map((el) => el.id)),
          ["pay"],
        );
        assert.deepEqual(
          await scope
            .locator("section")
            .filter({ hasNot: pay })
            .evaluateAll((els) => els.map((el) => el.id)),
          ["cancel"],
        );
        assert.deepEqual(
          await scope
            .locator("section")
            .filter({
              has: scope.locator("div").filter({ has: pay }),
            })
            .evaluateAll((els) => els.map((el) => el.id)),
          ["pay"],
        );
        assert.deepEqual(
          await scope
            .locator("section")
            .filter({
              hasNot: scope.getByRole("button", { name: "Missing", exact: true }),
            })
            .evaluateAll((els) => els.map((el) => el.id)),
          ["pay", "cancel"],
        );
      }
      await facade
        .locator("section")
        .filter({
          hasNot: facade.getByRole("button", {
            name: "Pay now",
            exact: true,
          }),
        })
        .evaluate((el) => el.setAttribute("data-mutated", "yes"));
      assert.deepEqual(
        await page.locator("[data-mutated]").evaluateAll((els) => els.map((el) => el.id)),
        ["cancel"],
      );
    } finally {
      await page.close();
    }
  });
  it.each(["open", "closed"] as const)(
    "keeps scoped role matches inside nested %s shadow roots",
    async (mode) => {
      const page = await browser.newPage();
      const cdp = await page.context().newCDPSession(page);
      const { evaluateWithShadowRoots } = await import(
        new URL("../../../extension/understudy/shadowRootEvaluation.ts", import.meta.url).href
      );
      try {
        await page.setContent(
          '<section id="inside"><div id="host"></div></section><section id="outside"><button>Other</button></section>',
        );
        await page.evaluate((mode) => {
          (window as unknown as { pageOwnedValue: number }).pageOwnedValue = 42;
          const outer = document.querySelector("#host")!.attachShadow({ mode });
          outer.innerHTML = '<div id="nested"></div>';
          const inner = outer.querySelector("#nested")!.attachShadow({ mode });
          inner.innerHTML =
            '<button id="pay"><img alt="Pay now"></button><input aria-label="Amount" value="10">';
        }, mode);
        const rawPage = {
          pageId: "fixture",
          url: () => page.url(),
          evaluate: page.evaluate.bind(page),
          snapshot: async () => ({
            formattedTree: "[1] button: Pay now",
            xpathMap: { "1": "/html/body/section[1]/div[1]//div[1]//button[1]" },
          }),
        };
        const runtime = await createPlaywrightCompatRuntime({
          page: rawPage,
          context: { pages: async () => [rawPage] },
          evaluateWithShadowRoots: (_pageId: string, source: string) =>
            evaluateWithShadowRoots(cdp, (expression: string) => page.evaluate(expression), source),
        } as unknown as Parameters<typeof createPlaywrightCompatRuntime>[0]);
        const facade = runtime.page as Pick<Page, "locator" | "getByRole" | "getByLabel">;
        const pay = facade.getByRole("button", { name: "Pay now", exact: true });
        assert.equal(await pay.count(), 1);
        assert.equal(
          await facade.locator("#inside").getByRole("button", { name: "Pay now" }).count(),
          1,
        );
        assert.equal(
          await facade.locator("#outside").getByRole("button", { name: "Pay now" }).count(),
          0,
        );
        assert.deepEqual(
          await facade
            .locator("section")
            .filter({ has: pay })
            .evaluateAll((els) => els.map((el) => el.id)),
          ["inside"],
        );
        assert.deepEqual(
          await facade
            .locator("section")
            .filter({ hasNot: pay })
            .evaluateAll((els) => els.map((el) => el.id)),
          ["outside"],
        );
        assert.equal(await facade.getByLabel("Amount").inputValue(), "10");
        assert.equal(await facade.locator("#host").locator("#pay").count(), 1);
        assert.equal(
          await pay.evaluate((el) => {
            el.setAttribute("data-checked", "yes");
            return (window as unknown as { pageOwnedValue: number }).pageOwnedValue;
          }),
          42,
        );
        assert.equal(await facade.locator('[data-checked="yes"]').count(), 1);
        // Fresh roots after navigation must not reuse remote references.
        await page.goto("about:blank");
        assert.equal(await facade.locator("#pay").count(), 0);
      } finally {
        await cdp.detach();
        await page.close();
      }
    },
  );

  it("enforces strict reads, bounded waits and non-dispatched trial actions", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(
        '<input class="duplicate" value="one"><input class="duplicate" value="two">',
      );
      const runtime = await createPlaywrightCompatRuntime({
        page,
        context: { pages: async () => [page], activePage: async () => page },
      } as unknown as Parameters<typeof createPlaywrightCompatRuntime>[0]);
      const facade = runtime.page as Page;
      const results: Array<{ name: string; pass: boolean; detail?: string }> = [];
      const check = async (name: string, action: () => Promise<void>): Promise<void> => {
        try {
          await action();
          results.push({ name, pass: true });
        } catch (error) {
          results.push({ name, pass: false, detail: String(error) });
        }
      };
      // Strictness should be reported before a busy CI browser exhausts its command budget.
      const strictTimeout = 5000;
      const methods: Array<[string, (locator: Locator) => Promise<unknown>]> = [
        ["textContent", (locator) => locator.textContent({ timeout: strictTimeout })],
        ["innerText", (locator) => locator.innerText({ timeout: strictTimeout })],
        ["innerHTML", (locator) => locator.innerHTML({ timeout: strictTimeout })],
        ["inputValue", (locator) => locator.inputValue({ timeout: strictTimeout })],
        ["getAttribute", (locator) => locator.getAttribute("value", { timeout: strictTimeout })],
        ["isChecked", (locator) => locator.isChecked({ timeout: strictTimeout })],
        ["isDisabled", (locator) => locator.isDisabled({ timeout: strictTimeout })],
        ["isEnabled", (locator) => locator.isEnabled({ timeout: strictTimeout })],
        ["isVisible", (locator) => locator.isVisible()],
        ["boundingBox", (locator) => locator.boundingBox({ timeout: strictTimeout })],
        ["focus", (locator) => locator.focus({ timeout: strictTimeout })],
        ["evaluate", (locator) => locator.evaluate((el) => el.setAttribute("data-mutated", "yes"))],
        [
          "evaluateHandle",
          (locator) => locator.evaluateHandle((el) => el.setAttribute("data-mutated", "yes")),
        ],
      ];
      for (const [name, run] of methods) {
        await check(`strict ${name}`, async () => {
          await assert.rejects(run(page.locator(".duplicate")), /strict mode violation/);
          await assert.rejects(run(facade.locator(".duplicate")), /strict mode violation/);
        });
      }
      await check("ambiguous callbacks never execute", async () => {
        assert.equal(await page.locator("[data-mutated]").count(), 0);
      });
      for (const [name, scope] of [
        ["native", page],
        ["facade", facade],
      ] as const) {
        await check(`${name} waits for delayed element`, async () => {
          const id = `delayed-${name}`;
          await page.evaluate((id) => {
            setTimeout(() => {
              const el = document.createElement("input");
              el.id = id;
              el.value = "arrived";
              document.body.append(el);
            }, 120);
          }, id);
          assert.equal(await scope.locator(`#${id}`).inputValue({ timeout: 1000 }), "arrived");
        });
        await check(`${name} honors explicit timeout`, async () => {
          const start = Date.now();
          await assert.rejects(
            scope.locator("#missing").textContent({ timeout: 150 }),
            /timed out|Timeout/,
          );
          assert.ok(Date.now() - start >= 100 && Date.now() - start < 1500);
        });
        await check(`${name} timeout zero waits`, async () => {
          const id = `unlimited-${name}`;
          await page.evaluate((id) => {
            setTimeout(() => {
              const el = document.createElement("div");
              el.id = id;
              el.textContent = "arrived";
              document.body.append(el);
            }, 120);
          }, id);
          assert.equal(await scope.locator(`#${id}`).textContent({ timeout: 0 }), "arrived");
        });
      }
      await check("collection reads and visibility stay immediate", async () => {
        assert.deepEqual(await facade.locator(".duplicate").allTextContents(), ["", ""]);
        assert.equal(await facade.locator("#missing").count(), 0);
        assert.equal(await facade.locator("#missing").isVisible(), false);
      });
      await check("nth disambiguates reads", async () => {
        assert.equal(await facade.locator(".duplicate").nth(1).inputValue(), "two");
      });
      await check("unsupported trial never clicks, including force", async () => {
        await page.evaluate(() => {
          document.body.insertAdjacentHTML(
            "beforeend",
            '<button id="trial" onclick="this.dataset.clicked = \'yes\'">Submit</button>',
          );
        });
        for (const force of [false, true]) {
          await assert.rejects(
            facade.locator("#trial").click({ trial: true, force }),
            /trial clicks are not supported/,
          );
        }
        assert.equal(await page.locator("#trial").getAttribute("data-clicked"), null);
      });
      assert.ok(
        results.every((result) => result.pass),
        `Facade locator mismatch: ${JSON.stringify(results.filter((result) => !result.pass))}`,
      );
    } finally {
      await page.close();
    }
  });
});
