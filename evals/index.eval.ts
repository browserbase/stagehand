import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";
import process from "process";
import { EvalLogger } from "./utils";
import { AvailableModel } from "../types/model";
import { LogLine } from "../types/log";
import fs from "fs";

const env: "BROWSERBASE" | "LOCAL" =
  process.env.EVAL_ENV?.toLowerCase() === "browserbase"
    ? "BROWSERBASE"
    : "LOCAL";

const enableCaching = process.env.EVAL_ENABLE_CACHING?.toLowerCase() === "true";
const models: AvailableModel[] = ["gpt-4o", "claude-3-5-sonnet-20241022"];

const defaultStagehandOptions = {
  env,
  headless: false,
  verbose: 2 as const,
  debugDom: true,
  enableCaching,
};

const initStagehand = async ({
  modelName,
  domSettleTimeoutMs,
  logger,
}: {
  modelName: AvailableModel;
  domSettleTimeoutMs?: number;
  logger: EvalLogger;
}) => {
  const stagehand = new Stagehand({
    ...defaultStagehandOptions,
    logger: (logLine: LogLine) => {
      logger.log(logLine);
    },
  });
  logger.init(stagehand);
  const initResponse = await stagehand.init({ modelName, domSettleTimeoutMs });
  return { stagehand, logger, initResponse };
};

type EvalFunction = (args: {
  modelName: AvailableModel;
  logger: EvalLogger;
}) => Promise<{
  _success: boolean;
  logs: LogLine[];
  debugUrl: string;
  sessionUrl: string;
  error?: unknown;
}>;

