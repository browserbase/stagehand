import "dotenv/config";
import Browserbase from "@browserbasehq/sdk";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { mkdir, writeFile } from "node:fs/promises";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
const apiKey = requireEnv("BROWSERBASE_API_KEY");
const modelKey = requireEnv("OPENAI_API_KEY");
const username = requireEnv("LOGIN_USER");
const password = requireEnv("LOGIN_PASSWORD");
let contextId = process.env.BROWSERBASE_CONTEXT_ID;
if (!contextId) {
  const bb = new Browserbase({ apiKey });
  const context = await bb.contexts.create();
  contextId = context.id;
  console.log("Created Browserbase context:", contextId);
}
const browser = await browserbase.launch({
  apiKey,
  timeout: 300,
  browserSettings: { context: { id: contextId, persist: true } },
});
try {
  console.log(`Session: https://www.browserbase.com/sessions/${browser.sessionId}`);
  const stagehand = await Stagehand.create({
    browser,
    model: { modelName: "openai/gpt-5.6-sol", apiKey: modelKey },
  });
  try {
    const page = await browser.context.activePage();
    if (!page) throw new Error("No active page");
    await page.goto("https://the-internet.herokuapp.com/secure", { timeout: 45_000 });
    if (!(await page.waitForSelector('a[href="/logout"], input#username', { timeout: 15_000 })))
      throw new Error("Neither authenticated page nor login form is ready");
    const reused = (await page.locator('a[href="/logout"]').count()) > 0;
    if (!reused) {
      await page.goto("https://the-internet.herokuapp.com/login", { timeout: 45_000 });
      const instructions: { instruction: string; variables: Record<string, string> }[] = [
        { instruction: "Type %username% into the username field", variables: { username } },
        { instruction: "Type %password% into the password field", variables: { password } },
        { instruction: "Click the Login button", variables: {} },
      ];
      for (const step of instructions) {
        const result = await stagehand.act(step.instruction, { page, variables: step.variables });
        if (!result.data.success) throw new Error("Login action failed; inspect the session");
      }
      await page.goto("https://the-internet.herokuapp.com/secure", { timeout: 45_000 });
    }
    if (!(await page.locator('a[href="/logout"]').isVisible()))
      throw new Error("Authentication failed; no retry was attempted");
    await mkdir("out", { recursive: true });
    await writeFile(
      "out/login.json",
      `${JSON.stringify({ authenticated: true, reused, sessionId: browser.sessionId }, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.log(
      reused
        ? "Reused authenticated context"
        : "Authenticated; context will persist when the browser closes",
    );
  } finally {
    await stagehand.close();
  }
} finally {
  await browser.close();
}
