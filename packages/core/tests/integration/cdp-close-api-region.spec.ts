import { test, expect } from "@playwright/test";
import { V3 } from "../v3.js";
import { getV3TestConfig } from "./v3.config.js";
import { raceTimeout } from "./testUtils.js";

/**
 * Full production trigger chain:
 *
 *   v3.close()
 *     → apiClient.end()           (tells hosted API to kill the BB session)
 *     → hosted API terminates BB   (CDP WebSocket closes from server side)
 *     → ctx.close() → conn.close() (awaits "close" on already-CLOSED WS → hangs)
 *
 * Requires:
 *   - BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID
 *   - The Stagehand hosted API to be reachable
 *   - A non-us-west-2 region (higher latency makes the race reliably trigger)
 */
test.describe("v3.close() with Stagehand API + non-default region", () => {
  test("close resolves instead of hanging", async () => {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;

    test.skip(
      !apiKey || !projectId,
      "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required",
    );

    const v3 = new V3(
      getV3TestConfig({
        disableAPI: false,
        browserbaseSessionCreateParams: { region: "ap-southeast-1" },
      }),
    );

    await v3.init();

    // Verify the instance is functional.
    const page = v3.context.pages()[0];
    await page.goto("data:text/html,<html><body>api-region-test</body></html>");

    // Call v3.close() — the normal production shutdown path.
    // Internally: apiClient.end() → hosted API kills BB session →
    // CDP WebSocket closes → conn.close() tries to close already-closed WS.
    // Without the fix this hangs forever.
    const result = await raceTimeout(
      v3.close().then(() => "resolved" as const),
      30_000,
    );

    expect(result).toBe("resolved");
  });
});
