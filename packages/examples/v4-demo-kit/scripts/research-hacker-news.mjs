import { z } from "zod/v4";

export const needsModel = true;

export async function run({ page, stagehand }) {
  await page.goto("https://news.ycombinator.com/");

  const { data: newestLinks } = await stagehand.observe(
    "Find the link in the top navigation that opens the newest stories.",
  );
  if (!newestLinks[0]) throw new Error("Stagehand did not find the newest stories link.");

  await stagehand.act(newestLinks[0]);

  const { data, metadata } = await stagehand.extract(
    "Extract the first five story titles and their visible rank.",
    z.object({
      stories: z.array(z.object({ rank: z.number(), title: z.string() })).max(5),
    }),
  );

  return { stories: data.stories, cacheStatus: metadata?.cache?.status ?? "unknown" };
}
