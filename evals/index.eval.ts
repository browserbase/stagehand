import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";
import { evaluateExample, chosenBananalyzerEvals } from "./bananalyzer-ts";
import { createExpressServer } from "./bananalyzer-ts/server/expressServer";
import process from "process";

const env =
  process.env.EVAL_ENV?.toLowerCase() === "browserbase"
    ? "BROWSERBASE"
    : "LOCAL";

const vanta = async () => {
  const stagehand = new Stagehand({
    env,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  await stagehand.page.goto("https://www.vanta.com/");
  await stagehand.waitForSettledDom();

  const observation = await stagehand.observe("find the request demo button");

  if (!observation) {
    await stagehand.context.close();
    return {
      _success: false,
      observation,
    };
  }

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

  return {
    _success: observationResult == expectedResult,
    expected: expectedResult,
    actual: observationResult,
  };
};

const vanta_h = async () => {
  const stagehand = new Stagehand({
    env,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  await stagehand.page.goto("https://www.vanta.com/");
  await stagehand.waitForSettledDom();

  const observation = await stagehand.observe("find the buy now button");

  await stagehand.context.close();

  // we should have no saved observation since the element shouldn't exist
  return {
    _success: observation === null,
    observation,
  };
};

const simple_google_search = async () => {
  const stagehand = new Stagehand({
    env,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  await stagehand.page.goto("https://www.google.com");

  await stagehand.act({
    action: 'Search for "OpenAI"',
  });

  const expectedUrl = "https://www.google.com/search?q=OpenAI";
  const currentUrl = await stagehand.page.url();

  await stagehand.context.close();

  return {
    _success: currentUrl.startsWith(expectedUrl),
    currentUrl,
  };
};

const peeler_simple = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  await stagehand.page.goto(`file://${process.cwd()}/evals/assets/peeler.html`);
  await stagehand.waitForSettledDom();

  await stagehand.act({ action: "add the peeler to cart" });

  const successMessageLocator = stagehand.page.locator(
    'text="Congratulations, you have 1 A in your cart"',
  );
  const isVisible = await successMessageLocator.isVisible();

  await stagehand.context.close();
  return {
    _success: isVisible,
  };
};

const peeler_complex = async () => {
  const stagehand = new Stagehand({
    env,
    verbose: 1,
    headless: process.env.HEADLESS !== "false",
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

  return {
    _success: price !== null,
    price,
  };
};

const homedepot = async () => {
  const stagehand = new Stagehand({
    env,
    verbose: 1,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  try {
    await stagehand.page.goto("https://www.homedepot.com/");
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "search for gas grills" });
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "click on the best selling gas grill" });
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "click on the Product Details" });
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "find the Primary Burner BTU" });
    await stagehand.waitForSettledDom();

    const productSpecs = await stagehand.extract({
      instruction: "Extract the Primary exact Burner BTU of the product",
      schema: z.object({
        productSpecs: z
          .array(
            z.object({
              burnerBTU: z.string().describe("Primary Burner BTU exact value"),
            }),
          )
          .describe("Gas grill Primary Burner BTU exact value"),
      }),
      modelName: "gpt-4o-2024-08-06",
    });
    console.log("The gas grill primary burner BTU is:", productSpecs);

    if (
      !productSpecs ||
      !productSpecs.productSpecs ||
      productSpecs.productSpecs.length !== 1
    ) {
      return {
        _success: false,
        productSpecs,
      };
    }

    if (
      (productSpecs.productSpecs[0].burnerBTU.match(/0/g) || []).length == 4 &&
      (productSpecs.productSpecs[0].burnerBTU.match(/4/g) || []).length === 1
    ) {
      return {
        _success: true,
        productSpecs,
      };
    } else {
      return {
        _success: false,
        productSpecs,
      };
    }
  } catch (error) {
    console.error(`Error in homedepot function: ${error.message}`);
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
    };
  } finally {
    await stagehand.context.close();
  }
};

const extract_collaborators_from_github_repository = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  try {
    await stagehand.page.goto("https://github.com/facebook/react");
    await stagehand.act({
      action: "find the contributors section",
    });

    await stagehand.waitForSettledDom();

    const { contributors } = await stagehand.extract({
      instruction: "Extract top 20 contributors of this repository",
      schema: z.object({
        contributors: z.array(
          z.object({
            github_username: z.string(),
            information: z.string(),
          }),
        ),
      }),
      modelName: "gpt-4o-2024-08-06",
    });

    console.log("Extracted collaborators:", contributors);
    await stagehand.context.close();
    return {
      _success: contributors.length === 20,
      contributors,
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);
    await stagehand.context.close();
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
    };
  }
};

