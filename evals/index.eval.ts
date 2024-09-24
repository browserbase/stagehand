import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";
import process from 'process';

const vanta = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", headless: process.env.HEADLESS !== 'false' });
  await stagehand.init();

  await stagehand.page.goto("https://www.vanta.com/");
  await stagehand.waitForSettledDom();

  const observation = await stagehand.observe("find the request demo button");

  if (!observation) return false;

  const observationResult = await stagehand.page
    .locator(stagehand.observations[observation].result)
    .first()
    .innerHTML();

  const expectedLocator = `body > div.page-wrapper > div.nav_component > div.nav_element.w-nav > div.padding-global > div > div > nav > div.nav_cta-wrapper.is-new > a.nav_cta-button-desktop.is-smaller.w-button`;

  const expectedResult = await stagehand.page
    .locator(expectedLocator)
    .first()
    .innerHTML();

  await stagehand.context.close();

  return observationResult == expectedResult;
};



const vanta_h = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", headless: process.env.HEADLESS !== 'false'});
  await stagehand.init();

  await stagehand.page.goto("https://www.vanta.com/");
  await stagehand.waitForSettledDom();

  const observation = await stagehand.observe("find the buy now button");

  await stagehand.context.close();

  // we should have no saved observation since the element shouldn't exist
  return observation === null;
};

const peeler_simple = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", headless: process.env.HEADLESS !== 'false'});
  await stagehand.init();

  await stagehand.page.goto(`file://${process.cwd()}/evals/assets/peeler.html`);
  await stagehand.waitForSettledDom();

  await stagehand.act({ action: "add the peeler to cart" });

  const successMessageLocator = stagehand.page.locator(
    'text="Congratulations, you have 1 A in your cart"',
  );
  const isVisible = await successMessageLocator.isVisible();

  await stagehand.context.close();
  return isVisible;
};

const peeler_complex = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    headless: process.env.HEADLESS !== 'false',
  });
  await stagehand.init();

  await stagehand.page.goto(`https://chefstoys.com/`);

  await stagehand.act({
    action: "search for peelers",
  });

  await stagehand.act({
    action: 'click on the first "OXO" brand peeler',
  });

  const { price } = await stagehand.extract({
    instruction: "get the price of the peeler",
    schema: z.object({ price: z.number().nullable() }),
    modelName: "gpt-4o-2024-08-06",
  });

  await stagehand.context.close();

  return price !== null;
};

const wikipedia = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    headless: process.env.HEADLESS !== 'false',
  });
  await stagehand.init();

  await stagehand.page.goto(`https://en.wikipedia.org/wiki/Baseball`);
  await stagehand.act({
    action: 'click the "hit and run" link in this article',
  });

  const url = "https://en.wikipedia.org/wiki/Hit_and_run_(baseball)";
  const currentUrl = await stagehand.page.url();
  await stagehand.context.close();

  return currentUrl === url;
};


const costar = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 2, debugDom: true, headless: process.env.HEADLESS !== 'false' });
  await stagehand.init();

  await stagehand.page.goto("https://www.costar.com/");
  await stagehand.waitForSettledDom();

  await stagehand.act({ action: "click on the first article" });

  await stagehand.act({ action: "find the footer of the page" });

  await stagehand.waitForSettledDom();
  const articleTitle = await stagehand.extract({
      instruction: "extract the title of the article",
      schema: z.object({
      title: z.string().describe("the title of the article").nullable(),
      }),
      modelName: "gpt-4o-2024-08-06"
  });

  console.log("articleTitle", articleTitle);

  // Check if the title is more than 5 characters
  const isTitleValid = articleTitle.title !== null && articleTitle.title.length > 5;

  await stagehand.context.close();

  return isTitleValid;
};


const google_jobs = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 2, debugDom: true, headless: process.env.HEADLESS !== 'false' });
  await stagehand.init({ modelName: "gpt-4o-2024-08-06" });

  await stagehand.page.goto("https://www.google.com/");
  await stagehand.waitForSettledDom();

  await stagehand.act({ action: "click on the about page" });

  await stagehand.act({ action: "click on the careers page" });

  await stagehand.act({ action: "input data scientist into role" });

  await stagehand.act({ action: "input new york city into location" });

  await stagehand.act({ action: "click on the search button" });

  await stagehand.act({ action: "click on the learn more button for the first job" });

  const jobDetails = await stagehand.extract({
    instruction: "Extract the following details from the job posting: application deadline, minimum qualifications (degree and years of experience), and preferred qualifications (degree and years of experience)",
    schema: z.object({
      applicationDeadline: z.string().describe("The date until which the application window will be open"),
      minimumQualifications: z.object({
        degree: z.string().describe("The minimum required degree"),
        yearsOfExperience: z.number().describe("The minimum required years of experience")
      }),
      preferredQualifications: z.object({
        degree: z.string().describe("The preferred degree"),
        yearsOfExperience: z.number().describe("The preferred years of experience")
      })
    }),
    modelName: "gpt-4o-2024-08-06"
  });

  console.log("Job Details:", jobDetails);

  const isJobDetailsValid = jobDetails && 
  Object.values(jobDetails).every(value => 
    value !== null && 
    value !== undefined && 
    value !== '' &&
    (typeof value !== 'object' || Object.values(value).every(v => 
      v !== null && 
      v !== undefined && 
      v !== '' && 
      (typeof v === 'number' || typeof v === 'string')
    ))
  );

  await stagehand.context.close();

  console.log("Job Details valid:", isJobDetailsValid);

  return isJobDetailsValid;
};

const tasks = { vanta, vanta_h, peeler_simple, peeler_complex, wikipedia, costar, google_jobs};

const exactMatch = (args: { input; output; expected? }) => {
  console.log(`Task "${args.input.name}" returned: ${args.output}`);

  return {
    name: "Exact match",
    score: Boolean(args.output) ? 1 : 0,
  };
};


Eval("stagehand", {
  data: () => {
    return [
      { input: { name: "vanta" } },
      { input: { name: "vanta_h" } },
      { input: { name: "peeler_simple" } },
      { input: { name: "wikipedia" } },
      { input: { name: "peeler_complex" } },
      // { input: { name: "costar" } },
      { input: { name: "google_jobs" } }
    ];
  },
  task: async (input) => {
    try {
      const result = await tasks[input.name](input);
      if (result) {
        console.log(`✅ ${input.name}: Passed`);
      } else {
        console.log(`❌ ${input.name}: Failed`);
      }
      return result;
    } catch (error) {
      console.error(`❌ ${input.name}: Error - ${error}`);
      return false;
    }
  },
  scores: [exactMatch],
});
