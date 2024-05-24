import {
  type Page,
  type Browser,
  type BrowserContext,
  chromium,
} from '@playwright/test';
import { expect } from '@playwright/test';
import Cache from '../cache';
import OpenAI from 'openai';
import crypto from 'crypto';
import { cleanDOM } from './dom';

require('dotenv').config({ path: '.env' });

async function getBrowser(env: 'LOCAL' | 'BROWSERBASE' = 'BROWSERBASE') {
  if (process.env.BROWSERBASE_API_KEY && env !== 'LOCAL') {
    console.log('Connecting you to broswerbase...');
    const browser = await chromium.connectOverCDP(
      `wss://api.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}`
    );
    const context = browser.contexts()[0];
    return { browser, context };
  } else {
    if (!process.env.BROWSERBASE_API_KEY) {
      console.log('No browserbase key detected');
      console.log('Starting a local browser...');
    }
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    console.log('Local browser started successfully.');
    return { browser, context, page };
  }
}

export class Stagehand {
  private openai: OpenAI;
  public observations: { [key: string]: { result: string; id: string } };
  private actions: { [key: string]: { result: string; id: string } };
  id: string;
  public browser: Browser;
  public page: Page;
  public context: BrowserContext;
  public env: 'LOCAL' | 'BROWSERBASE';
  public cache: Cache;

  constructor(
    {
      env,
      disableCache,
    }: { env: 'LOCAL' | 'BROWSERBASE'; disableCache?: boolean } = {
      env: 'BROWSERBASE',
      disableCache: false,
    }
  ) {
    this.openai = new OpenAI();
    this.env = env;
    this.cache = new Cache({ disabled: disableCache });
    this.observations = this.cache.readObservations();
    this.actions = this.cache.readActions();
  }

  async init() {
    const { browser, context } = await getBrowser(this.env);
    this.browser = browser;
    this.context = context;
    this.page = this.context.pages()[0];

    const currentPath = require('path').resolve(
      process.cwd(),
      'lib/playwright/preload.js'
    );
    await this.page.addInitScript({ path: currentPath });
  }

  async waitForSettledDom() {
    return this.page.evaluate(() => window.waitForDomSettle());
  }

  getKey(operation) {
    return crypto.createHash('sha256').update(operation).digest('hex');
  }

  async observe(observation: string): Promise<string | null> {
    const key = this.getKey(observation);
    const observationLocatorStr = this.observations[key]?.result;
    if (observationLocatorStr) {
      console.log('cache hit!');
      console.log(`using ${JSON.stringify(this.observations[key])}`);

      // the locator string found by the LLM might resolve to multiple places in the DOM
      const firstLocator = await this.page
        .locator(observationLocatorStr)
        .first();

      await expect(firstLocator).toBeAttached();

      console.log('done observing');

      return key;
    }

    const { outputString, selectorMap } = await cleanDOM(
      this.page.locator('body')
    );

    const selectorResponse = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are helping the user automate the browser by finding a playwright locator string. You will be given a instruction of the element to find, and a numbered list of possible elements.
            return only element id we are looking for
            if the element is not found, return NONE`,
        },
        {
          role: 'user',
          content: `
                    instruction: ${observation}
                    DOM: ${outputString}
                    `,
        },
      ],

      temperature: 0.1,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    const elementId = selectorResponse.choices[0].message.content;

    if (!elementId) {
      throw new Error('no response when finding a selector');
    }

    if (elementId === 'NONE') {
      return null;
    }

    const locatorString = `xpath=${selectorMap[elementId]}`;
    // the locator string found by the LLM might resolve to multiple places in the DOM
    const firstLocator = this.page.locator(locatorString).first();

    await expect(firstLocator).toBeAttached();
    const cachedKey = await this.cacheObservation(observation, locatorString);

    return cachedKey;
  }
  setId(key: string) {
    this.id = key;
  }

  async cacheObservation(observation: string, result: string): Promise<string> {
    const key = this.getKey(observation);

    this.observations[key] = { result, id: this.id };

    this.cache.writeObservations({ key, value: { result, id: this.id } });
    return key;
  }

  async cacheAction(action: string, result: string): Promise<string> {
    const key = this.getKey(action);

    this.actions[key] = { result, id: this.id };

    this.cache.writeActions({ key, value: { result, id: this.id } });
    return key;
  }

  async act({
    observation,
    action,
  }: {
    observation?: string;
    action: string;
    data?: object;
  }): Promise<void> {
    console.log('taking action: ', action);
    const key = this.getKey(action);
    let cachedAction = this.actions[key];
    if (cachedAction) {
      console.log(`cache hit for action: ${action}`);
      console.log(cachedAction);
      const res = JSON.parse(cachedAction.result);
      const commands = res.length ? res : [res];

      for (const command of commands) {
        const locatorStr = command['locator'];
        const method = command['method'];
        const args = command['args'];

        console.log(
          `Cached action ${method} on ${locatorStr} with args ${args}`
        );
        const locator = await this.page.locator(locatorStr).first();
        await locator[method](...args);
      }

      return;
    }

    if (observation) {
      console.log('observation', this.observations[observation].result);
    }

    const { outputString, selectorMap } = await cleanDOM(
      observation
        ? this.page.locator(this.observations[observation].result)
        : this.page.locator('body')
    );
    console.log(outputString);

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are helping the user automate browser by finding one or more actions to take.\n\nyou will be given a numbered list of relevant DOM elements to consider and an action to accomplish. for each action required to complete the goal,  follow this format in raw JSON, no markdown\n\n[{\n method: string (the required playwright function to call)\n element: number (the element number to act on),\nargs: Array<string | number> (the required arguments)\n}]',
        },
        {
          role: 'user',
          content: `
            action: ${action},
            DOM: ${outputString}`,
        },
      ],

      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 256,
      top_p: 1,

      frequency_penalty: 0,
      presence_penalty: 0,
    });
    console.log('inference complete');

    if (!response.choices[0].message.content) {
      throw new Error('no response from action model');
    }

    const res = JSON.parse(response.choices[0].message.content);
    const commands = res.length ? res : [res];
    for (const command of commands) {
      const element = command['element'];
      const path = selectorMap[element];
      const method = command['method'];
      const args = command['args'];

      console.log(`taking action ${method} on ${path} with args ${args}`);
      const locator = await this.page.locator(`xpath=${path}`).first();
      await locator[method](...args);
    }

    // disable cache for now
    // this.cacheAction(action, response.choices[0].message.content);

    await this.page.waitForTimeout(2000); //waitForNavigation and waitForLoadState do not work in this case

    console.log('done acting');
  }
  setPage(page: Page) {
    this.page = page;
  }
  setContext(context: BrowserContext) {
    this.context = context;
  }
}