const extract_last_twenty_github_commits = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  try {
    await stagehand.page.goto("https://github.com/facebook/react");

    await stagehand.waitForSettledDom();

    const { commits } = await stagehand.extract({
      instruction: "Extract last 20 commits",
      schema: z.object({
        commits: z.array(
          z.object({
            commit_message: z.string(),
            commit_url: z.string(),
            commit_hash: z.string(),
          }),
        ),
      }),
      modelName: "gpt-4o-2024-08-06",
    });

    console.log("Extracted commits:", commits);
    await stagehand.context.close();
    return {
      _success: commits.length === 20,
      commits,
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);
    await stagehand.context.close();
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
    };
  }
};

const wikipedia = async () => {
  const stagehand = new Stagehand({
    env,
    verbose: 2,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  await stagehand.page.goto(`https://en.wikipedia.org/wiki/Baseball`);
  await stagehand.act({
    action: 'click the "hit and run" link in this article',
  });

  const url = "https://en.wikipedia.org/wiki/Hit_and_run_(baseball)";
  const currentUrl = await stagehand.page.url();
  await stagehand.context.close();

  return {
    _success: currentUrl === url,
    expected: url,
    actual: currentUrl,
  };
};

// Validate that the action is not found on the page
const nonsense_action = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
    headless: true,
  });
  await stagehand.init();

  try {
    await stagehand.page.goto("https://www.homedepot.com/");
    await stagehand.waitForSettledDom();

    const result = await stagehand.act({ action: "click on the first banana" });
    console.log("result", result);

    // Assert the output
    const expectedResult = {
      success: false,
      message:
        "Action not found on the current page after checking all chunks.",
      action: "click on the first banana",
    };

    const isResultCorrect =
      JSON.stringify(result) === JSON.stringify(expectedResult);

    return isResultCorrect;
  } catch (error) {
    console.error(`Error in nonsense_action function: ${error.message}`);
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
    };
  } finally {
    await stagehand.context.close();
  }
};

const costar = async () => {
  const stagehand = new Stagehand({
    env,
    verbose: 2,
    debugDom: true,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();
  // TODO: fix this eval - does not work in headless mode
  try {
    await Promise.race([
      stagehand.page.goto("https://www.costar.com/"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Navigation timeout")), 30000),
      ),
    ]);
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "click on the first article" });

    await stagehand.act({
      action: "click on the learn more button for the first job",
    });

    await stagehand.waitForSettledDom();
    const articleTitle = await stagehand.extract({
      instruction: "extract the title of the article",
      schema: z.object({
        title: z.string().describe("the title of the article").nullable(),
      }),
      modelName: "gpt-4o-2024-08-06",
    });

    console.log("articleTitle", articleTitle);

    // Check if the title is more than 5 characters
    const isTitleValid =
      articleTitle.title !== null && articleTitle.title.length > 5;

    await stagehand.context.close();

    return { title: articleTitle.title, _success: isTitleValid };
  } catch (error) {
    console.error(`Error in costar function: ${error.message}`);
    return { title: null, _success: false } as any;
  } finally {
    await stagehand.context.close();
  }
};

