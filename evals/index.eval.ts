import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";
import process from "process";
import { EvalLogger } from "./utils";

const env =
  process.env.EVAL_ENV?.toLowerCase() === "browserbase"
    ? "BROWSERBASE"
    : "LOCAL";

const enableCaching = process.env.EVAL_ENABLE_CACHING?.toLowerCase() === "true";

const expedia = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    headless: false,
    verbose: 2,
    debugDom: true,
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

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

    const url = await stagehand.page.url();
    return {
      _success: url.startsWith("https://www.expedia.com/Checkout/"),
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error(
      `Error in expedia function: ${JSON.stringify(error, null, 2)}. Trace: ${error.stack}`,
    );
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
const vanta = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    headless: process.env.HEADLESS !== "false",
    logger: (message: any) => {
      logger.log(message);
    },
    verbose: 2,
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

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

const vanta_h = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    verbose: 2,
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

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

const simple_google_search = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    verbose: 2,
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

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
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};

const peeler_simple = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env: "LOCAL",
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    verbose: 2,
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

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

const peeler_complex = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

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
    const errorMessage = JSON.parse(JSON.stringify(error, null, 2));
    const errorStack = errorMessage.stack;
    const fullError = `Error in peeler_complex function: ${errorMessage.message} Trace: ${errorStack}`;
    logger.error(fullError);
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

const homedepot = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init({
    domSettleTimeoutMs: 60_000,
  });

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
    logger.log(`The gas grill primary burner BTU is: ${productSpecs}`);

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
    logger.error(
      `Error in homedepot function: ${JSON.stringify(error, null, 2)}, Trace: ${error.stack}`,
    );
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

const extract_github_stars = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

  try {
    await stagehand.page.goto("https://github.com/facebook/react");

    const { stars } = await stagehand.extract({
      instruction: "Extract the number of stars for the project",
      schema: z.object({
        stars: z.number().describe("the number of stars for the project"),
      }),
      modelName: "gpt-4o-2024-08-06",
    });

    const expectedStarsString = await stagehand.page
      .locator("#repo-stars-counter-star")
      .first()
      .innerHTML();

    const expectedStars = expectedStarsString.toLowerCase().endsWith("k")
      ? parseFloat(expectedStarsString.slice(0, -1)) * 1000
      : parseFloat(expectedStarsString);

    await stagehand.context.close().catch(() => {});
    return {
      _success: stars === expectedStars,
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

const extract_collaborators_from_github_repository = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

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
      modelName: "gpt-4o-2024-08-06",
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

const extract_last_twenty_github_commits = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

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
      modelName: "gpt-4o-2024-08-06",
    });

    logger.log(`Extracted commits: ${commits}`);
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

const wikipedia = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

  await stagehand.page.goto(`https://en.wikipedia.org/wiki/Baseball`);
  await stagehand.act({
    action: 'click the "hit and run" link in this article',
  });

  const url = "https://en.wikipedia.org/wiki/Hit_and_run_(baseball)";
  const currentUrl = await stagehand.page.url();
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
const nonsense_action = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    debugDom: true,
    headless: true,
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

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

const costar = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    debugDom: true,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();
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

    logger.log(`articleTitle: ${articleTitle}`);

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
    logger.error(`Error in costar function: ${error.message}`);
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

const google_jobs = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    debugDom: true,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init();

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

    logger.log(`Job Details: ${jobDetails}`);

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

    logger.log(`Job Details valid: ${isJobDetailsValid}`);

    return {
      _success: isJobDetailsValid,
      jobDetails,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error(
      `Error in google_jobs function: ${error.message}. Trace: ${error.stack}`,
    );
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

const extract_partners = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    debugDom: true,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init({
    modelName: "gpt-4o",
  });

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

    const expectedPartners = [
      "Accounting Partners",
      "Private Equity & Venture Capital Partners",
      "Services Partners",
      "Affiliates",
    ];

    if (partners.explanation) {
      logger.log(`Explanation: ${partners.explanation}`);
    }

    const foundPartners = partners.partners.map((partner) =>
      partner.name.toLowerCase(),
    );

    const allExpectedPartnersFound = expectedPartners.every((partner) =>
      foundPartners.includes(partner.toLowerCase()),
    );

    logger.log(`All expected partners found: ${allExpectedPartnersFound}`);
    logger.log(`Expected: ${expectedPartners}`);
    logger.log(`Found: ${foundPartners}`);

    return {
      _success: allExpectedPartnersFound,
      partners,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error(
      `Error in extractPartners function: ${error.message}. Trace: ${error.stack}`,
    );
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

const laroche_form = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    debugDom: true,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init({
    modelName: "gpt-4o",
  });

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
    logger.error(
      `Error in LarocheForm function: ${error.message}. Trace: ${error.stack}`,
    );
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

const arxiv = async () => {
  const logger = new EvalLogger();

  const stagehand = new Stagehand({
    env,
    verbose: 2,
    debugDom: true,
    headless: process.env.HEADLESS !== "false",
    logger: (message: { category?: string; message: string }) => {
      logger.log(message.message);
    },
    enableCaching,
  });

  logger.init(stagehand);

  const { debugUrl, sessionUrl } = await stagehand.init({
    modelName: "gpt-4o-2024-08-06",
  });

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

    logger.log(JSON.stringify(papers, null, 2));

    // Assert that the length of papers is three
    if (papers.length !== 2) {
      logger.log(`Expected 2 papers, but got ${papers.length}`);
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
        logger.log(`Paper "${paper.title}" is missing problem or methodology`);
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
    logger.error(
      `Error in arxiv function: ${error.message}. Trace: ${error.stack}`,
    );
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

const tasks = {
  vanta,
  vanta_h,
  peeler_simple,
  peeler_complex,
  wikipedia,
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
};

const exactMatch = (args: {
  input: any;
  output: any;
  expected?: any;
}): {
  name: string;
  score: boolean;
} => {
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
  { input: { name: "extract_github_stars" } },
  {
    input: {
      name: "extract_collaborators_from_github_repository",
    },
  },
  { input: { name: "extract_last_twenty_github_commits" } },
  { input: { name: "google_jobs" } },
  { input: { name: "homedepot" } },
  { input: { name: "extract_partners" } },
  { input: { name: "laroche_form" } },
  { input: { name: "arxiv" } },
  // { input: { name: "expedia" } },
];

Eval("stagehand", {
  data: () => {
    return testcases;
  },
  task: async (input: any) => {
    // console.log("input", input);
    try {
      // Handle predefined tasks
      const result = await (tasks as any)[input.name](input);
      if (result) {
        console.log(`✅ ${input.name}: Passed`);
      } else {
        console.log(`❌ ${input.name}: Failed`);
      }
      return result;
    } catch (error) {
      console.error(`❌ ${input.name}: Error - ${error}`);
      return {
        _success: false,
        error: JSON.parse(JSON.stringify(error, null, 2)),
      };
    }
  },
  scores: [exactMatch],
  maxConcurrency: 5,
  // trialCount: 3,
});
