import { EvalFunction } from "@/types/evals";

const env: "BROWSERBASE" | "LOCAL" =
  process.env.EVAL_ENV?.toLowerCase() === "browserbase"
    ? "BROWSERBASE"
    : "LOCAL";

export const peeler_simple: EvalFunction = async ({ stagehand, logger }) => {
  if (env === "BROWSERBASE") {
    throw new Error(
      "Browserbase not supported for this eval since we block all requests to file://",
    );
  }

  await stagehand.page.goto(`file://${process.cwd()}/evals/assets/peeler.html`);
  await stagehand.page.act({ action: "add the peeler to cart" });

  const successMessageLocator = stagehand.page.locator(
    'text="Congratulations, you have 1 A in your cart"',
  );
  const isVisible = await successMessageLocator.isVisible();

  await stagehand.close();

  return {
    _success: isVisible,
    logs: logger.getLogs(),
  };
};
