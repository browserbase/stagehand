import { EvalFunction } from "@/types/evals";

export const iframe_form_filling: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    const page = stagehand.page;
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-form-filling/",
    );

    await page.act({
      action: "type 'nunya' into the 'first name' field",
      iframes: true,
    });
    await page.act({
      action: "type 'business' into the 'last name' field",
      iframes: true,
    });
    await page.act({
      action: "type 'test@email.com' into the 'email' field",
      iframes: true,
    });
    await page.act({
      action: "click 'phone' as the preferred contact method",
      iframes: true,
    });
    await page.act({
      action: "type 'yooooooooooooooo' into the message box",
      iframes: true,
    });

    const iframe = page.frameLocator("iframe");

    const firstNameValue: string = await iframe
      .locator('input[placeholder="Jane"]')
      .inputValue();

    const lastNameValue: string = await iframe
      .locator('input[placeholder="Doe"]')
      .inputValue();

    const emailValue: string = await iframe
      .locator('input[placeholder="jane@example.com"]')
      .inputValue();

    const contactValue: boolean = await iframe
      .locator("xpath=/html/body/main/section[1]/form/fieldset/label[2]/input")
      .isChecked();

    const messageValue: string = await iframe
      .locator('textarea[placeholder="Say hello…"]')
      .inputValue();

    const passed: boolean =
      firstNameValue.toLowerCase().trim() === "nunya" &&
      lastNameValue.toLowerCase().trim() === "business" &&
      emailValue.toLowerCase() === "test@email.com" &&
      messageValue.toLowerCase() === "yooooooooooooooo" &&
      contactValue;

    return {
      _success: passed,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    return {
      _success: false,
      error: error,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await stagehand.close();
  }
};
