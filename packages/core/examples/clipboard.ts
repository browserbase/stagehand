import { Stagehand } from "../lib/v3/index.js";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto("https://example.com");

  await new Promise((resolve) => setTimeout(resolve, 3000));
  await page.evaluate(() => {
    document.body.innerHTML =
      "<textarea autofocus style='width:400px;height:120px'></textarea>";
    document.querySelector("textarea")?.focus();
  });

  await stagehand.context.clipboard.writeText("Hello from Stagehand");
  await stagehand.context.clipboard.paste();

  await page.keyPress("ControlOrMeta+A");
  await stagehand.context.clipboard.copy();
  const copied = await stagehand.context.clipboard.readText();
  console.log(copied);

  await stagehand.context.clipboard.clear();
}

(async () => {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    model: "openai/gpt-5",
    verbose: 2,
  });
  try {
    await stagehand.init();
    await example(stagehand);
  } finally {
    await stagehand.close();
  }
})();
