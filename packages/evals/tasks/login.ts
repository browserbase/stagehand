import { EvalFunction } from "../types/evals";

export const login: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/login/",
    );

    await v3.act("type %nunya% into the username field", {
      variables: { nunya: "business" },
    });

    const xpath = "xpath=/html/body/main/form/div[1]/input";
    const actualValue = await page.locator(xpath).inputValue();

    const expectedValue = "business";

    return {
      _success: actualValue === expectedValue,
      expectedValue,
      actualValue,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error: error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