const expedia: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://www.expedia.com/flights");

    await stagehand.act({
      action:
        "find round-trip flights from San Francisco (SFO) to Toronto (YYZ) for Jan 1, 2025 (up to one to two weeks)",
    });

    await stagehand.act({ action: "Go to the first non-stop flight" });

    await stagehand.act({ action: "select the cheapest flight" });

    await stagehand.act({ action: "click on the first non-stop flight" });

    await stagehand.act({
      action: "Take me to the checkout page",
    });

    const url = stagehand.page.url();
    return {
      _success: url.startsWith("https://www.expedia.com/Checkout/"),
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error({
      message: `error in expedia function`,
      level: 0,
      auxiliary: {
        error: {
          value: JSON.stringify(error, null, 2),
          type: "object",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close().catch(() => {});
  }
};
const vanta: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.vanta.com/");

  const observations = await stagehand.observe();

  if (observations.length === 0) {
    await stagehand.context.close();
    return {
      _success: false,
      observations,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }

  const expectedLocator = `body > div.page-wrapper > div.nav_component > div.nav_element.w-nav > div.padding-global > div > div > nav > div.nav_cta-wrapper.is-new > a.nav_cta-button-desktop.is-smaller.w-button`;

  const expectedResult = await stagehand.page
    .locator(expectedLocator)
    .first()
    .innerHTML();

  let foundMatch = false;
  for (const observation of observations) {
    try {
      const observationResult = await stagehand.page
        .locator(observation.selector)
        .first()
        .innerHTML();

      if (observationResult === expectedResult) {
        foundMatch = true;
        break;
      }
    } catch (error) {
      console.warn(
        `Failed to check observation with selector ${observation.selector}:`,
        error.message,
      );
      continue;
    }
  }

  await stagehand.context.close();

  return {
    _success: foundMatch,
    expected: expectedResult,
    observations,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};

const vanta_h: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.vanta.com/");

  const observations = await stagehand.observe({
    instruction: "find the buy now button",
  });

  await stagehand.context.close();

  // we should have no saved observation since the element shouldn't exist
  return {
    _success: observations.length === 0,
    observations,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};

const simple_google_search: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.google.com");

  await stagehand.act({
    action: 'Search for "OpenAI"',
  });

  const expectedUrl = "https://www.google.com/search?q=OpenAI";
  const currentUrl = stagehand.page.url();

  await stagehand.context.close();

  return {
    _success: currentUrl.startsWith(expectedUrl),
    currentUrl,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};

const peeler_simple: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  if (env === "BROWSERBASE") {
    throw new Error(
      "Browserbase not supported for this eval since we block all requests to file://",
    );
  }

  await stagehand.page.goto(`file://${process.cwd()}/evals/assets/peeler.html`);

  await stagehand.act({ action: "add the peeler to cart" });

  const successMessageLocator = stagehand.page.locator(
    'text="Congratulations, you have 1 A in your cart"',
  );
  const isVisible = await successMessageLocator.isVisible();

  await stagehand.context.close();
  return {
    _success: isVisible,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};

const peeler_complex: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto(`https://chefstoys.com/`, { timeout: 60000 });

    await stagehand.act({
      action: "search for %search_query%",
      variables: {
        search_query: "peeler",
      },
    });

    await stagehand.act({
      action: 'click on the first "OXO" brand peeler',
    });

    const { price } = await stagehand.extract({
      instruction: "get the price of the peeler",
      schema: z.object({ price: z.number().nullable() }),
      modelName: "gpt-4o-2024-08-06",
    });

    return {
      _success: price === 11.99,
      price,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "error in peeler_complex function",
      level: 0,
      auxiliary: {
        error: {
          value: JSON.stringify(error, null, 2),
          type: "object",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close();
  }
};

const homedepot: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 60_000,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://www.homedepot.com/");

    await stagehand.act({ action: "search for gas grills" });

    await stagehand.act({ action: "click on the best selling gas grill" });

    await stagehand.act({ action: "click on the Product Details" });

    await stagehand.act({ action: "find the Primary Burner BTU" });

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
    logger.log({
      message: `gas grill primary burner BTU`,
      level: 1,
      auxiliary: {
        productSpecs: {
          value: JSON.stringify(productSpecs),
          type: "object",
        },
      },
    });

    if (
      !productSpecs ||
      !productSpecs.productSpecs ||
      productSpecs.productSpecs.length !== 1
    ) {
      return {
        _success: false,
        productSpecs,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    if (
      (productSpecs.productSpecs[0].burnerBTU.match(/0/g) || []).length == 4 &&
      (productSpecs.productSpecs[0].burnerBTU.match(/4/g) || []).length === 1
    ) {
      return {
        _success: true,
        productSpecs,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } else {
      return {
        _success: false,
        productSpecs,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  } catch (error) {
    logger.error({
      message: "error in homedepot function",
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close().catch(() => {});
  }
};

const extract_github_stars: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://github.com/facebook/react");

    const { stars } = await stagehand.extract({
      instruction: "Extract the number of stars for the project",
      schema: z.object({
        stars: z.number().describe("the number of stars for the project"),
      }),
      modelName,
    });

    const expectedStarsString = await stagehand.page
      .locator("#repo-stars-counter-star")
      .first()
      .innerHTML();

    const expectedStars = expectedStarsString.toLowerCase().endsWith("k")
      ? parseFloat(expectedStarsString.slice(0, -1)) * 1000
      : parseFloat(expectedStarsString);

    const tolerance = 1000;

    const isWithinTolerance = Math.abs(stars - expectedStars) <= tolerance;

    await stagehand.context.close().catch(() => {});
    return {
      _success: isWithinTolerance,
      stars,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);
    await stagehand.context.close().catch(() => {});
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};

const extract_collaborators_from_github_repository: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://github.com/facebook/react");
    await stagehand.act({
      action: "find the contributors section",
    });

    const { contributors } = await stagehand.extract({
      instruction: "Extract top 20 contributors of this repository",
      schema: z.object({
        contributors: z.array(
          z.object({
            github_username: z
              .string()
              .describe("the github username of the contributor"),
            information: z.string().describe("number of commits contributed"),
          }),
        ),
      }),
      modelName,
    });

    console.log("Extracted collaborators:", contributors);
    await stagehand.context.close().catch(() => {});
    return {
      _success: contributors.length === 20,
      contributors,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);
    await stagehand.context.close().catch(() => {});
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};

const extract_last_twenty_github_commits: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://github.com/facebook/react");

    await stagehand.act({
      action:
        "find commit history, generally described by the number of commits",
    });
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
      modelName,
    });

    logger.log({
      message: "Extracted commits",
      level: 1,
      auxiliary: {
        commits: {
          value: JSON.stringify(commits),
          type: "object",
        },
      },
    });
    await stagehand.context.close().catch(() => {});
    return {
      _success: commits.length === 20,
      commits,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);
    await stagehand.context.close().catch(() => {});
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};

const wikipedia: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto(`https://en.wikipedia.org/wiki/Baseball`);
  await stagehand.act({
    action: 'click the "hit and run" link in this article',
  });

  const url = "https://en.wikipedia.org/wiki/Hit_and_run_(baseball)";
  const currentUrl = stagehand.page.url();
  await stagehand.context.close().catch(() => {});

  return {
    _success: currentUrl === url,
    expected: url,
    actual: currentUrl,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};

// Validate that the action is not found on the page
const nonsense_action: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://www.homedepot.com/");

    const result = await stagehand.act({
      action: "click on the first banana",
    });
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

    return {
      _success: isResultCorrect,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error(`Error in nonsense_action function: ${error.message}`);
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close();
  }
};

const costar: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;
  // TODO: fix this eval - does not work in headless mode
  try {
    await Promise.race([
      stagehand.page.goto("https://www.costar.com/"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Navigation timeout")), 30000),
      ),
    ]);

    await stagehand.act({ action: "click on the first article" });

    await stagehand.act({
      action: "click on the learn more button for the first job",
    });

    const articleTitle = await stagehand.extract({
      instruction: "extract the title of the article",
      schema: z.object({
        title: z.string().describe("the title of the article").nullable(),
      }),
      modelName: "gpt-4o-2024-08-06",
    });

    logger.log({
      message: "got article title",
      level: 1,
      auxiliary: {
        articleTitle: {
          value: JSON.stringify(articleTitle),
          type: "object",
        },
      },
    });

    // Check if the title is more than 5 characters
    const isTitleValid =
      articleTitle.title !== null && articleTitle.title.length > 5;

    await stagehand.context.close();

    return {
      title: articleTitle.title,
      _success: isTitleValid,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "error in costar function",
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      title: null,
      _success: false,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close();
  }
};

const google_jobs: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://www.google.com/");

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
          .describe("The date until which the application window will be open")
          .nullable(),
        minimumQualifications: z.object({
          degree: z.string().describe("The minimum required degree").nullable(),
          yearsOfExperience: z
            .number()
            .describe("The minimum required years of experience")
            .nullable(),
        }),
        preferredQualifications: z.object({
          degree: z.string().describe("The preferred degree").nullable(),
          yearsOfExperience: z
            .number()
            .describe("The preferred years of experience")
            .nullable(),
        }),
      }),
      modelName: "gpt-4o-2024-08-06",
    });

    logger.log({
      message: "got job details",
      level: 1,
      auxiliary: {
        jobDetails: {
          value: JSON.stringify(jobDetails),
          type: "object",
        },
      },
    });

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

    logger.log({
      message: "job details valid",
      level: 1,
      auxiliary: {
        isJobDetailsValid: {
          value: isJobDetailsValid.toString(),
          type: "boolean",
        },
      },
    });

    return {
      _success: isJobDetailsValid,
      jobDetails,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "error in google_jobs function",
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      debugUrl,
      sessionUrl,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close();
  }
};

