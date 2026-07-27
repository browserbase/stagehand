import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
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

      // v3 used page.frameLocator("iframe") for these assertions; v4 has no
      // frameLocator, so the same checks are re-expressed in-page via the
      // same-origin iframe's contentDocument.
      const {
        firstNameValue,
        lastNameValue,
        emailValue,
        contactValue,
        messageValue,
      } = await page.evaluate(() => {
        const doc = document.querySelector("iframe")?.contentDocument;
        if (!doc) throw new Error("could not access iframe contentDocument");

        const firstName = doc.querySelector(
          'input[placeholder="Jane"]',
        ) as HTMLInputElement | null;
        const lastName = doc.querySelector(
          'input[placeholder="Doe"]',
        ) as HTMLInputElement | null;
        const email = doc.querySelector(
          'input[placeholder="jane@example.com"]',
        ) as HTMLInputElement | null;
        const contact = doc.evaluate(
          "/html/body/main/section[1]/form/fieldset/label[2]/input",
          doc,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue as HTMLInputElement | null;
        const message = doc.querySelector(
          'textarea[placeholder="Say hello…"]',
        ) as HTMLTextAreaElement | null;

        if (!firstName || !lastName || !email || !contact || !message) {
          throw new Error("could not resolve form fields inside the iframe");
        }

        return {
          firstNameValue: firstName.value,
          lastNameValue: lastName.value,
          emailValue: email.value,
          contactValue: contact.checked,
          messageValue: message.value,
        };
      });

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
  },
);
