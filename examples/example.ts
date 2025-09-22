// import { Stagehand } from "@browserbasehq/stagehand";
//
// async function example(stagehand: Stagehand) {
//   /**
//    * Add your code here!
//    */
//   const page = stagehand.page;
//   await page.goto(
//     "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
//   );
//   await page.extract({
//     instruction: "grab the content from inside the iframe",
//     iframes: true,
//   });
// }
//
// (async () => {
//   const stagehand = new Stagehand({
//     env: "LOCAL",
//     experimental: true,
//     verbose: 1,
//   });
//   await stagehand.init();
//   await example(stagehand);
// })();
