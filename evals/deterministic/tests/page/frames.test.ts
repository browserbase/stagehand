import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/evals/deterministic/stagehand.config";

test.describe("StagehandPage - frame operations", () => {
  let stagehand: Stagehand;

  test.beforeAll(async () => {
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterAll(async () => {
    await stagehand.close();
  });

  test("should use page.mainFrame(), page.frames(), page.frame(), and page.frameLocator()", async () => {
    const { page } = stagehand;

    await page.setContent(`
      <html>
        <body>
          <iframe
            name="frame-one"
            srcdoc="<html><body><h1>Hello from Frame 1</h1></body></html>">
          </iframe>

          <iframe
            name="frame-two"
            srcdoc="<html><body><h1>Hello from Frame 2</h1></body></html>">
          </iframe>
        </body>
      </html>
    `);

    await page.waitForSelector('iframe[name="frame-one"]');
    await page.waitForSelector('iframe[name="frame-two"]');

    const frames = page.frames();
    console.log(
      "All frames found:",
      frames.map((f) => f.name()),
    );
    expect(frames).toHaveLength(3);

    const mainFrame = page.mainFrame();
    console.log("Main frame name:", mainFrame.name());
    expect(mainFrame.name()).toBe("");

    const frameOne = page.frame({ name: "frame-one" });
    expect(frameOne).not.toBeNull();

    const frameOneText = await frameOne?.locator("h1").textContent();
    expect(frameOneText).toBe("Hello from Frame 1");

    const frameTwoLocator = page.frameLocator("iframe[name='frame-two']");
    const frameTwoText = await frameTwoLocator.locator("h1").textContent();
    expect(frameTwoText).toBe("Hello from Frame 2");

    const frameTwo = page.frame({ name: "frame-two" });
    expect(frameTwo).not.toBeNull();

    const frameTwoTextAgain = await frameTwo?.locator("h1").textContent();
    expect(frameTwoTextAgain).toBe("Hello from Frame 2");
  });
});
