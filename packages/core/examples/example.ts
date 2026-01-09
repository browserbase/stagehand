import { Stagehand } from "../lib/v3";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    localBrowserLaunchOptions: {
      headless: false,
      args: [
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    },
  });

  await stagehand.init();
  const page = stagehand.context.pages()[0];

  // Navigate to bot detection test site
  // https://deviceandbrowserinfo.com/are_you_a_bot_interactions
  await page.goto(
    "https://deviceandbrowserinfo.com/are_you_a_bot_interactions",
    { waitUntil: "networkidle" },
  );

  // Stealth interactions - these use human-like mouse movements and typing
  // The cursor will move with realistic trajectories and type with natural delays
  const emailLocator = page.locator("#email");
  await emailLocator.click();
  await emailLocator.type("test@example.com");

  const pwLocator = page.locator("#password");
  await pwLocator.click();
  await pwLocator.type("SecurePass123!");

  const btnLocator = page.locator("#loginForm > button");
  await btnLocator.click();

  // Wait to see results
  await page.waitForTimeout(3000);

  console.log("Stealth test completed!");
  await stagehand.close();
}

example().catch(console.error);
