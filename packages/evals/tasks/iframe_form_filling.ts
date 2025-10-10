import { EvalFunction } from "../types/evals";

export const iframe_form_filling: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-form-filling/",
    );

    await v3.act("type 'nunya' into the 'first name' field");
    await v3.act("type 'business' into the 'last name' field");
    await v3.act("type 'test@email.com' into the 'email' field");
    await v3.act("click 'phone' as the preferred contact method");
    await v3.act("type 'yooooooooooooooo' into the message box");

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
    await v3.close();
  }
};
