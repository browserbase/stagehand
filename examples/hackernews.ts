import { Stagehand } from "../lib";
import { z } from "zod";

async function example() {
	const stagehand = new Stagehand({
		env: "LOCAL",
		verbose: 1,
		debugDom: true,
		modelName: "llama3.2",
	});

	await stagehand.init();
	await stagehand.page.goto("https://news.ycombinator.com");

	const headlines = await stagehand.page.extract({
		instruction:
			"Extract the first 3 stories from the Hacker News homepage from the top of the page. They will be numbered 1-3.",
		schema: z.object({
			stories: z.array(
				z.object({
					title: z.string(),
					url: z.string(),
				}),
			),
		}),
	});
	console.log(headlines);
}

(async () => {
	await example();
})();
