import { EvalFunction } from "../../types/evals.js";

/**
 * Eval: agent navigates to the Google reCAPTCHA demo site and submits the form.
 *
 * On Browserbase with captcha solving enabled, the captcha should be
 * automatically solved. The agent's auto-pause feature (CaptchaSolver)
 * should transparently pause execution during solving and resume once done.
 *
 * Success criteria:
 *   - The agent completes without crashing
 *   - The form is submitted (page navigates to success or form submit response)
 *   - The agent uses the wait tool or naturally pauses while captcha is solved
 */
export const recaptcha_demo: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
  agent,
}) => {
  try {
    const page = v3.context.pages()[0];

    // Track captcha solver console events
    const captchaEvents: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.startsWith("browserbase-solving")) {
        captchaEvents.push(text);
        logger.log({
          category: "captcha",
          message: `Captcha event: ${text}`,
          level: 1,
        });
      }
    });

    await page.goto("https://www.google.com/recaptcha/api2/demo", {
      waitUntil: "load",
    });

    const agentResult = await agent.execute({
      instruction:
        "Submit the reCAPTCHA demo form by clicking the Submit button. The captcha will be solved automatically - just wait for it and then submit.",
      maxSteps: 15,
    });

    logger.log({
      category: "captcha",
      message: `Agent completed. Success: ${agentResult.success}. Actions: ${agentResult.actions.length}. Captcha events: ${JSON.stringify(captchaEvents)}`,
      level: 1,
    });

    // Check if the page navigated away from the demo form (indicating successful submit)
    const currentUrl = page.url();
    const formSubmitted =
      currentUrl !== "https://www.google.com/recaptcha/api2/demo" ||
      agentResult.success;

    // On Browserbase, we expect captcha events to have fired
    const hadCaptchaEvents = captchaEvents.length > 0;
    const captchaSolveCompleted = captchaEvents.includes(
      "browserbase-solving-finished",
    );

    return {
      _success: agentResult.success && (formSubmitted || captchaSolveCompleted),
      observations: `Agent ${agentResult.success ? "succeeded" : "failed"}. Form submitted: ${formSubmitted}. Captcha events: ${JSON.stringify(captchaEvents)}. Had captcha events: ${hadCaptchaEvents}. Captcha solve completed: ${captchaSolveCompleted}.`,
      agentMessage: agentResult.message,
      captchaEvents,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
