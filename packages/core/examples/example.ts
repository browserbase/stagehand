import { Stagehand } from "../lib/v3";

async function example(stagehand: Stagehand): Promise<void> {
  const context = stagehand.context;
  const page = context.pages()[0];

  await context.addInitScript(`
(() => {
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.backgroundColor = 'red';
   });
})();
`);
  await page.goto("http://127.0.0.1:8080/sites/ctx-add-init-script-oopif/");
  // await page.goto("http://127.0.0.1:8080/sites/ctx-add-init-script-spif/");
  // await new Promise((resolve) => setTimeout(resolve, 1000));
  await page.locator("a").click();

}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
  });
  await stagehand.init();
  await example(stagehand);
})();
