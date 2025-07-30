import Browserbase from "@browserbasehq/sdk";
import { expect, test } from "@playwright/test";
import StagehandConfig from "@/evals/deterministic/stagehand.config";
import { Stagehand } from "@browserbasehq/stagehand";

// Configuration
const CONTEXT_TEST_URL = "https://docs.browserbase.com";
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID!;
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY!;

const bb = new Browserbase({
  apiKey: BROWSERBASE_API_KEY,
});

// Helper functions
function addHour(date: Date): number {
  const SECOND = 1000;
  return new Date(date.getTime() + 60 * 60 * 1000).getTime() / SECOND;
}

async function findCookie(stagehand: Stagehand, name: string) {
  const defaultContext = stagehand.context;
  const cookies = await defaultContext?.cookies();
  return cookies?.find((cookie) => cookie.name === name);
}

async function createContext() {
  console.log("Creating a new context...");
  const context = await bb.contexts.create({
    projectId: BROWSERBASE_PROJECT_ID,
  });
  const contextId = context.id;
  console.log(`Context created with ID: ${contextId}`);
  return contextId;
}

async function setRandomCookie(contextId: string, stagehand: Stagehand) {
  console.log(
    `Populating context ${contextId} during session ${stagehand.browserbaseSessionID}`,
  );
  const page = stagehand.page;

  await page.goto(CONTEXT_TEST_URL, { waitUntil: "domcontentloaded" });

  const now = new Date();
  const testCookieName = `bb_${now.getTime().toString()}`;
  const testCookieValue = now.toISOString();

  await stagehand.context.addCookies([
    {
      domain: `.${new URL(CONTEXT_TEST_URL).hostname}`,
      expires: addHour(now),
      name: testCookieName,
      path: "/",
      value: testCookieValue,
    },
  ]);

  expect(findCookie(stagehand, testCookieName)).toBeDefined();
  console.log(`Set test cookie: ${testCookieName}=${testCookieValue}`);
  return { testCookieName, testCookieValue };
}

test.describe("Contexts", () => {
  test("Persists and re-uses a context", async () => {
    let contextId: string;
    let testCookieName: string;
    let testCookieValue: string;
    let stagehand: Stagehand;

    await test.step("Create a context", async () => {
      contextId = await createContext();
    });

    await test.step("Instantiate Stagehand with the context to persist", async () => {
      // We will be adding cookies to the context in this session, so we need mark persist=true
      stagehand = new Stagehand({
        ...StagehandConfig,
        env: "BROWSERBASE",
        useAPI: false,
        browserbaseSessionCreateParams: {
          projectId: BROWSERBASE_PROJECT_ID,
          browserSettings: {
            context: {
              id: contextId,
              persist: true,
            },
          },
        },
      });
      await stagehand.init();
    });

    await test.step("Set a random cookie on the page", async () => {
      ({ testCookieName } = await setRandomCookie(contextId, stagehand));

      const page = stagehand.page;
      await page.goto("https://www.google.com", {
        waitUntil: "domcontentloaded",
      });
      await page.goBack();
    });

    await test.step("Validate cookie persistence between pages", async () => {
      const cookie = await findCookie(stagehand, testCookieName);
      const found = !!cookie;
      expect(found).toBe(true);
      console.log("Cookie persisted between pages:", found);

      await stagehand.close();
      // Wait for context to persist
      console.log("Waiting for context to persist...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    });

    await test.step("Create another session with the same context", async () => {
      // We don't need to persist cookies in this session, so we can mark persist=false
      const newStagehand = new Stagehand({
        ...StagehandConfig,
        env: "BROWSERBASE",
        useAPI: false,
        browserbaseSessionCreateParams: {
          projectId: BROWSERBASE_PROJECT_ID,
          browserSettings: {
            context: {
              id: contextId,
              persist: false,
            },
          },
        },
      });
      await newStagehand.init();
      console.log(
        `Reusing context ${contextId} during session ${newStagehand.browserbaseSessionID}`,
      );
      const newPage = newStagehand.page;
      await newPage.goto(CONTEXT_TEST_URL, { waitUntil: "domcontentloaded" });

      const foundCookie = await findCookie(newStagehand, testCookieName);
      console.log("Cookie found in new session:", !!foundCookie);
      console.log(
        "Cookie value matches:",
        foundCookie?.value === testCookieValue,
      );

      await newStagehand.close();
    });
  });
});
