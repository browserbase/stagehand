import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - addLocatorHandler and removeLocatorHandler", () => {
  // This HTML snippet is reused by both tests.
  // The "Sign up to the newsletter" overlay appears after 2 seconds.
  // The "No thanks" button hides it.
  const overlayHTML = `
    <html>
      <body>
        <button id="cta">Start here</button>
        <div id="overlay" style="display: none;">
          <p>Sign up to the newsletter</p>
          <button id="no-thanks">No thanks</button>
        </div>
        <script>
          // Show the overlay after 2 seconds
          setTimeout(() => {
            document.getElementById('overlay').style.display = 'block';
          }, 2000);

          // Hide the overlay when "No thanks" is clicked
          document.getElementById('no-thanks').addEventListener('click', () => {
            document.getElementById('overlay').style.display = 'none';
          });
        </script>
      </body>
    </html>
  `;

  test("should use a custom locator handler to dismiss the overlay", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const { page } = stagehand;

    await page.addLocatorHandler(
      page.getByText("Sign up to the newsletter"),
      async () => {
        console.log("Overlay detected. Clicking 'No thanks' to remove it...");
        await page.getByRole("button", { name: "No thanks" }).click();
      },
    );

    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );
    await page.setContent(overlayHTML);

    await page.waitForTimeout(5000);

    await page.getByRole("button", { name: "Start here" }).click();

    const isOverlayVisible = await page
      .getByText("Sign up to the newsletter")
      .isVisible()
      .catch(() => false);

    await stagehand.close();

    expect(isOverlayVisible).toBeFalsy();
  });

  test("should remove a custom locator handler so overlay stays visible", async () => {
    const stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();

    const { page } = stagehand;

    const locator = page.getByText("Sign up to the newsletter");
    await page.addLocatorHandler(locator, async () => {
      console.log("Overlay detected. Clicking 'No thanks' to remove it...");
      await page.getByRole("button", { name: "No thanks" }).click();
    });

    await page.removeLocatorHandler(locator);
    console.log("Locator handler removed — overlay will not be dismissed now.");

    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/example",
    );
    await page.setContent(overlayHTML);

    await page.waitForTimeout(5000);

    await page.getByRole("button", { name: "Start here" }).click();

    const isOverlayVisible = await page
      .getByText("Sign up to the newsletter")
      .isVisible()
      .catch(() => false);

    await stagehand.close();
    expect(isOverlayVisible).toBe(true);
  });
});
