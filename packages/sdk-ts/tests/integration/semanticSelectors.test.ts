import { chromium, type Browser, type Locator, type Page } from "playwright-semantic-oracle";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  encodeLocatorQuery,
  type QueryStep,
  type TextPattern,
} from "@browserbasehq/stagehand-protocol/locator-query";
import type { Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

const fixture = `<!doctype html><html><head>
  <style>.pseudo::before { content: 'Publish '; } .pseudo::after { content: attr(data-suffix); }</style>
  <title>Title-only needle</title>
</head><body>
  <button id="save">Save <span id="draft">Draft</span></button>
  <button id="publish" aria-label="Publish report">Visible ignored</button>
  <button id="described" aria-describedby="description">Help</button>
  <span id="description" hidden>More\n  details</span>
  <button id="aria-description" aria-description="More details">Help</button>
  <button id="labelled" aria-labelledby="label-first label-second">Fallback</button>
  <span id="label-first" hidden>Publish</span><span id="label-second">report</span>
  <button id="pseudo" class="pseudo" data-suffix=" report"></button>
  <button id="fallback-role" role="unknown button">Fallback role</button>
  <button id="presentation" role="presentation">Focusable presentation</button>
  <a id="link" href="#">Details</a><a id="not-link">Details</a>
  <input id="input-button" type="button" value="Run job" />
  <input id="input-submit" type="submit" value="Run job" />
  <input id="input-reset" type="reset" value="Reset job" />
  <label for="subscribe">Subscribe</label><input id="subscribe" type="checkbox" checked />
  <input id="unchecked" type="checkbox" aria-label="Native off" />
  <input id="mixed" type="checkbox" aria-label="Native mixed" />
  <div id="aria-mixed" role="checkbox" aria-checked="mixed">ARIA mixed</div>
  <div id="aria-checked" role="checkbox" aria-checked="true">ARIA on</div>
  <div id="aria-unchecked" role="checkbox" aria-checked="false">ARIA off</div>
  <button id="pressed" aria-pressed="true">Toggle</button>
  <button id="mixed-pressed" aria-pressed="mixed">Toggle</button>
  <button id="not-pressed" aria-pressed="false">Toggle</button>
  <button id="expanded" aria-expanded="true">Expand</button>
  <button id="collapsed" aria-expanded="false">Expand</button>
  <select id="select"><option id="selected" selected>One</option><option id="unselected">Two</option></select>
  <h2 id="heading">Release notes</h2><div id="aria-heading" role="heading" aria-level="3">Release notes</div>
  <fieldset disabled>
    <legend><button id="legend-enabled">Legend action</button></legend>
    <button id="fieldset-disabled">Disabled action</button>
  </fieldset>
  <div aria-disabled="true"><button id="inherited-disabled">Disabled action</button>
    <div aria-disabled="false"><button id="overridden-disabled">Enabled action</button></div>
  </div>
  <button id="hidden-button" hidden>Hidden action</button>
  <div aria-hidden="true"><button id="aria-hidden-button">Hidden action</button></div>
  <button id="visibility-hidden" style="visibility:hidden">Hidden action</button>
  <div id="contents-button" role="button" style="display:contents"><span id="contents-text">Contents action</span></div>
  <header id="banner">Top header</header><article><header id="nested-header">Nested header</header></article>
  <section id="unnamed-section">Unnamed section</section><section id="named-section" aria-label="Named region">Named section</section>
  <svg id="svg" xmlns="http://www.w3.org/2000/svg"><title>Chart name</title></svg>
  <div id="outer"><p id="normalized">  Hello\n\t <span id="world">world</span>\u00a0!\u200b\u00ad  </p></div>
  <div id="raw-regex">Alpha\nBeta</div>
  <span id="hidden-text" hidden>Hidden text needle</span>
  <p id="case-upper">Case Match</p><p id="case-lower">case match</p>
  <div id="regex-first">Global match</div><div id="regex-second">Global match</div>
  <div id="escaped">Quotes " ' \\ and &gt;&gt; [brackets] / slash</div>
  <div id="empty"></div>
  <div id="cards"><section id="card-one"><h3 id="one-heading">One</h3><button id="one-button">Add</button></section>
    <section id="card-two"><h3 id="two-heading">Two</h3><button id="two-button">Add</button></section></div>
  <div id="legacy-light" class="legacy-scope"><button id="legacy-light-button">Legacy light</button></div>
  <div id="open-host"></div><div id="second-open-host"></div><div id="closed-host"></div>
  <script>
    document.getElementById('mixed').indeterminate = true;
    document.getElementById('open-host').attachShadow({ mode: 'open' }).innerHTML =
      '<button id="shadow-button" aria-label="Shadow save">Shadow text</button><div id="nested-host"></div><div id="legacy-open" class="legacy-scope"><button id="legacy-open-button">Legacy open</button></div>';
    document.getElementById('open-host').shadowRoot.getElementById('nested-host').attachShadow({ mode: 'open' }).innerHTML =
      '<button id="nested-shadow-button">Nested shadow text</button><div id="legacy-nested" class="legacy-scope"><button id="legacy-nested-button">Legacy nested</button></div>';
    document.getElementById('second-open-host').attachShadow({ mode: 'open' }).innerHTML =
      '<div id="legacy-second" class="legacy-scope"><button id="legacy-second-button">Legacy second</button></div>';
    document.getElementById('closed-host').attachShadow({ mode: 'closed' }).innerHTML =
      '<button id="closed-shadow-button">Closed shadow text</button><div id="legacy-closed" class="legacy-scope"><button id="legacy-closed-button">Legacy closed</button></div>';
    document.querySelectorAll('*').forEach((element, index) => { if (!element.id) element.id = 'fixture-' + index; });
  </script>
</body></html>`;

const cases: Array<{ name: string; steps: QueryStep[] }> = [
  {
    name: "accessible descriptions normalize text and hidden references",
    steps: [
      { kind: "role", role: "button", options: { name: "Help", description: "more DETAILS" } },
    ],
  },
  {
    name: "exact accessible descriptions",
    steps: [
      { kind: "role", role: "button", options: { description: "More details", exact: true } },
    ],
  },
  {
    name: "case-sensitive description regex",
    steps: [{ kind: "role", role: "button", options: { description: { source: "More" } } }],
  },
  {
    name: "case-sensitive description regex rejects wrong case",
    steps: [{ kind: "role", role: "button", options: { description: { source: "MORE" } } }],
  },
  {
    name: "case-insensitive description regex",
    steps: [
      { kind: "role", role: "button", options: { description: { source: "more", flags: "i" } } },
    ],
  },
  {
    name: "native and explicit roles, including presentational conflicts",
    steps: [{ kind: "role", role: "button" }],
  },
  { name: "link role requires href", steps: [{ kind: "role", role: "link" }] },
  {
    name: "accessible names from labels, hidden references and pseudo-content",
    steps: [{ kind: "role", role: "button", options: { name: "publish REPORT" } }],
  },
  {
    name: "exact accessible names are case-sensitive",
    steps: [{ kind: "role", role: "button", options: { name: "Publish report", exact: true } }],
  },
  {
    name: "accessible-name regex",
    steps: [
      {
        kind: "role",
        role: "button",
        options: { name: { source: "^publish report$", flags: "i" } },
      },
    ],
  },
  {
    name: "case-sensitive role regex preserves subject case",
    steps: [{ kind: "role", role: "button", options: { name: { source: "Save" } } }],
  },
  {
    name: "case-sensitive uppercase role regex does not match mixed case",
    steps: [{ kind: "role", role: "button", options: { name: { source: "SAVE" } } }],
  },
  {
    name: "case-insensitive role regex follows its flags",
    steps: [{ kind: "role", role: "button", options: { name: { source: "save", flags: "i" } } }],
  },
  {
    name: "native labels",
    steps: [{ kind: "role", role: "checkbox", options: { name: "Subscribe" } }],
  },
  {
    name: "checked state",
    steps: [{ kind: "role", role: "checkbox", options: { checked: true } }],
  },
  {
    name: "unchecked excludes indeterminate and mixed states",
    steps: [{ kind: "role", role: "checkbox", options: { checked: false } }],
  },
  { name: "pressed state", steps: [{ kind: "role", role: "button", options: { pressed: true } }] },
  {
    name: "not-pressed excludes mixed state",
    steps: [{ kind: "role", role: "button", options: { pressed: false } }],
  },
  {
    name: "expanded state",
    steps: [{ kind: "role", role: "button", options: { expanded: false } }],
  },
  {
    name: "selected options",
    steps: [{ kind: "role", role: "option", options: { selected: true } }],
  },
  {
    name: "implicit heading level",
    steps: [{ kind: "role", role: "heading", options: { level: 2 } }],
  },
  {
    name: "explicit heading level",
    steps: [{ kind: "role", role: "heading", options: { level: 3 } }],
  },
  {
    name: "inherited disabled and first-legend exception",
    steps: [{ kind: "role", role: "button", options: { disabled: true } }],
  },
  {
    name: "disabled overrides",
    steps: [{ kind: "role", role: "button", options: { disabled: false } }],
  },
  {
    name: "hidden role matches are excluded by default",
    steps: [{ kind: "role", role: "button", options: { name: "Hidden action" } }],
  },
  {
    name: "hidden role matches can be included",
    steps: [
      { kind: "role", role: "button", options: { name: "Hidden action", includeHidden: true } },
    ],
  },
  {
    name: "display contents visibility",
    steps: [{ kind: "role", role: "button", options: { name: "Contents action" } }],
  },
  { name: "nested landmarks", steps: [{ kind: "role", role: "banner" }] },
  { name: "regions need an accessible name", steps: [{ kind: "role", role: "region" }] },
  {
    name: "SVG accessible name",
    steps: [{ kind: "role", role: "img", options: { name: "Chart name" } }],
  },
  { name: "normalized text across child nodes", steps: [{ kind: "text", text: "hello world !" }] },
  {
    name: "normalized exact text",
    steps: [{ kind: "text", text: " Hello  world ! ", exact: true }],
  },
  { name: "smallest matching text element", steps: [{ kind: "text", text: "world" }] },
  { name: "case-insensitive substring text", steps: [{ kind: "text", text: "case match" }] },
  { name: "case-sensitive exact text", steps: [{ kind: "text", text: "Case Match", exact: true }] },
  {
    name: "regex sees raw text before whitespace normalization",
    steps: [{ kind: "text", text: { source: "^Alpha\\nBeta$" } }],
  },
  {
    name: "global regex resets between elements",
    steps: [{ kind: "text", text: { source: "Global match", flags: "g" } }],
  },
  {
    name: "text matching includes hidden text",
    steps: [{ kind: "text", text: "Hidden text needle" }],
  },
  { name: "head text is excluded", steps: [{ kind: "text", text: "Title-only needle" }] },
  { name: "button and submit input values", steps: [{ kind: "text", text: "Run job" }] },
  { name: "reset input values", steps: [{ kind: "text", text: "Reset job" }] },
  {
    name: "selector syntax is literal text",
    steps: [{ kind: "text", text: `Quotes " ' \\ and >> [brackets] / slash`, exact: true }],
  },
  { name: "open shadow roots only", steps: [{ kind: "text", text: "shadow text" }] },
  {
    name: "shadow accessible names",
    steps: [{ kind: "role", role: "button", options: { name: "Shadow save" } }],
  },
  {
    name: "role scopes exclude the scope itself",
    steps: [
      { kind: "selector", selector: "#save" },
      { kind: "role", role: "button" },
    ],
  },
  {
    name: "text scopes include the scope itself",
    steps: [
      { kind: "selector", selector: "#save" },
      { kind: "text", text: "Save Draft", exact: true },
    ],
  },
  {
    name: "nth preserves its place in the chain",
    steps: [
      { kind: "selector", selector: "#cards section" },
      { kind: "nth", index: 1 },
      { kind: "role", role: "button" },
    ],
  },
  {
    name: "relative XPath inside a semantic scope",
    steps: [
      { kind: "selector", selector: "#cards" },
      { kind: "role", role: "button" },
      { kind: "selector", selector: "xpath=.." },
    ],
  },
];

describe("semantic selectors match Playwright 1.64.1", () => {
  let stagehand: Stagehand;
  let page: Awaited<ReturnType<typeof firstPage>>;
  let browser: Browser;
  let oracle: Page;
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startFixtureServer({
      "/": fixture,
      "/child": '<button aria-label="Frame publish">Child action</button>',
    });
    stagehand = await createStagehand();
    page = await firstPage(stagehand);
    await page.goto(server.url);
    const cdpUrl = stagehand.rpcClient?.browserWebSocketDebuggerUrl;
    if (!cdpUrl) throw new Error("Stagehand did not expose its browser CDP URL");
    browser = await chromium.connectOverCDP(cdpUrl);
    const url = await page.url();
    const target = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url() === url);
    if (!target) throw new Error("Playwright could not find the Stagehand fixture page");
    oracle = target;
  });

  beforeEach(async () => {
    await oracle.setContent(fixture);
  });

  afterAll(async () => {
    try {
      await browser?.close();
    } finally {
      await Promise.all([closeStagehand(stagehand), server?.close()]);
    }
  });

  async function assertParity(steps: QueryStep[]) {
    const expected = await oracleLocator(oracle, steps).evaluateAll((elements) =>
      elements.map((element) => element.id),
    );
    expect(await page.locator(encodeLocatorQuery(steps)).count()).toBe(expected.length);
    // The SDK intentionally has no generic element handle. A scoped self-axis proves
    // element identity and order through the same locator pipeline used by actions.
    for (const [index, id] of expected.entries()) {
      expect(id).not.toBe("");
      expect(
        await page
          .locator(
            encodeLocatorQuery([
              ...steps,
              { kind: "nth", index },
              { kind: "selector", selector: `xpath=self::*[@id='${id}']` },
            ]),
          )
          .count(),
      ).toBe(1);
    }
  }

  it.each(cases)("$name", async ({ steps }) => {
    await assertParity(steps);
  });

  it("exposes native regex name, description, and text matching through SDK builders", async () => {
    const options = { name: /^Help$/, description: /^more details$/i, exact: true };
    expect(await page.getByRole("button", options).count()).toBe(
      await oracle.getByRole("button", options).count(),
    );
    expect(await page.getByRole("button", options).count()).toBe(2);
    expect(await page.getByText(/Alpha\nBeta/, { exact: true }).textContent()).toBe("Alpha\nBeta");
    expect(await page.getByText(/nested shadow text/i).count()).toBe(1);
  });

  it("preserves nth scope while composing public role, text, and CSS/XPath builders", async () => {
    const card = page.locator("#cards > section").nth(1);
    expect(await card.getByText("Two", { exact: true }).count()).toBe(1);
    expect(await card.getByText("One", { exact: true }).count()).toBe(0);
    expect(
      await card
        .getByRole("button", { name: "Add" })
        .locator("xpath=self::*[@id='two-button']")
        .count(),
    ).toBe(1);
    expect(
      await page
        .getByRole("button", { name: /^Save Draft$/ })
        .locator("span")
        .getByText("Draft", { exact: true })
        .count(),
    ).toBe(1);
    expect(
      await page
        .locator("#cards")
        .getByRole("heading", { level: 3 })
        .nth(1)
        .getByText("Two")
        .count(),
    ).toBe(1);
  });

  it("performs an existing click action through a scoped public role builder", async () => {
    await oracle.setContent(`
      <button id="outside" aria-description="Publishes the current draft">Publish draft</button>
      <section role="dialog" aria-label="Publish editor">
        <button id="inside" aria-description="Publishes the current draft">Publish draft</button>
      </section>
    `);
    await oracle.evaluate(() => {
      for (const button of document.querySelectorAll("button")) {
        button.onclick = () => {
          document.body.dataset.clicked = button.id;
        };
      }
    });
    await page
      .getByRole("dialog", { name: "Publish editor", exact: true })
      .getByRole("button", { name: /^Publish draft$/, description: /current draft$/ })
      .click({ timeout: 5_000 });
    expect(await oracle.evaluate(() => document.body.dataset.clicked)).toBe("inside");
  });

  it("resolves a late semantic index without changing its match order", async () => {
    await oracle.setContent(
      Array.from({ length: 300 }, (_, index) => `<button>Button ${index}</button>`).join(""),
    );
    const buttons = page.locator(encodeLocatorQuery([{ kind: "role", role: "button" }]));
    expect(await buttons.nth(299).textContent()).toBe("Button 299");
    await expect(buttons.nth(300).textContent()).rejects.toThrow("Could not find an element");
  });

  it("does not retain accessible-name or text caches across queries", async () => {
    const steps: QueryStep[] = [
      { kind: "role", role: "button", options: { name: "Publish report", exact: true } },
    ];
    await assertParity(steps);
    await oracle
      .locator("#publish")
      .evaluate((element) => element.setAttribute("aria-label", "Renamed action"));
    await assertParity(steps);
    await assertParity([{ kind: "role", role: "button", options: { name: "Renamed action" } }]);
    await oracle.locator("#case-upper").evaluate((element) => {
      element.textContent = "Changed text";
    });
    await assertParity([{ kind: "text", text: "Changed text" }]);
  });

  it("rejects state filters that are incompatible with the requested role", async () => {
    const steps: QueryStep[] = [{ kind: "role", role: "link", options: { checked: true } }];
    await expect(oracleLocator(oracle, steps).count()).rejects.toThrow(
      '"checked" attribute is only supported',
    );
    await expect(page.locator(encodeLocatorQuery(steps)).count()).rejects.toThrow(
      '"checked" attribute is only supported',
    );
  });

  it("waits for a late semantic match before invoking the existing click action", async () => {
    const selector = encodeLocatorQuery([
      { kind: "role", role: "button", options: { name: "Delayed publish", exact: true } },
    ]);
    await oracle.evaluate(() => {
      setTimeout(() => {
        const button = document.createElement("button");
        button.textContent = "Delayed publish";
        button.onclick = () => {
          document.body.dataset.published = "true";
        };
        document.body.append(button);
      }, 100);
    });
    expect(await page.waitForSelector(selector, { timeout: 5_000 })).toBe(true);
    await page.locator(selector).click({ timeout: 5_000 });
    expect(await oracle.evaluate(() => document.body.dataset.published)).toBe("true");
  });

  it.each([
    '<button style="display:none">Publish</button>',
    '<button style="visibility:hidden">Publish</button>',
    "<div>No matching button</div>",
  ])("resolves hidden for an initially unmatched role in %s", async (html) => {
    await oracle.setContent(html);
    const selector = encodeLocatorQuery([
      { kind: "role", role: "button", options: { name: "Publish", exact: true } },
    ]);

    expect(await page.waitForSelector(selector, { state: "hidden", timeout: 1_000 })).toBe(true);
    await expect(
      page.waitForSelector(selector, { state: "visible", timeout: 150 }),
    ).rejects.toThrow(/timeout|timed out/i);
  });

  it.each(["display", "visibility", "remove"])(
    "resolves a pending role hidden wait after %s changes",
    async (change) => {
      await oracle.setContent("<button>Publish</button>");
      const selector = encodeLocatorQuery([
        { kind: "role", role: "button", options: { name: "Publish", exact: true } },
      ]);
      await expect(
        page.waitForSelector(selector, { state: "hidden", timeout: 150 }),
      ).rejects.toThrow(/timeout|timed out/i);

      await oracle.evaluate((change) => {
        setTimeout(() => {
          const button = document.querySelector("button")!;
          if (change === "remove") button.remove();
          else if (change === "display") button.style.display = "none";
          else button.style.visibility = "hidden";
        }, 100);
      }, change);
      expect(await page.waitForSelector(selector, { state: "hidden", timeout: 5_000 })).toBe(true);
    },
  );

  it.each([".legacy-scope", "xpath=//div[@class='legacy-scope']"])(
    "preserves legacy root ordering and closed shadows for %s",
    async (selector) => {
      const count = await page.locator(selector).count();
      expect(count).toBe(5);
      for (let index = 0; index < count; index++) {
        const expected = await page.locator(selector).nth(index).textContent();
        const scoped = page.locator(
          encodeLocatorQuery([
            { kind: "selector", selector },
            { kind: "nth", index },
            { kind: "role", role: "button" },
          ]),
        );
        expect(await scoped.count()).toBe(1);
        expect(await scoped.textContent()).toBe(expected);
      }
    },
  );

  it("retains existing text= behavior when used as the builder root", async () => {
    const selector = 'text="Legacy"';
    const count = await page.locator(selector).count();
    expect(count).toBe(5);
    for (let index = 0; index < count; index++) {
      const expected = await page.locator(selector).nth(index).textContent();
      const scoped = page.locator(
        encodeLocatorQuery([
          { kind: "selector", selector },
          { kind: "nth", index },
          { kind: "text", text: "Legacy" },
        ]),
      );
      expect(await scoped.count()).toBe(1);
      expect(await scoped.textContent()).toBe(expected);
    }
  });

  it.each(["( //div[@id='cards'])[1]", "(.//div[@id='cards'])[1]"])(
    "preserves the legacy parenthesized XPath classifier for %s",
    async (selector) => {
      await oracle.setContent('<div id="cards"><button>Add</button><button>Add</button></div>');
      expect(await page.locator(selector).count()).toBe(1);
      const scoped = page.locator(
        encodeLocatorQuery([
          { kind: "selector", selector },
          { kind: "role", role: "button" },
        ]),
      );
      expect(await scoped.count()).toBe(2);
      expect(await scoped.nth(0).textContent()).toBe("Add");
      expect(await scoped.nth(1).textContent()).toBe("Add");
    },
  );

  it("polls property-only checked changes with shadow piercing disabled", async () => {
    const selector = encodeLocatorQuery([
      { kind: "role", role: "checkbox", options: { name: "Native off", checked: true } },
    ]);
    await oracle.evaluate(() => {
      setTimeout(() => {
        (document.getElementById("unchecked") as HTMLInputElement).checked = true;
      }, 100);
    });
    expect(
      await page.waitForSelector(selector, {
        state: "attached",
        pierceShadow: false,
        timeout: 5_000,
      }),
    ).toBe(true);
  });

  it("honors the semantic wait's shadow-piercing option", async () => {
    const selector = encodeLocatorQuery([
      { kind: "role", role: "button", options: { name: "Shadow save" } },
    ]);
    expect(
      await page.waitForSelector(selector, {
        state: "detached",
        pierceShadow: false,
        timeout: 1_000,
      }),
    ).toBe(true);
    expect(
      await page.waitForSelector(selector, {
        state: "attached",
        pierceShadow: true,
        timeout: 1_000,
      }),
    ).toBe(true);
  });

  it("retains an existing iframe hop when applying a semantic scope", async () => {
    await oracle.setContent(
      '<button aria-label="Frame publish">Main action</button><iframe id="child" src="/child"></iframe>',
    );
    await oracle.frameLocator("#child").getByRole("button", { name: "Frame publish" }).waitFor();
    const scoped = page.locator(
      encodeLocatorQuery([
        { kind: "selector", selector: "#child >> body" },
        { kind: "role", role: "button", options: { name: "Frame publish" } },
      ]),
    );
    expect(await scoped.count()).toBe(1);
    expect(await scoped.textContent()).toBe("Child action");
  });
});

function pattern(value: TextPattern): string | RegExp {
  return typeof value === "string" ? value : new RegExp(value.source, value.flags);
}

function oracleLocator(page: Page, steps: QueryStep[]): Locator {
  let locator: Locator | undefined;
  for (const step of steps) {
    const scope = locator ?? page;
    switch (step.kind) {
      case "selector":
        locator = scope.locator(step.selector);
        break;
      case "role": {
        const { name, description, ...options } = step.options ?? {};
        locator = scope.getByRole(step.role, {
          ...options,
          ...(name === undefined ? {} : { name: pattern(name) }),
          ...(description === undefined ? {} : { description: pattern(description) }),
        });
        break;
      }
      case "text":
        locator = scope.getByText(pattern(step.text), { exact: step.exact });
        break;
      case "nth":
        if (!locator) throw new Error("nth requires an existing locator");
        locator = locator.nth(step.index);
        break;
    }
  }
  if (!locator) throw new Error("Expected a non-empty locator query");
  return locator;
}