const extract_partners: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://ramp.com");

    await stagehand.act({
      action: "Close the popup.",
    });

    await stagehand.act({
      action: "Scroll down to the bottom of the page.",
    });

    await stagehand.act({
      action:
        "Click on the link or button that leads to the partners page. If it's in a dropdown or hidden section, first interact with the element to reveal it, then click the link.",
    });

    const partners = await stagehand.extract({
      instruction: `
      Extract the names of all partner companies mentioned on this page.
      These could be inside text, links, or images representing partner companies.
      If no specific partner names are found, look for any sections or categories of partners mentioned.
      Also, check for any text that explains why partner names might not be listed, if applicable.
    `,
      schema: z.object({
        partners: z.array(
          z.object({
            name: z
              .string()
              .describe(
                "The name of the partner company or category of partners",
              ),
          }),
        ),
        explanation: z
          .string()
          .optional()
          .describe("Any explanation about partner listing or absence thereof"),
      }),
    });

    logger.log({
      message: "got partners",
      level: 1,
      auxiliary: {
        partners: {
          value: JSON.stringify(partners),
          type: "object",
        },
      },
    });

    const expectedPartners = [
      "Accounting Partners",
      "Private Equity & Venture Capital Partners",
      "Services Partners",
      "Affiliates",
    ];

    if (partners.explanation) {
      logger.log({
        message: "got explanation",
        level: 1,
        auxiliary: {
          explanation: {
            value: partners.explanation,
            type: "string",
          },
        },
      });
    }

    const foundPartners = partners.partners.map((partner) =>
      partner.name.toLowerCase(),
    );

    const allExpectedPartnersFound = expectedPartners.every((partner) =>
      foundPartners.includes(partner.toLowerCase()),
    );

    logger.log({
      message: "all expected partners found",
      level: 1,
      auxiliary: {
        allExpectedPartnersFound: {
          value: allExpectedPartnersFound.toString(),
          type: "boolean",
        },
        expectedPartners: {
          value: JSON.stringify(expectedPartners),
          type: "object",
        },
        foundPartners: {
          value: JSON.stringify(foundPartners),
          type: "object",
        },
      },
    });

    return {
      _success: allExpectedPartnersFound,
      partners,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "error in extractPartners function",
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      debugUrl,
      sessionUrl,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close().catch(() => {});
  }
};

