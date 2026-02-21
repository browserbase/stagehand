import { test, expect } from "@playwright/test";
import { V3 } from "../v3.js";
import puppeteer from "puppeteer-core";
import { chromium as playwrightChromium } from "playwright-core";
import { chromium as patchrightChromium } from "patchright-core";
import { Action } from "../types/public/methods.js";
import { AnyPage } from "../types/public/page.js";
import { v3DynamicTestConfig } from "./v3.dynamic.config.js";
import { closeV3 } from "./testUtils.js";

/**
 * IMPORTANT:
 * - We create a single V3 instance/test to avoid cross-test state. Increase parallelism later if needed.
 * - We assert an *effect* when feasible (e.g. input value). For pure clicks we assert no thrown error.
 */

type Case = {
  title: string;
  url: string;
  action: Action;
  expectedSubstrings: string[]; // check v3.extract().pageText contains these
};

type Framework = "v3" | "puppeteer" | "playwright" | "patchright";

async function runCase(v3: V3, c: Case, framework: Framework): Promise<void> {
  let cleanup: (() => Promise<void> | void) | null = null;

  // Acquire the correct page for the requested framework
  let page: AnyPage | undefined;
  switch (framework) {
    case "v3": {
      const v3Page = v3.context.pages()[0];
      await v3Page.goto(c.url, { waitUntil: "networkidle" });
      page = v3Page;
      break;
    }
    case "puppeteer": {
      const browser = await puppeteer.connect({
        browserWSEndpoint: v3.connectURL(),
        defaultViewport: null,
      });
      const pages = await browser.pages();
      const puppeteerPage = pages[0];
      await puppeteerPage.goto(c.url, { waitUntil: "networkidle0" });
      page = puppeteerPage;
      cleanup = async () => {
        try {
          await browser.close();
        } catch {
          //
        }
      };
      break;
    }
    case "playwright": {
      const pwBrowser = await playwrightChromium.connectOverCDP(
        v3.connectURL(),
      );
      const pwContext = pwBrowser.contexts()[0];
      const pwPage = pwContext.pages()[0];
      await pwPage.goto(c.url, { waitUntil: "networkidle" as never });
      page = pwPage as unknown as AnyPage;
      cleanup = async () => {
        try {
          await pwBrowser.close();
        } catch {
          // ignore
        }
      };
      break;
    }
    case "patchright": {
      const prBrowser = await patchrightChromium.connectOverCDP(
        v3.connectURL(),
      );
      const prContext = prBrowser.contexts()[0];
      const prPage = prContext.pages()[0];
      await prPage.goto(c.url, { waitUntil: "networkidle" as never });
      page = prPage as unknown as AnyPage;
      cleanup = async () => {
        try {
          await prBrowser.close();
        } catch {
          // ignore
        }
      };
      break;
    }
  }

  try {
    if (!page) throw new Error("Missing page for selected framework");
    await v3.act(c.action, { page });
    // Post-action extraction; verify expected text appears
    const extraction = await v3.extract({ page });
    const text = extraction.pageText ?? "";
    for (const s of c.expectedSubstrings) {
      expect(
        text.includes(s),
        `expected pageText to include substring: ${s}`,
      ).toBeTruthy();
    }
  } finally {
    await cleanup?.();
  }
}

const cases: Case[] = [
  {
    title: "Open shadow root inside SPIF",
    url: "https://browserbase.github.io/stagehand-eval-sites/sites/open-shadow-root-in-spif/",
    action: {
      selector:
        "xpath=/html/body/main/section/iframe/html/body/shadow-demo//div/button",
      method: "click",
      arguments: [""],
      description: "",
    },
    expectedSubstrings: ["button successfully clicked"],
  },
  {
    title: "Closed shadow root inside SPIF",
    url: "https://browserbase.github.io/stagehand-eval-sites/sites/closed-shadow-dom-in-spif/",
    action: {
      selector: "xpath=/html/body/div/iframe/html/body/shadow-demo//div/button",
      method: "click",
      arguments: [""],
      description: "",
    },
    expectedSubstrings: ["button successfully clicked"],
  },
  {
    title: "SPIF inside closed shadow root",
    url: "https://browserbase.github.io/stagehand-eval-sites/sites/spif-in-closed-shadow-dom/",
    action: {
      selector: "xpath=/html/body/shadow-host//div/iframe/html/body/button",
      method: "click",
      arguments: [""],
      description: "",
    },
    expectedSubstrings: ["button successfully clicked"],
  },
  {
    title: "SPIF inside open shadow root",
    url: "https://browserbase.github.io/stagehand-eval-sites/sites/spif-in-open-shadow-dom/",
    action: {
      selector: "xpath=/html/body/shadow-host//div/iframe/html/body/button",
      method: "click",
      arguments: [""],
      description: "click button inside SPIF under open shadow",
    },
    expectedSubstrings: ["button successfully clicked"],
  },
];

test.describe.parallel("Stagehand v3: shadow <-> iframe SPIF scenarios", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await closeV3(v3);
  });

  const frameworks: Framework[] = [
    "v3",
    "playwright",
    "puppeteer",
    "patchright",
  ];
  for (const fw of frameworks) {
    for (const c of cases) {
      test(`[${fw}] ${c.title}`, async () => {
        await runCase(v3, c, fw);
      });
    }
  }
});
