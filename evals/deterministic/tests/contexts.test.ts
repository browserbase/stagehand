import { test, expect } from "@playwright/test";
import { Stagehand } from "../../../lib";
import { Browserbase } from "@browserbasehq/sdk";
const CONTEXT_TEST_URL = "https://news.ycombinator.com";
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID!;
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY!;

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

const browserbase = new Browserbase({
  apiKey: BROWSERBASE_API_KEY,
});

test.describe("Contexts", () => {
  test("Persists and re-uses a context", async () => {
    let contextId: string;
    let sessionId: string;
    let testCookieName: string;
    let testCookieValue: string;

    await test.step("Creates a context", async () => {
      const context = await browserbase.contexts.create({
        projectId: BROWSERBASE_PROJECT_ID,
      });

      expect(context.id).toEqual(expect.any(String));
      contextId = context.id;
    });

    await test.step("Creates a session with the context", async () => {
      const session = await browserbase.sessions.create({
        projectId: BROWSERBASE_PROJECT_ID,
        browserSettings: {
          context: {
            id: contextId,
            persist: true,
          },
        },
      });

      expect(session.contextId).toEqual(contextId);
      sessionId = session.id;
    });

    await test.step("Populates and persists the context", async () => {
      console.log(
        `Populating context ${contextId} during session ${sessionId}`,
      );

      const stagehand = new Stagehand({
        env: "BROWSERBASE",
        verbose: 1,
        debugDom: true,
        domSettleTimeoutMs: 100,
      });
      await stagehand.init();

      const page = stagehand.page;
      await page.goto(CONTEXT_TEST_URL, { waitUntil: "domcontentloaded" });

      // set a random cookie on the page
      const now = new Date();
      testCookieName = `bb_${now.getTime().toString()}`;
      testCookieValue = now.toISOString();
      await stagehand.context.addCookies([
        {
          domain: ".ycombinator.com",
          // expires expects "Unix time in seconds"
          expires: addHour(now),
          name: testCookieName,
          path: "/",
          value: testCookieValue,
        },
      ]);

      expect(findCookie(stagehand, testCookieName)).toBeDefined();

      await page.goto("https://www.google.com", {
        waitUntil: "domcontentloaded",
      });

      await page.goBack();

      // validate the cookie was persisted between pages
      expect(findCookie(stagehand, testCookieName)).toBeDefined();

      await stagehand.close();

      // give the browser a moment to persist the context
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    });

    await test.step("Creates another session with the same context", async () => {
      const session = await browserbase.sessions.create({
        projectId: BROWSERBASE_PROJECT_ID,
        browserSettings: {
          context: {
            id: contextId,
          },
        },
      });

      expect(session.contextId).toEqual(contextId);
      sessionId = session.id;
    });

    await test.step("Uses context to find previous state", async () => {
      console.log(`Reusing context ${contextId} during session ${sessionId}`);

      const stagehand = new Stagehand({
        env: "BROWSERBASE",
        verbose: 1,
        debugDom: true,
        domSettleTimeoutMs: 100,
        browserbaseSessionID: sessionId,
      });
      await stagehand.init();

      const page = stagehand.page;

      await page.goto(CONTEXT_TEST_URL, { waitUntil: "domcontentloaded" });

      // validate the cookie was restored from the previous session
      const foundCookie = await findCookie(stagehand, testCookieName);
      expect(foundCookie).toBeDefined();
      expect(foundCookie?.value).toEqual(testCookieValue);

      await stagehand.close();
    });
  });

  test("Here's another test", async () => {
    let contextId: string;

    await test.step("Creates a context", async () => {
      const context = await browserbase.contexts.create({
        projectId: BROWSERBASE_PROJECT_ID,
      });

      expect(context.id).toEqual(expect.any(String));
      contextId = context.id;
    });

    await test.step("Creates a session with the context", async () => {
      const session = await browserbase.sessions.create({
        projectId: BROWSERBASE_PROJECT_ID,
        browserSettings: {
          context: {
            id: contextId,
          },
        },
      });

      expect(session.contextId).toEqual(contextId);
    });
  });
});
