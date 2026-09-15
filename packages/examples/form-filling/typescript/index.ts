// Stagehand + Browserbase: Form Filling Automation - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";

// Form data variables - using random/fake data for testing
// Set your own variables below to customize the form submission
const firstName = "Alex";
const lastName = "Johnson";
const company = "TechCorp Solutions";
const jobTitle = "Software Developer";
const email = "alex.johnson@example.com";
const message =
  "Hello, I'm interested in learning more about your services and would like to schedule a demo.";

async function main() {
  console.log("Starting Form Filling Example...");

  // Initialize Stagehand with Browserbase for cloud-based browser automation.
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
  });
  const stagehand = await Stagehand.create({
    browser: browser,
    model: { modelName: "openai/gpt-4.1" },
    logging: { level: "info" },
  });

  try {
    // Initialize browser session to start automation.

    console.log("Stagehand initialized successfully!");
    const page = (await browser.context.pages())[0];

    // Navigate to contact page with extended timeout for slow-loading sites.
    console.log("Navigating to Browserbase contact page...");
    await page.goto("https://www.browserbase.com/contact", {
      waitUntil: "domcontentloaded", // Wait for DOM to be ready before proceeding.
      timeout: 60000, // Extended timeout for reliable page loading.
    });

    const fields = [
      ["firstName", firstName],
      ["lastName", lastName],
      ["companyName", company],
      ["jobTitle", jobTitle],
      ["email", email],
      ["project", message],
    ] as const;
    const { data: formFields } = await stagehand.observe(
      "Find form fields for: first name, last name, company, job title, email, message",
    );
    for (const field of formFields) {
      const description = field.description.toLowerCase();
      const match = fields.find(([name]) => {
        const labels: Record<string, string[]> = {
          firstName: ["first name"],
          lastName: ["last name"],
          companyName: ["company"],
          jobTitle: ["job title"],
          email: ["email"],
          project: ["message", "project"],
        };
        return labels[name].some((label) => description.includes(label));
      });
      if (match) {
        await stagehand.act({ ...field, arguments: [match[1]] });
      }
    }
    await stagehand.act("Click on the How Can we help? dropdown");
    await stagehand.act("Click on the demo option from the dropdown");

    // Uncomment the line below if you want to submit the form
    // await stagehand.act("Click the submit button");

    console.log("Form filled successfully! Waiting 3 seconds...");
    await page.waitForTimeout(3000);
  } catch (error) {
    console.error(`Error during form filling: ${error}`);
    throw error;
  } finally {
    // Always close session to release resources and clean up.
    try {
      await stagehand.close();
    } catch (error) {
      console.warn(`Stagehand cleanup warning: ${error}`);
    }
    try {
      await browser.close();
    } catch (error) {
      console.warn(`Browser cleanup warning: ${error}`);
    }
    console.log("Session closed successfully");
  }
}

main().catch((err) => {
  console.error("Error in form filling example:", err);
  console.error("Common issues:");
  console.error("  - Check .env file has BROWSERBASE_API_KEY");
  console.error("  - Ensure form fields are available on the contact page");
  console.error("Docs: https://docs.stagehand.dev/v4/first-steps/introduction");
  process.exit(1);
});
