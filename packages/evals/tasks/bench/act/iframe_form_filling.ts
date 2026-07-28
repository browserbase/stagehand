import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "iframe_form_filling" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-form-filling/",
      );

      await stagehand.act("type 'nunya' into the 'first name' field");
      await stagehand.act("type 'business' into the 'last name' field");
      await stagehand.act("type 'test@email.com' into the 'email' field");
      await stagehand.act("click 'phone' as the preferred contact method");
      await stagehand.act("type 'yooooooooooooooo' into the message box");

      // The form lives in a cross-origin iframe, so use an iframe-hop
      // selector to inspect it directly.
      const firstNameValue = await page.locator('iframe >> input[placeholder="Jane"]').inputValue();

      const lastNameValue = await page.locator('iframe >> input[placeholder="Doe"]').inputValue();

      const emailValue = await page
        .locator('iframe >> input[placeholder="jane@example.com"]')
        .inputValue();

      const contactValue = await page
        .locator("iframe >> xpath=/html/body/main/section[1]/form/fieldset/label[2]/input")
        .isChecked();

      const messageValue = await page
        .locator('iframe >> textarea[placeholder="Say hello…"]')
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
        error: String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }
  },
);
