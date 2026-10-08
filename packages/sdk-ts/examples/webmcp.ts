import { localBrowser, Stagehand } from "../src/index.js";

const webMCPTestSite = "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/";

const browser = await localBrowser.launch({ headless: false });
const stagehand = await Stagehand.create({ browser });

try {
  const [page] = await browser.context.pages();
  // Subscribe before navigation: hooks report future changes, not existing tools.
  const added = await page.onToolsAdded((tools) => {
    for (const tool of tools) console.log("Tool added:", tool.name, tool.frameId);
  });
  let markRemovalReceived!: () => void;
  const removalReceived = new Promise<void>((resolve) => {
    markRemovalReceived = resolve;
  });
  const removed = await page.onToolsRemoved((tools) => {
    for (const tool of tools) console.log("Tool removed:", tool.name, tool.frameId);
    if (tools.length > 0) markRemovalReceived();
  });
  await page.goto(webMCPTestSite);

  const tools = await page.tools({ timeout: 5_000 });
  const calculateSum = tools.find((tool) => tool.name === "calculateSum");
  if (!calculateSum) {
    throw new Error("calculateSum was not registered by the page");
  }

  const invocation = await calculateSum.invoke({
    input: { a: 19, b: 23 },
  });
  const result = await invocation.result();

  console.log(result);

  // Leaving the document removes its registered tools.
  await page.goto("about:blank");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      removalReceived,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out waiting for tool removal")), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  await added.unsubscribe();
  await removed.unsubscribe();
} finally {
  try {
    await stagehand.close();
  } finally {
    await browser.close();
  }
}
