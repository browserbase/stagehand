import {
  type Page,
  type Browser,
  type BrowserContext,
  chromium,
  Locator,
} from "@playwright/test";
import { expect } from "@playwright/test";
import {
  getCacheKey,
  initCache,
  readActions,
  readObservations,
  writeActions,
  writeObservations,
} from "../cache";
import OpenAI from "openai";

require("dotenv").config({ path: ".env" });

async function getBrowser(env: "LOCAL" | "BROWSERBASE" = "BROWSERBASE") {
  if (process.env.BROWSERBASE_API_KEY && env !== "LOCAL") {
    console.log("Connecting you to broswerbase...");
    const browser = await chromium.connectOverCDP(
      `wss://api.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}`,
    );
    const context = browser.contexts()[0];
    return { browser, context };
  } else {
    if (!process.env.BROWSERBASE_API_KEY) {
      console.log("No browserbase key detected");
      console.log("Starting a local browser...");
    }
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    console.log("Local browser started successfully.");
    return { browser, context, page };
  }
}

const interactiveElements = [
  "a",
  "button",
  "[role='button']",
  "[aria-role='button']",
  "details",
  "embed",
  "input",
  "label",
  "menu",
  "[role='menu']",
  "[aria-role='menu']",
  "menuitem",
  "[role='menuitem']",
  "[aria-role='menuitem']",
  "object",
  "select",
  "textarea",
  "summary",
  "[role='link']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='slider']",
  "[role='tab']",
  "[role='tabpanel']",
  "[role='textbox']",
  "[role='combobox']",
  "[role='grid']",
  "[role='listbox']",
  "[role='option']",
  "[role='progressbar']",
  "[role='scrollbar']",
  "[role='searchbox']",
  "[role='switch']",
  "[role='tree']",
  "[role='treeitem']",
  "[role='spinbutton']",
  "[role='tooltip']",
];

export class Stagehand {
  private openai: OpenAI;
  public observations: { [key: string]: { result: string; testKey: string } };
  private actions: { [key: string]: { result: string; testKey: string } };
  testKey: string;
  public browser: Browser;
  public page: Page;
  public context: BrowserContext;
  public env: "LOCAL" | "BROWSERBASE";

  constructor(
    { env }: { env: "LOCAL" | "BROWSERBASE" } = { env: "BROWSERBASE" },
  ) {
    this.openai = new OpenAI();
    this.env = env;
    initCache();

    this.observations = readObservations();
    this.actions = readActions();
  }

  async init() {
    const { browser, context } = await getBrowser(this.env);
    this.browser = browser;
    this.context = context;
    this.page = this.context.pages()[0];

    const currentPath = require("path").resolve(__dirname, "../lib/playwright/preload.js");
    await this.page.addInitScript({ path: currentPath });
    await this.page.on("domcontentloaded", async () => {
      return this.page.evaluate(() => window.waitForDomSettle());
    });
  }

  async cleanDOM(parent: Locator) {
    const elementsSelector = interactiveElements.join(", ");

    console.log("\nCLEAN DOM SELECTOR");
    console.log(elementsSelector);

    const foundElements = await parent.locator(elementsSelector).all();

    const results = await Promise.allSettled(
      foundElements.map((el) => el.evaluate((el) => el.outerHTML)),
    );

    console.log("\nFOUND ELEMENTS STRING");
    console.log(results);

    const cleanedHtml = results
      .filter(
        (r): r is PromiseFulfilledResult<string> => r.status === "fulfilled",
      )
      .map((r) => r.value)
      .join("\n");

    console.log("\nCLEANED HTML STRING");
    console.log(cleanedHtml);

    return cleanedHtml;
  }

