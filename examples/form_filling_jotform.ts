import { Stagehand } from "@/dist";
// import { GroqClient } from "@/lib/llm/GroqClient";
// import { CerebrasClient } from "../lib/llm/CerebrasClient";
import StagehandConfig from "@/stagehand.config";

async function example() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    modelName: "gpt-4o",
    modelClientOptions: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  });
  await stagehand.init();
  const page = stagehand.page;
  await page.goto("https://form.jotform.com/251018791931458");
  await page.act("enter john in first name");
  await page.act("enter doe in last name");
  await page.act("enter 43 in age");
  await page.act("enter 1234567890 in phone number");
  await page.act("enter abc@xyz.com in email");
  await page.act("select male in gender dropdown");
  await page.act("select no in are you taking any medication dropdown");
  await page.act("select yes in medication allergies dropdown");
  await page.act("select no in chronic medical conditions");
  await page.act("select yes in tobacco products");
  await page.act("select india in country of origin");
  await page.act("select ep in visa status");
  await page.act("submit form");
  await stagehand.close();
}

(async () => {
  await example();
})();
