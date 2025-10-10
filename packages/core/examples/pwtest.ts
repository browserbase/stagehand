import { chromium } from "playwright";
import Browserbase from "@browserbasehq/sdk";
import dotenv from "dotenv";

dotenv.config();

const bb = new Browserbase({
  apiKey: process.env.BROWSERBASE_API_KEY,
});
console.log(bb);

(async () => {
  // Create a new session
  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
  });
  console.log(session.id);

  // Connect to the session
  const browser = await chromium.connectOverCDP(session.connectUrl);

  // Getting the default context to ensure the sessions are recorded.
  const defaultContext = browser.contexts()[0];
  const page = defaultContext.pages()[0];
  let i = 0;
  while (true) {
    await page.goto("https://douglas.de/");
    i++;
    console.log(i);
    // await new Promise((resolve) => setTimeout(resolve, 1000));
  }
})().catch((error) => console.error(error.message));
