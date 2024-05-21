import { test as base, chromium } from '@playwright/test';
import { Stagehand } from './index';
import { evictCache } from '../cache';

type Fixture = {
  stagePage: Stagehand;
};

export const stagehandFixture = base.extend<Fixture>({
  stagePage: async ({}, use) => {
    if (process.env.BROWSERBASE_API_KEY && process.env.local !== '1') {
      console.log('Browserbase key detected, connecting you to a browser...');
      const browser = await chromium.connectOverCDP(
        `wss://api.browserbase.com?apiKey=${process.env.BROWSERBASE_API_KEY}`
      );

      console.log('connected, happy browsing!');
      const bbPage = new Stagehand();
      await bbPage.init();
      await use(bbPage);
    } else {
      console.log('running tests locally...');
      const bbPage = new Stagehand();
      await bbPage.init();
      await use(bbPage);
    }
  },
});

stagehandFixture.afterAll(async ({ browser }) => {
  if (process.env.local !== '1') {
    console.log('tests finished... disconnecting from Browserbase');
    await browser.close();
    console.log('disconnected from Browserbase');
  }
});

stagehandFixture.afterEach(async ({ stagePage }) => {
  console.log('test status: ', stagehandFixture.info().status);
  if (stagehandFixture.info().status !== 'passed') {
    console.log('evicting cache id: ', stagePage.id);
    evictCache(stagePage.id);
    console.log('cache evicted');
  }
});

stagehandFixture.beforeEach(
  'capture test info',
  async ({ stagePage }, info) => {
    stagePage.setId(info.titlePath.join('.').replace(/\s/g, '_'));
  }
);
