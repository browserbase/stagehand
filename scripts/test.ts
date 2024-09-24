import { Stagehand } from "../lib";
import { z } from "zod";

const get_last_20_commits = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 1 });
  await stagehand.init();

  await stagehand.page.goto("https://github.com/facebook/react");

  //   await stagehand.ct({
  //     action: "find the last 20 commits",
  //   });

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

  await stagehand.context.close();

  console.log("Extracted commits:", commits);
  return commits.length === 5;
};

const twitter_signup = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 1 });
  await stagehand.init();

  await stagehand.page.goto("https://twitter.com");

  await stagehand.act({
    action:
      'sign up with email "{random 12 digit number}@gmail.com", password "TEstTEst.1234". Use whatever else you want for all other fields. You can only stop if you have reached the verification stage.',
  });

  await stagehand.waitForSettledDom();

  console.log("Current URL:", await stagehand.page.url());
  //   await stagehand.context.close();
};

const medium_article_extract = async () => {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 1 });
  await stagehand.init();

  await stagehand.page.goto(
    "https://medium.com/@jeffpowell.dev/blueprint-for-a-full-stack-go-web-application-9633d25b9e2e",
  );

  await stagehand.waitForSettledDom();

  const { article } = await stagehand.extract({
    instruction: "Extract article",
    schema: z.object({
      article: z.object({
        title: z.string(),
        content: z.string(),
        picture_urls: z.array(z.string()),
      }),
    }),
    modelName: "gpt-4o-2024-08-06",
  });

  console.log("Extracted article:", article);

  await stagehand.context.close();

  return article.content.split("\n").length > 100;
};

(async () => {
  await twitter_signup();
})();
