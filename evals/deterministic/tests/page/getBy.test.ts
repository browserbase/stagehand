import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - Built-in locators", () => {
  let stagehand: Stagehand;

  test.beforeAll(async () => {
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterAll(async () => {
    await stagehand.close();
  });

  test("demonstrates getByAltText, getByLabel, getByPlaceholder, getByRole, getByTestId, getByText, getByTitle", async () => {
    const { page } = stagehand;
    await page.setContent(`
      <html>
        <body>
          <img src="avatar.png" alt="Profile picture" />
          <label for="username">Username</label>
          <input id="username" type="text" />
          <input placeholder="Enter your email" type="email" />
          <button>Sign in</button>
          <div data-testid="greeting">Hello World!</div>
          <p>This is some descriptive text on the page.</p>
          <h1 title="A heading for the page">Site Title</h1>
        </body>
      </html>
    `);
    const image = page.getByAltText("Profile picture");
    await expect(image).toBeVisible();
    const usernameInput = page.getByLabel("Username");
    await expect(usernameInput).toBeVisible();
    const emailInput = page.getByPlaceholder("Enter your email");
    await expect(emailInput).toBeVisible();
    const signInButton = page.getByRole("button", { name: "Sign in" });
    await expect(signInButton).toBeVisible();
    const greetingDiv = page.getByTestId("greeting");
    await expect(greetingDiv).toHaveText("Hello World!");
    const descriptiveText = page.getByText(
      "This is some descriptive text on the page.",
    );
    await expect(descriptiveText).toBeVisible();
    const heading = page.getByTitle("A heading for the page");
    await expect(heading).toHaveText("Site Title");
  });
});
