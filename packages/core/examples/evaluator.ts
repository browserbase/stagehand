/* eslint-disable */
import { Stagehand } from "../../../dist";
import StagehandConfig from "../stagehand.config";
import { Evaluator } from "../packages/evals/evaluator";

async function example() {
  const response = await fetch("https://api.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": process.env.BROWSERBASE_API_KEY,
    },
    body: JSON.stringify({
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      browserSettings: {
        advancedStealth: true,
        os: "linux",
      },
    }),
  });
  const session = await response.json();
  console.log(session);
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "BROWSERBASE",
    verbose: 2,
    useAPI: false,
    modelName: "google/gemini-2.5-flash",
    browserbaseSessionID: session.id,
  });

  await stagehand.init();
  const page = stagehand.page;
  const viewport = await page.evaluate(() => {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    };
  });
  console.log("viewport", viewport);
  const agent = stagehand.agent({
    provider: "openai",
    // For Anthropic, use claude-sonnet-4-20250514 or claude-3-7-sonnet-latest
    model: "computer-use-preview",
    instructions: `You are a helpful assistant that can use a web browser.
    You are currently on the following page: ${page.url()}.
    Do not ask follow up questions, the user will trust your judgement.`,
    options: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  await page.goto("https://tucowsdomains.com/abuse-form/phishing/");

  await agent.execute({
    instruction: "Fill in the form name with 'John Smith'",
    maxSteps: 3,
  });

  // const evaluator = new Evaluator(stagehand);
  // const result = await evaluator.ask({
  //   question: "Is the expected answer 'John Smith'?",
  //   // screenshot: false,
  //   screenshot: false,
  //   answer: "Johnny Smith",
  // });
  // console.log(result);
}

(async () => {
  await example();
})();
