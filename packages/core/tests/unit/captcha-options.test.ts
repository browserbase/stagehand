import { afterEach, describe, expect, it, vi } from "vitest";
import { V3 } from "../../lib/v3/v3.js";
import { StagehandAPIClient } from "../../lib/v3/api.js";
import type { V3Options } from "../../lib/v3/types/public/options.js";

describe("CAPTCHA awareness options", () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const env of ["LOCAL", "BROWSERBASE"] as const) {
    for (const waitForCaptchaSolves of [undefined, false, true]) {
      for (const solveCaptchas of [undefined, false, true]) {
        it(`${env}: wait=${waitForCaptchaSolves}, solve=${solveCaptchas}`, async () => {
          const options: V3Options = {
            env,
            apiKey: "bb-test",
            projectId: "project-test",
            disableAPI: true,
            disablePino: true,
            waitForCaptchaSolves,
            browserbaseSessionCreateParams: {
              browserSettings: { solveCaptchas },
            },
          };
          const stagehand = new V3(options);
          try {
            expect(stagehand.isCaptchaAutoSolveEnabled).toBe(
              (waitForCaptchaSolves ??
                solveCaptchas ??
                env === "BROWSERBASE") &&
                solveCaptchas !== false,
            );
          } finally {
            await stagehand.close();
          }
        });
      }
    }
  }

  it.each([true, false, undefined])(
    "serializes waitForCaptchaSolves=%s to the hosted API",
    async (waitForCaptchaSolves) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { sessionId: "session-test", available: true },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      const client = new StagehandAPIClient({
        apiKey: "bb-test",
        logger: vi.fn(),
      });
      await client.init({
        modelName: "openai/gpt-4.1-mini",
        waitForCaptchaSolves,
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.waitForCaptchaSolves).toBe(waitForCaptchaSolves);
    },
  );
});
