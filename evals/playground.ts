import { Eval } from "braintrust";
import { Stagehand } from "../lib";
import { z } from "zod";

const costar = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    debugDom: true,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();
  // TODO: fix this eval
  try {
    await Promise.race([
      stagehand.page.goto("https://www.costar.com/"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Navigation timeout")), 30000),
      ),
    ]);
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "click on the first article" });

    await stagehand.act({ action: "find the footer of the page" });

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

    return isTitleValid;
  } catch (error) {
    console.error(`Error in costar function: ${error.message}`);
    return { title: null };
  } finally {
    await stagehand.context.close();
  }
};

const homedepot = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
    // headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  try {
    // await stagehand.page.goto("https://www.homedepot.com/");
    // await stagehand.waitForSettledDom();

    // await stagehand.act({ action: "search for gas grills" });
    // await stagehand.waitForSettledDom();

    // await stagehand.act({ action: "click on the best selling gas grill" });
    // await stagehand.waitForSettledDom();

    await stagehand.page.goto(
      "https://www.homedepot.com/p/Nexgrill-4-Burner-Propane-Gas-Grill-in-Black-with-Stainless-Steel-Main-Lid-720-0925PG/326294740",
    );
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "click on the Product Details" });
    await stagehand.waitForSettledDom();

    await stagehand.act({ action: "find the Primary Burner BTU" });
    await stagehand.waitForSettledDom();

    const productSpecs = await stagehand.extract({
      instruction: "Extract the Primary Burner BTU of the product",
      schema: z.object({
        productSpecs: z
          .array(
            z.object({
              burnerBTU: z.string().describe("Primary Burner BTU"),
            }),
          )
          .describe("Gas grill Primary Burner BTU"),
      }),
      modelName: "gpt-4o-2024-08-06",
    });
    console.log("The gas grill primary burner BTU is:", productSpecs);

    if (
      !productSpecs ||
      !productSpecs.productSpecs ||
      productSpecs.productSpecs.length === 0
    ) {
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error in homedepot function: ${error.message}`);
    return false;
  } finally {
    await stagehand.context.close();
  }
};

const extract_last_twenty_github_commits = async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Operation timed out")), 60000),
  );

  try {
    const extractionPromise = (async () => {
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
      return commits.length === 20;
    })();

    const result = await Promise.race([extractionPromise, timeoutPromise]);
    await stagehand.context.close();
    return result;
  } catch (error) {
    console.error("Error or timeout occurred:", error);
    await stagehand.context.close();
    return false;
  }
};

async function main() {
  // const [costarResult] = await Promise.all([costar()]);
  // const [homedepotResult] = await Promise.all([homedepot()]);
  const result = await extract_last_twenty_github_commits();

  console.log("Result:", result);
}

main().catch(console.error);
