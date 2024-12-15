import { Stagehand } from "../lib";
import { z } from "zod";

type RandomArticle = {
  id: number;
  ns: number;
  title: string;
};

async function getRandomArticle() {
  const response = await fetch(
    "https://en.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json",
  );
  const data = await response.json();
  return {
    ...(data.query.random[0] satisfies RandomArticle),
    link: `https://en.wikipedia.org/wiki/${data.query.random[0].title.replace(/ /g, "_")}`,
  };
}

async function example() {
  console.log(" Navigating to Wikipedia...");
  //   const src = await getRandomArticle();
  //   const dest = await getRandomArticle();

  const src = {
    title: "Isiah Thomas",
    link: "https://en.wikipedia.org/wiki/Isiah_Thomas",
  };

  const dest = {
    title: "LeBron James",
    link: "https://en.wikipedia.org/wiki/LeBron_James",
  };

  console.log(src, dest);
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
    domSettleTimeoutMs: 100,
  });

  await stagehand.init();
  await stagehand.page.goto(src.link);
  await stagehand.act({
    action: `You are a helpful assistant that can navigate Wikipedia. 
	You need to navigate from this article to the destination article in the least number of clicks. 
	The destination article is ${dest.title}. 
	Click the link to the destination article.
	If the destination article is not found, click the link that will get you closer to the destination article.
	Stop when you have reached the destination article.
	`,
  });
}
(async () => {
  await example();
})();