const google_jobs = async () => {
  const stagehand = new Stagehand({
    env,
    verbose: 2,
    debugDom: true,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init({ modelName: "gpt-4o-2024-08-06" });

  await stagehand.page.goto("https://www.google.com/");
  await stagehand.waitForSettledDom();

  await stagehand.act({ action: "click on the about page" });

  await stagehand.act({ action: "click on the careers page" });

  await stagehand.act({ action: "input data scientist into role" });

  await stagehand.act({ action: "input new york city into location" });

  await stagehand.act({ action: "click on the search button" });

  // NOTE: "click on the first Learn More button" is not working - the span for learn more is not clickable and the a href is after it
  await stagehand.act({ action: "click on the first job link" });

  const jobDetails = await stagehand.extract({
    instruction:
      "Extract the following details from the job posting: application deadline, minimum qualifications (degree and years of experience), and preferred qualifications (degree and years of experience)",
    schema: z.object({
      applicationDeadline: z
        .string()
        .describe("The date until which the application window will be open"),
      minimumQualifications: z.object({
        degree: z.string().describe("The minimum required degree"),
        yearsOfExperience: z
          .number()
          .describe("The minimum required years of experience"),
      }),
      preferredQualifications: z.object({
        degree: z.string().describe("The preferred degree"),
        yearsOfExperience: z
          .number()
          .describe("The preferred years of experience"),
      }),
    }),
    modelName: "gpt-4o-2024-08-06",
  });

  console.log("Job Details:", jobDetails);

  const isJobDetailsValid =
    jobDetails &&
    Object.values(jobDetails).every(
      (value) =>
        value !== null &&
        value !== undefined &&
        (typeof value !== "object" ||
          Object.values(value).every(
            (v) =>
              v !== null &&
              v !== undefined &&
              (typeof v === "number" || typeof v === "string"),
          )),
    );

  await stagehand.context.close();

  console.log("Job Details valid:", isJobDetailsValid);

  return { _success: isJobDetailsValid, jobDetails };
};

const arxiv = async () => {
  const stagehand = new Stagehand({
    env,
    verbose: 2,
    debugDom: true,
    headless: process.env.HEADLESS !== "false",
  });

  await stagehand.init({ modelName: "gpt-4o-2024-08-06" });

  interface Paper {
    title: string;
    link: string | null;
    category: string | null;
    problem: string | null;
    methodology: string | null;
    results: string | null;
    conclusion: string | null;
    code: string | null;
  }

  const papers: Paper[] = [];

  try {
    await stagehand.page.goto("https://arxiv.org/search/");
    await stagehand.waitForSettledDom();

    await stagehand.act({
      action:
        "search for the recent papers about web agents with multimodal models",
    });
    await stagehand.waitForSettledDom();

    const paper_links = await stagehand.extract({
      instruction:
        "extract the title and link of at most five papers, keeping track of number of papers extracted and marking completed when five are extracted",
      schema: z.object({
        papers: z
          .array(
            z.object({
              title: z.string().describe("the title of the paper"),
              link: z.string().describe("the link to the paper").nullable(),
            }),
          )
          .describe("list of papers"),
      }),
      modelName: "gpt-4o-2024-08-06",
    });

    if (
      !paper_links ||
      !paper_links.papers ||
      paper_links.papers.length === 0
    ) {
      return { _success: false };
    }

    for (const paper of paper_links.papers) {
      if (paper.link) {
        await stagehand.page.goto(paper.link);
        const abstract = await stagehand.extract({
          instruction: "extract details of the paper from the abstract",
          schema: z.object({
            values: z.array(
              z.object({
                category: z
                  .string()
                  .describe(
                    "the category of the paper. one of {'Benchmark', 'Dataset', 'Model', 'Strategy', 'System', 'Other'}",
                  ),
                problem: z
                  .string()
                  .describe(
                    "summarize the problem that the paper is trying to solve in one sentence",
                  )
                  .nullable(),
                methodology: z
                  .string()
                  .describe(
                    "summarize the methodology of the paper in one sentence",
                  )
                  .nullable(),
                results: z
                  .string()
                  .describe(
                    "summarize the results of the paper in one sentence",
                  )
                  .nullable(),
                conclusion: z
                  .string()
                  .describe(
                    "summarize the conclusion of the paper in one sentence",
                  )
                  .nullable(),
                code: z
                  .string()
                  .describe(
                    "if provided, extract only the link to the code repository, without additional text",
                  )
                  .nullable(),
              }),
            ),
          }),
          modelName: "gpt-4o-2024-08-06",
        });

        const first_chunk = abstract.values[0];

        papers.push({
          title: paper.title,
          link: paper.link,
          category: first_chunk.category,
          problem: first_chunk.problem,
          methodology: first_chunk.methodology,
          results: first_chunk.results,
          conclusion: first_chunk.conclusion,
          code: first_chunk.code,
        });
      }
    }

    if (!papers || papers.length === 0) {
      return { _success: false };
    }

    console.log(papers);
    return { _success: true, papers };
  } catch (error) {
    console.error(`Error in arxiv function: ${error.message}`);
    return { _success: false };
  } finally {
    await stagehand.context.close();
  }
};

const expedia = async () => {
  const stagehand = new Stagehand({
    // env: "BROWSERBASE",
    env: "LOCAL",
    headless: false,
    debugDom: true,
  });

  await stagehand.init();

  await stagehand.page.goto("https://www.expedia.com");
  await stagehand.waitForSettledDom();

  await stagehand.act({
    action:
      "find round-trip flights from San Francisco (SFO) to Toronto (YYZ) for Jan 1, 2024 (up to one to two weeks)",
    useVision: true,
    modelName: "claude-3-5-sonnet-20240620",
  });

  await stagehand.context.close();
  console.log("Found flights");

  // Wait for the page to settle after flight search
  await stagehand.waitForSettledDom();

  // Get the current URL
  const finalUrl = await stagehand.page.url();
  console.log("Final URL:", finalUrl);

  // Check if the URL matches the expected format
  const isUrlValid = (url: string) => {
    const urlObj = new URL(url);
    const searchParams = urlObj.searchParams;

    // Check for correct airports
    const hasCorrectAirports =
      url.includes("SFO-San%20Francisco") &&
      url.includes("YYZ-Pearson") &&
      url.includes("Toronto,%20ON,%20Canada") &&
      url.includes("San%20Francisco,%20CA,%20United%20States");

    // Check for correct dates
    const fromDate = searchParams.get("fromDate");
    const toDate = searchParams.get("toDate");
    const isFromDateValid = fromDate === "1/1/2025";
    const isToDateValid =
      toDate &&
      new Date(toDate) >= new Date("2025-01-06") &&
      new Date(toDate) <= new Date("2025-01-15");

    return hasCorrectAirports && isFromDateValid && isToDateValid;
  };

  const urlValid = isUrlValid(finalUrl);
  console.log("URL is valid:", urlValid);

  return { _success: urlValid, finalUrl };
};

const tasks = {
  vanta,
  vanta_h,
  peeler_simple,
  peeler_complex,
  wikipedia,
  simple_google_search,
  extract_collaborators_from_github_repository,
  extract_last_twenty_github_commits,
  costar,
  google_jobs,
  homedepot,
  arxiv,
  expedia,
};

const exactMatch = (args: { input: any; output: any; expected?: any }) => {
  console.log(`Task "${args.input.name}" returned: ${args.output}`);

  const expected = args.expected ?? true;
  if (expected === true) {
    return {
      name: "Exact match",
      score: args.output === true || args.output?._success == true,
    };
  }

  return {
    name: "Exact match",
    score: args.output === expected,
  };
};

const testcases = [
  {
    input: {
      name: "vanta",
    },
  },
  {
    input: {
      name: "vanta_h",
    },
  },
  {
    input: {
      name: "peeler_simple",
    },
  },
  {
    input: { name: "wikipedia" },
  },
  { input: { name: "peeler_complex" } },
  { input: { name: "simple_google_search" } },
  {
    input: {
      name: "extract_collaborators_from_github_repository",
    },
  },
  { input: { name: "extract_last_twenty_github_commits" } },
  // { input: { name: "costar", expected: true } },
  { input: { name: "google_jobs" } },
  { input: { name: "homedepot" } },
  { input: { name: "arxiv" } },
  ...chosenBananalyzerEvals.map((evalItem: any) => ({
    input: {
      name: evalItem.name,
      id: evalItem.id,
      source: "bananalyzer-ts",
    },
  })),
];

let finishedEvals = 0;
let bananalyzerFileServer: any;
const port = 6779;

Eval("stagehand", {
  data: () => {
    return testcases;
  },
  task: async (input: any) => {
    // console.log("input", input);
    try {
      if ("source" in input && input.source === "bananalyzer-ts") {
        if (!bananalyzerFileServer) {
          const app = createExpressServer();
          bananalyzerFileServer = app.listen(port, () => {
            console.log(`Bananalyzer server listening on port ${port}`);
          });
        }
        // Handle chosen evaluations

        const result = await evaluateExample(input.id, {
          launchServer: false,
          serverPort: 6779,
        });
        if (result) {
          console.log(`✅ ${input.name}: Passed`);
        } else {
          console.log(`❌ ${input.name}: Failed`);
        }
        return result;
      } else {
        // Handle predefined tasks
        const result = await (tasks as any)[input.name](input);
        if (result) {
          console.log(`✅ ${input.name}: Passed`);
        } else {
          console.log(`❌ ${input.name}: Failed`);
        }
        return result;
      }
    } catch (error) {
      console.error(`❌ ${input.name}: Error - ${error}`);
      return {
        _success: false,
        error: JSON.parse(JSON.stringify(error, null, 2)),
      };
    } finally {
      finishedEvals++;
      if (finishedEvals === testcases.length) {
        bananalyzerFileServer?.close();
      }
    }
  },
  scores: [exactMatch],
  // trialCount: 3,
});