  async observe(observation: string): Promise<string> {
    const key = getCacheKey(observation);
    if (this.observations[key]) {
      console.log("cache hit!");
      console.log(`using ${JSON.stringify(this.observations[key])}`);

      expect(this.page.locator(this.observations[key].result)).toBeAttached();

      return key;
    }

    const shot = await this.page.screenshot({
      fullPage: true,
    });

    const response = await this.openai.chat.completions.create({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "system",
          content: `You are helping a user navigate a webpage, given a screenshot. Verify that the users request is possible, and if so, provide a simple description of the target element that would satisfy the request.
          respond ONLY with the element description

    `,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${shot.toString("base64")}`,
              },
            },
            {
              type: "text",
              text: `
                user request: ${observation}
                 `,
            },
          ],
        },
      ],
    });

    if (!response.choices[0].message.content) {
      throw new Error("no response when observing");
    }

    const fullBody = await this.page.evaluate(() => document.body.outerHTML);
    const quarterLength = Math.floor(fullBody.length / 4);
    const bodies = [
      fullBody.substring(0, quarterLength),
      fullBody.substring(quarterLength, quarterLength * 2),
      fullBody.substring(quarterLength * 2, quarterLength * 3),
      fullBody.substring(quarterLength * 3),
    ];

    for (const body of bodies) {
      const selectorResponse = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are helping the user automate the browser by finding a playwright locator string. You will be given a description of the element to find, and the DOM.


            return only the string to pass to playwright, no markdown
            if the element is not found, return NONE
                  
                  `,
          },
          {
            role: "user",
            content: `
                    description: ${response.choices[0].message.content}
                    DOM: ${body}
                    `,
          },
        ],

        temperature: 0.1,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
      });

      if (!selectorResponse.choices[0].message.content) {
        throw new Error("no response when finding a selector");
      }

      if (selectorResponse.choices[0].message.content === "NONE") {
        continue;
      }

      expect(
        this.page.locator(selectorResponse.choices[0].message.content),
      ).toBeAttached();

      console.log(
        this.page.locator(selectorResponse.choices[0].message.content),
      );
      const key = await this.cacheObservation(
        observation,
        selectorResponse.choices[0].message.content,
      );

      return key;
    }

    console.log("Found bodies", bodies)

    throw new Error("fail");
  }
  setTestKey(key: string) {
    this.testKey = key;
  }

  async cacheObservation(observation: string, result: string): Promise<string> {
    let cache = readObservations();

    const key = getCacheKey(observation);

    cache[key] = { result, testKey: this.testKey };
    this.observations[key] = { result, testKey: this.testKey };

    writeObservations(cache);
    return key;
  }

  async cacheAction(action: string, result: string): Promise<string> {
    let cache = readActions();

    const key = getCacheKey(action);

    cache[key] = { result, testKey: this.testKey };
    this.actions[key] = { result, testKey: this.testKey };

    writeActions(cache);
    return key;
  }

  async act({
    observation,
    action,
    data,
  }: {
    observation?: string;
    action: string;
    data?: object;
  }): Promise<void> {
    console.log("taking action: ", action);
    const key = getCacheKey(action);
    let cachedAction = this.actions[key];
    if (cachedAction) {
      console.log(`cache hit for action: ${action}`);
      console.log(cachedAction);
      const res = JSON.parse(cachedAction.result);
      console.log(res);
      for (const command of res) {
        const locatorStr = command["locator"];
        const method = command["method"];
        const args = command["args"];

        console.log(
          `Cached action ${method} on ${locatorStr} with args ${args}`,
        );
        const locator = await this.page.locator(locatorStr).first();
        await locator[method](...args);
      }
      await this.page.waitForTimeout(2000); //waitForNavigation and waitForLoadState do not work in this case

      return;
    }

    const area = await this.cleanDOM(
      observation
        ? this.page.locator(this.observations[observation].result)
        : this.page.locator("body"),
    );

    console.log(area);

    const response = await this.openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content:
            "You are helping the user automate browser by finding one or more actions to take.\n\nyou will be given a DOM element, an overall goal, and data to use when taking actions.\n\nuse selectors that are least likely to change\n\nfor each action required to complete the goal,  follow this format in raw JSON, no markdown\n\n[{\n method: string (the required playwright function to call)\n locator: string (the locator to find the element to act on),\nargs: Array<string | number> (the required arguments)\n}]\n\n\n\n",
        },
        {
          role: "user",
          content: `
            action: ${action},
            DOM: ${area}
            data: ${JSON.stringify(data)}`,
        },
      ],

      temperature: 0.1,
      max_tokens: 256,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    if (!response.choices[0].message.content) {
      throw new Error("no response from action model");
    }

    const res = JSON.parse(response.choices[0].message.content);
    for (const command of res) {
      const locatorStr = command["locator"];
      const method = command["method"];
      const args = command["args"];

      console.log(`taking action ${method} on ${locatorStr} with args ${args}`);
      const locator = await this.page.locator(locatorStr).first();
      await locator[method](...args);
    }

    this.cacheAction(action, response.choices[0].message.content);

    await this.page.waitForTimeout(2000); //waitForNavigation and waitForLoadState do not work in this case

    console.log("done acting");
  }
  setPage(page: Page) {
    this.page = page;
  }
  setContext(context: BrowserContext) {
    this.context = context;
  }
}