const laroche_form: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto(
      "https://www.laroche-posay.us/offers/anthelios-melt-in-milk-sunscreen-sample.html",
    );

    await stagehand.act({ action: "close the privacy policy popup" });

    // Wait for possible navigation
    await stagehand.page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 })
      .catch(() => {});

    await stagehand.act({ action: "fill the last name field" });
    await stagehand.act({ action: "fill address 1 field" });
    await stagehand.act({ action: "select a state" });
    await stagehand.act({ action: "select a skin type" });

    // TODO - finish this eval once we have a way to extract form data from children iframes

    // const formData = await stagehand.extract({
    //   instruction: "Extract the filled form data",
    //   schema: z.object({
    //     firstName: z.string(),
    //     lastName: z.string(),
    //     email: z.string(),
    //     phone: z.string(),
    //     zipCode: z.string(),
    //     interestedIn: z.string(),
    //     startTerm: z.string(),
    //     programOfInterest: z.string(),
    //   }),
    //   modelName: "gpt-4o",
    // });

    // console.log("Extracted form data:", formData);

    // const isFormDataValid =
    //   formData.firstName === "John" &&
    //   formData.lastName === "Doe" &&
    //   formData.email === "john.doe@example.com" &&
    //   formData.phone === "1234567890" &&
    //   formData.zipCode === "12345" &&
    return {
      _success: true,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error({
      message: "error in LarocheForm function",
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: error.message,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close().catch(() => {});
  }
};

const arxiv: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

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

    await stagehand.act({
      action:
        "search for the recent papers about web agents with multimodal models",
    });

    const paper_links = await stagehand.extract({
      instruction: "extract the titles and links for two papers",
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
      return {
        _success: false,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    for (const paper of paper_links.papers) {
      if (paper.link) {
        await stagehand.page.goto(paper.link);
        const abstract = await stagehand.extract({
          instruction: "extract details of the paper from the abstract",
          schema: z.object({
            category: z
              .string()
              .describe(
                "the category of the paper. one of {'Benchmark', 'Dataset', 'Model', 'Framework', 'System', 'Other'}",
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
              .describe("summarize the results of the paper in one sentence")
              .nullable(),
            conclusion: z
              .string()
              .describe("summarize the conclusion of the paper in one sentence")
              .nullable(),
            code: z
              .string()
              .describe(
                "if provided, extract only the link to the code repository, without additional text. this is often optional and not always provided.",
              )
              .nullable(),
          }),
          modelName: "gpt-4o-2024-08-06",
        });

        papers.push({
          title: paper.title,
          link: paper.link,
          category: abstract.category,
          problem: abstract.problem,
          methodology: abstract.methodology,
          results: abstract.results,
          conclusion: abstract.conclusion,
          code: abstract.code,
        });
      }
    }

    if (!papers || papers.length === 0) {
      return {
        _success: false,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    logger.log({
      message: "papers",
      level: 1,
      auxiliary: {
        papers: {
          value: JSON.stringify(papers),
          type: "object",
        },
      },
    });

    // Assert that the length of papers is three
    if (papers.length !== 2) {
      logger.error({
        message: "incorrect number of papers extracted",
        level: 0,
        auxiliary: {
          expected: {
            value: "2",
            type: "integer",
          },
          actual: {
            value: papers.length.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Incorrect number of papers extracted",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    // Ensure that every paper has a problem and methodology
    for (const paper of papers) {
      if (!paper.problem || !paper.methodology) {
        logger.error({
          message: `paper missing problem or methodology`,
          level: 0,
          auxiliary: {
            paper: {
              value: JSON.stringify(paper),
              type: "object",
            },
          },
        });
        return {
          _success: false,
          error: "Incomplete paper information",
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
        };
      }
    }

    return {
      _success: true,
      papers,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error({
      message: `error in arxiv function`,
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await stagehand.context.close().catch(() => {});
  }
};

const amazon_add_to_cart: EvalFunction = async ({ modelName, logger }) => {
  // Initialize Stagehand with credentials from env
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  // Navigate directly to the product page
  await stagehand.page.goto(
    "https://www.amazon.com/Laptop-MacBook-Surface-Water-Resistant-Accessories/dp/B0D5M4H5CD",
  );

  await stagehand.page.waitForTimeout(5000);

  // Add to cart
  await stagehand.act({
    action: "click the 'Add to Cart' button",
  });

  // Wait a moment for the cart to update
  await stagehand.page.waitForTimeout(2000);

  // Proceed to checkout
  await stagehand.act({
    action: "click the 'Proceed to checkout' button",
  });

  // Wait for page load and check URL
  await stagehand.page.waitForTimeout(2000);
  const currentUrl = stagehand.page.url();
  const expectedUrlPrefix = "https://www.amazon.com/ap/signin";

  await stagehand.context.close();

  return {
    _success: currentUrl.startsWith(expectedUrlPrefix),
    currentUrl,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};

const extract_press_releases: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 3000,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://www.landerfornyc.com/news");

    const result = await stagehand.extract({
      instruction:
        "extract a list of press releases on this page, with the title and publish date",
      schema: z.object({
        items: z.array(
          z.object({
            title: z.string(),
            publishedOn: z.string(),
          }),
        ),
      }),
    });

    const items = result.items;

    const expectedLength = 25;

    const expectedFirstItem = {
      title: "Is Brad Lander the Progressive to Beat Eric Adams?",
      publishedOn: "Jul 30, 2024",
    };

    const expectedLastItem = {
      title: "An Unassuming Liberal Makes a Rapid Ascent to Power Broker",
      publishedOn: "Jan 23, 2014",
    };

    if (items.length !== expectedLength) {
      logger.error({
        message: "Incorrect number of items extracted",
        level: 0,
        auxiliary: {
          expected: {
            value: expectedLength.toString(),
            type: "integer",
          },
          actual: {
            value: items.length.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Incorrect number of items extracted",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const firstItemMatches =
      items[0].title === expectedFirstItem.title &&
      items[0].publishedOn === expectedFirstItem.publishedOn;

    if (!firstItemMatches) {
      logger.error({
        message: "First item does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: JSON.stringify(expectedFirstItem),
            type: "object",
          },
          actual: {
            value: JSON.stringify(items[0]),
            type: "object",
          },
        },
      });
      return {
        _success: false,
        error: "First item does not match expected",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const lastItemMatches =
      items[items.length - 1].title === expectedLastItem.title &&
      items[items.length - 1].publishedOn === expectedLastItem.publishedOn;

    if (!lastItemMatches) {
      logger.error({
        message: "Last item does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: JSON.stringify(expectedLastItem),
            type: "object",
          },
          actual: {
            value: JSON.stringify(items[items.length - 1]),
            type: "object",
          },
        },
      });
      return {
        _success: false,
        error: "Last item does not match expected",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    return {
      _success: true,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error({
      message: `Error in extract_press_releases function`,
      level: 0,
      auxiliary: {
        error: {
          value: error.message || JSON.stringify(error),
          type: "string",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "An error occurred during extraction",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await stagehand.context.close().catch(() => {});
  }
};

const tasks: Record<string, EvalFunction> = {
  vanta,
  vanta_h,
  peeler_simple,
  peeler_complex,
  wikipedia,
  nonsense_action,
  simple_google_search,
  extract_github_stars,
  extract_collaborators_from_github_repository,
  extract_last_twenty_github_commits,
  costar,
  google_jobs,
  homedepot,
  extract_partners,
  laroche_form,
  arxiv,
  expedia,
  amazon_add_to_cart,
  extract_press_releases,
};

interface EvalArgs<TInput, TOutput, TExpected> {
  input: TInput;
  output: TOutput;
  expected: TExpected;
  metadata?: { model: AvailableModel; test: string };
}

interface EvalResult {
  name: string;
  score: number;
}

interface EvalInput {
  name: string;
  modelName: AvailableModel;
}

const exactMatch = (
  args: EvalArgs<EvalInput, boolean | { _success: boolean }, unknown>,
): EvalResult => {
  console.log(`Task "${args.input.name}" returned: ${args.output}`);

  const expected = args.expected ?? true;
  if (expected === true) {
    return {
      name: "Exact match",
      score:
        typeof args.output === "boolean"
          ? args.output
            ? 1
            : 0
          : args.output._success
            ? 1
            : 0,
    };
  }

  return {
    name: "Exact match",
    score: args.output === expected ? 1 : 0,
  };
};

const errorMatch = (
  args: EvalArgs<
    EvalInput,
    boolean | { _success: boolean; error?: unknown },
    unknown
  >,
): EvalResult => {
  console.log(`Task "${args.input.name}" returned: ${args.output}`);

  return {
    name: "Error rate",
    score:
      typeof args.output === "object" && args.output.error !== undefined
        ? 1
        : 0,
  };
};

const testcases = [
  "vanta",
  "vanta_h",
  ...(env === "BROWSERBASE" ? [] : ["peeler_simple"]), // peeler_simple is not supported on Browserbase
  "wikipedia",
  "peeler_complex",
  "simple_google_search",
  "extract_github_stars",
  "extract_collaborators_from_github_repository",
  "extract_last_twenty_github_commits",
  "google_jobs",
  "homedepot",
  "extract_partners",
  "laroche_form",
  "arxiv",
  "amazon_add_to_cart",
  "extract_press_releases",
  // "expedia"
];

const generateSummary = async (
  summary: { scores?: Record<string, { score: number | null }> },
  results: {
    input: EvalInput;
    output?: boolean | { _success: boolean };
  }[],
) => {
  const exactMatch = summary.scores?.["Exact match"] || { score: null };

  const taskStatuses = results.map((result) => ({
    name: result.input.name,
    modelName: result.input.modelName,
    success:
      typeof result.output === "boolean"
        ? result.output
        : result.output?._success || false,
  }));

  const totalTasks = taskStatuses.length;

  const passedTasks = taskStatuses
    .filter((task) => task.success)
    .map((task) => ({ name: task.name, modelName: task.modelName }));
  const failedTasks = taskStatuses
    .filter((task) => !task.success)
    .map((task) => ({ name: task.name, modelName: task.modelName }));

  const formattedSummary = {
    exactMatchScore: exactMatch.score !== null ? exactMatch.score * 100 : null,
    totalTasks,
    passedTasks,
    failedTasks,
  };

  fs.writeFileSync(
    "eval-summary.json",
    JSON.stringify(formattedSummary, null, 2),
  );
  console.log("Evaluation summary written to eval-summary.json");
};

const ciEvals = process.env.CI_EVALS?.split(",").map((e) => e.trim());

const args = process.argv.slice(2);
const filter = args[0];

(async () => {
  try {
    const evalResult = await Eval("stagehand", {
      data: () => {
        let allTestcases = models.flatMap((model) =>
          testcases.flatMap((test) => ({
            input: { name: test, modelName: model },
            name: test,
            tags: [model, test],
            metadata: {
              model,
              test,
            },
            expected: true,
          })),
        );

        if (ciEvals && ciEvals.length > 0) {
          allTestcases = allTestcases.filter((testcase) =>
            ciEvals.includes(testcase.name),
          );
        }

        if (filter) {
          allTestcases = allTestcases.filter(
            (testcase) =>
              testcase.name === filter || testcase.input.name === filter,
          );
        }

        return allTestcases;
      },
      task: async (input: {
        name: keyof typeof tasks;
        modelName: AvailableModel;
      }) => {
        const logger = new EvalLogger();
        try {
          // Handle predefined tasks
          const result = await tasks[input.name]({
            modelName: input.modelName,
            logger,
          });
          if (result && result._success) {
            console.log(`✅ ${input.name}: Passed`);
          } else {
            console.log(`❌ ${input.name}: Failed`);
          }
          return result;
        } catch (error) {
          console.error(`❌ ${input.name}: Error - ${error}`);
          logger.error({
            message: `Error in task ${input.name}`,
            level: 0,
            auxiliary: {
              error: {
                value: error,
                type: "object",
              },
              trace: {
                value: error.stack,
                type: "string",
              },
            },
          });
          return {
            _success: false,
            error: JSON.parse(JSON.stringify(error, null, 2)),
            logs: logger.getLogs(),
          };
        }
      },
      scores: [exactMatch, errorMatch],
      maxConcurrency: 20,
      trialCount: 5,
    });

    await generateSummary(evalResult.summary, evalResult.results);
  } catch (error) {
    console.error("Error during evaluation run:", error);
    process.exit(1);
  }
})();
