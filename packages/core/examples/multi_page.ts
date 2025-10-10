import { Stagehand } from "../../../dist";

async function example(stagehand: Stagehand) {
  /**
   * Add your code here!
   */

  const page = stagehand.page;
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/new-tab/",
  );

  await page.act({
    action: "click the button to open the other page",
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  // console.log(await page.extract());

  // const extraction = await page.extract("extract the page text");
  const newPage = await stagehand.context.newPage();
  // await new Promise((resolve) => setTimeout(resolve, 4000));

  await newPage.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/google/",
  );
  // await new Promise((resolve) => setTimeout(resolve, 2000));
  await newPage.act("type stagehand into the search bar");

  const originalPage = stagehand.context.pages()[0];
  await originalPage.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/new-tab/other.html",
  );
  // await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(`page url: ${page.url()}`);
  console.log(`newPage URL: ${newPage.url()}`);
  console.log(`originalPage URL: ${originalPage.url()}`);
  const originalPageExtraction =
    await originalPage.extract("get the page text");
  console.log(originalPageExtraction.extraction);
  console.log(`page url: ${page.url()}`);
  console.log(`newPage URL: ${newPage.url()}`);
  console.log(`originalPage URL: ${originalPage.url()}`);

  for (const thePage of stagehand.context.pages()) {
    console.log(thePage.url());
  }

  // const pages = stagehand.context.pages();
  // for (const page of pages) {
  //   console.log(page.url());
  // }
  // // await new Promise((resolve) => setTimeout(resolve, 5000));
  // const page1 = pages[0];
  // const page2 = pages[1];
  // await page1.reload();
  //
  // // await new Promise((resolve) => setTimeout(resolve, 5000));
  // // extract all the text from the first page
  // console.log(`extracting from page1. page1 URL: ${page1.url()}`);
  // const extraction1 = await page1.extract("extract the page text");
  // // await new Promise((resolve) => setTimeout(resolve, 5000));
  // // extract all the text from the second page
  // console.log(`extracting from page2. page2 URL: ${page2.url()}`);
  // const extraction2 = await page2.extract("extract the page text");
  //
  // // const extraction1Success = extraction1.page_text.includes("Welcome!");
  // // const extraction2Success = extraction2.page_text.includes(
  // //   "You're on the other page",
  // // );
  // console.log(`extraction 1: ${extraction1.extraction}\n\n\n\n`);
  // console.log(`extraction 2: ${extraction2.extraction}\n\n\n\n`);
}

(async () => {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    useAPI: true,
    verbose: 1,
  });
  await stagehand.init();
  await example(stagehand);
  // await stagehand.close();
})();
