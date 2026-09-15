import { browserbase, localBrowser, Stagehand } from "@browserbasehq/stagehand";

export async function createSession({ requireModel = false } = {}) {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  const modelName = process.env.STAGEHAND_MODEL_NAME?.trim();
  const modelApiKey = process.env.STAGEHAND_MODEL_API_KEY?.trim();

  if (!apiKey && requireModel && (!modelName || !modelApiKey)) {
    throw new Error(
      "This demo needs AI. Set BROWSERBASE_API_KEY, or set STAGEHAND_MODEL_NAME and STAGEHAND_MODEL_API_KEY for local Chrome.",
    );
  }

  const browser = apiKey
    ? await browserbase.launch({ apiKey })
    : await localBrowser.launch({ headless: false });

  try {
    const model = modelName
      ? { modelName, ...(modelApiKey ? { apiKey: modelApiKey } : {}) }
      : undefined;
    const stagehand = await Stagehand.create({ browser, ...(model ? { model } : {}) });
    const page = await browser.context.activePage();
    if (!page) {
      await stagehand.close();
      throw new Error("Stagehand did not create an active page.");
    }

    return {
      browser,
      context: browser.context,
      page,
      stagehand,
      hosted: Boolean(apiKey),
      async close() {
        await stagehand.close();
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
