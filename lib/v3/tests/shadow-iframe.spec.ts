import { test, expect } from "@playwright/test";
import { V3 } from "../../v3/v3";
import puppeteer from "puppeteer-core";

/**
 * IMPORTANT:
 * - We create a single V3 instance/test to avoid cross-test state. Increase parallelism later if needed.
 * - We assert an *effect* when feasible (e.g. input value). For pure clicks we assert no thrown error.
 */

test.describe("Stagehand v3: shadow <-> iframe scenarios", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3({ env: "LOCAL", headless: false, verbose: 0 });
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("Closed shadow root inside OOPIF", async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: v3.connectURL(),
    });
    const puppeteerPages = await browser.pages();
    const page = puppeteerPages[0];
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/closed-shadow-root-in-oopif/",
      );

      const observeResult = {
        selector:
          "xpath=/html/body/main/section/iframe/html/body/shadow-demo//div/button",
        method: "click",
        description: "click button inside closed shadow root in OOPIF",
        arguments: [""],
      };

      await v3.act(observeResult, page);
      // If we reach here, no exception was thrown (our minimal assertion for this site).
      // TODO: harden this assertion such that we know for sure that the button was clicked
      expect(true).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test("Open shadow root inside OOPIF", async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: v3.connectURL(),
    });
    const puppeteerPages = await browser.pages();
    const page = puppeteerPages[0];
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/open-shadow-root-in-oopif/",
      );

      const observeResult = {
        selector:
          "xpath=/html/body/main/section/iframe/html/body/shadow-demo//div/button",
        method: "click",
        description: "nunya",
        arguments: [""],
      };
      await v3.act(observeResult, page);
      // TODO: harden this assertion such that we know for sure that the button was clicked
      expect(true).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test("Open shadow root inside SPIF", async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: v3.connectURL(),
    });
    const puppeteerPages = await browser.pages();
    const page = puppeteerPages[0];
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/open-shadow-root-in-spif/",
      );

      const observeResult = {
        selector:
          "xpath=/html/body/main/section/iframe/html/body/shadow-demo//div/button",
        method: "click",
        description: "nunya",
        arguments: [""],
      };

      await v3.act(observeResult, page);
      // TODO: harden this assertion such that we know for sure that the button was clicked
      expect(true).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test("Closed shadow root inside SPIF", async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: v3.connectURL(),
    });
    const puppeteerPages = await browser.pages();
    const page = puppeteerPages[0];
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/closed-shadow-dom-in-spif/",
      );

      const observeResult = {
        selector:
          "xpath=/html/body/div/iframe/html/body/shadow-demo//div/button",
        method: "click",
        description: "nunya",
        arguments: [""],
      };

      await v3.act(observeResult, page);
      // TODO: harden this assertion such that we know for sure that the button was clicked
      expect(true).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test("SPIF inside closed shadow root", async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: v3.connectURL(),
    });
    const puppeteerPages = await browser.pages();
    const page = puppeteerPages[0];
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/spif-in-closed-shadow-dom/",
      );

      const observeResult = {
        selector: "xpath=/html/body/shadow-host//div/iframe/html/body/button",
        method: "click",
        description: "nunya",
        arguments: [""],
      };

      await v3.act(observeResult, page);
      // TODO: harden this assertion such that we know for sure that the button was clicked
      expect(true).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test("SPIF inside open shadow root", async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: v3.connectURL(),
    });
    const puppeteerPages = await browser.pages();
    const page = puppeteerPages[0];
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/spif-in-open-shadow-dom/",
      );

      const observeResult = {
        selector: "xpath=/html/body/shadow-host//div/iframe/html/body/button",
        method: "click",
        description: "click button inside SPIF under open shadow",
        arguments: [""],
      };

      await v3.act(observeResult, page);
      // TODO: harden this assertion such that we know for sure that the button was clicked
      expect(true).toBeTruthy();
    } finally {
      await browser.close();
    }
  });

  test("OOPIF inside open shadow root", async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: v3.connectURL(),
    });
    const puppeteerPages = await browser.pages();
    const page = puppeteerPages[0];
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-open-shadow-dom/",
      );

      const observeResult = {
        selector:
          "xpath=/html/body/shadow-host//section/iframe/html/body/main/section[1]/form/div/div[1]/input",
        method: "fill",
        description: "nunya",
        arguments: ["nunya"],
      };

      await v3.act(observeResult, page);

      const child = page.frames().find((f) => f !== page.mainFrame());
      expect(child, "expected a child OOPIF frame").toBeTruthy();

      const value = await child!.evaluate(() => {
        const el = document.querySelector(
          "main section form div div input",
        ) as HTMLInputElement | null;
        return el?.value ?? null;
      });
      expect(value).toBe("nunya");
    } finally {
      await browser.close();
    }
  });

  test("OOPIF inside closed shadow root", async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: v3.connectURL(),
    });
    const puppeteerPages = await browser.pages();
    const page = puppeteerPages[0];
    try {
      // Site with OOPIF under closed shadow; target is an input *inside the OOPIF*, not in the closed root.
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-closed-shadow-dom/",
      );

      const observeResult = {
        selector:
          "xpath=/html/body/shadow-host//section/iframe/html/body/main/section[1]/form/div/div[1]/input",
        method: "fill",
        description: "fill input inside OOPIF",
        arguments: ["nunya"],
      };
      // Act through V3. If it throws, the test fails naturally.
      await v3.act(observeResult, page);

      // ASSERT: verify the input value inside the OOPIF
      // Grab child frame (the OOPIF). We know it's the only iframe on this page.
      const child = page.frames().find((f) => f !== page.mainFrame());
      expect(child, "expected a child OOPIF frame").toBeTruthy();

      // Evaluate the value of the target input using regular DOM; it's not inside a closed root.
      const value = await child!.evaluate(() => {
        const el = document.querySelector(
          "main section form div div input",
        ) as HTMLInputElement | null;
        return el?.value ?? null;
      });
      expect(value).toBe("nunya");
    } finally {
      await browser.close();
    }
  });
});
