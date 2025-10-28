import { expect, test } from "@playwright/test";
import { V3 } from "../v3";
import { v3DynamicTestConfig } from "./v3.dynamic.config";
import { performUnderstudyMethod } from "../handlers/handlerUtils/actHandlerUtils";

test.describe("tests performUnderstudyMethod", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3DynamicTestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("tests that clicking works", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/no-js-click/",
    );

    await performUnderstudyMethod(
      page,
      page.mainFrame(),
      "click",
      "/html/body/button",
      [],
      30000,
    );

    const isVisible = await page.locator("#success-msg").isVisible();
    expect(isVisible).toBe(true);
  });

  test("fill sets input value", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/login/",
    );

    await performUnderstudyMethod(
      page,
      page.mainFrame(),
      "fill",
      "/html/body/main/form/div[1]/input",
      ["Alice"],
      30000,
    );

    const textContent = await page
      .locator("/html/body/main/form/div[1]/input")
      .inputValue();
    expect(textContent).toBe("Alice");
  });

  test("tests that key presses work", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/key-press/",
    );

    await performUnderstudyMethod(
      page,
      page.mainFrame(),
      "press",
      "xpath=/html",
      ["Enter"],
      30000,
    );

    const textContent = await page
      .locator("/html/body/div/div/h1")
      .textContent();
    expect(textContent).toContain("Enter");
  });

  test("tests select option from a dropdown", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/nested-dropdown/",
    );

    await performUnderstudyMethod(
      page,
      page.mainFrame(),
      "selectOptionFromDropdown",
      "xpath=//*[@id='licenseType']",
      ["Smog Check Technician"],
      30000,
    );

    const inputValue = await page
      .locator("#licenseType >> option:checked")
      .textContent();
    expect(inputValue).toBe("Smog Check Technician");
  });

  test("tests drag & drop works (start xpath & end xpath)", async () => {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/drag-drop/",
    );

    await performUnderstudyMethod(
      page,
      page.mainFrame(),
      "dragAndDrop",
      "xpath=/html/body/div/section[1]/div[1]/div[1]", // start xpath
      ["/html/body/div/section[2]/div/div[1]"], // end xpath
      30000,
    );

    const droppedContent = await page
      .locator("/html/body/div/section[2]/div/div[1]/div")
      .textContent();
    expect(droppedContent).toBe("TEXT: Hello from text");
  });
});
