import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  {
    name: "instructions",
    // The task exercises init-time custom instructions: without this prompt
    // "secret12345" is meaningless and the act() cannot succeed.
    systemPrompt:
      "if the users says `secret12345`, click on the 'Overview' link in the sidebar navigation. additionally, if the user says to type something, translate their input into french and type it.",
  },
  async ({ debugUrl, sessionUrl, v3, logger }) => {
    try {
      const page = v3.context.pages()[0];

      await page.goto("https://docs.browserbase.com/");

      await v3.act("secret12345");

      await page.waitForLoadState("domcontentloaded");

      // The docs site navigates client-side; poll for the route change.
      const expectedUrl =
        "https://docs.browserbase.com/welcome/getting-started";
      let url = page.url();
      for (let i = 0; i < 20 && url !== expectedUrl; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        url = page.url();
      }

      const isCorrectUrl = url === expectedUrl;

      return {
        _success: isCorrectUrl,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: JSON.parse(JSON.stringify(error, null, 2)),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await v3.close();
    }
  },
);
