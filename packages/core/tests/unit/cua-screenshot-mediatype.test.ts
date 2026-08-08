import { describe, it, expect, beforeEach } from "vitest";
import { GoogleCUAClient } from "../../lib/v3/agent/GoogleCUAClient.js";
import { AnthropicCUAClient } from "../../lib/v3/agent/AnthropicCUAClient.js";
import { OpenAICUAClient } from "../../lib/v3/agent/OpenAICUAClient.js";
import { MicrosoftCUAClient } from "../../lib/v3/agent/MicrosoftCUAClient.js";
import type { ScreenshotProviderResult } from "../../lib/v3/types/public/agent.js";

/**
 * Regression coverage for #2159 / #2046.
 *
 * The screenshot provider now declares the media type at the capture boundary
 * (`{ base64, mediaType }`) instead of each CUA client hardcoding or inferring
 * "image/png". These tests assert every client's `captureScreenshot()` honors a
 * non-PNG media type rather than silently mislabeling it — the failure mode that
 * broke non-PNG function responses.
 */
describe("CUA clients thread screenshot mediaType through captureScreenshot", () => {
  const jpeg: ScreenshotProviderResult = {
    base64: "jpeg-bytes",
    mediaType: "image/jpeg",
  };

  let google: GoogleCUAClient;
  let anthropic: AnthropicCUAClient;
  let openai: OpenAICUAClient;
  let microsoft: MicrosoftCUAClient;

  beforeEach(() => {
    google = new GoogleCUAClient(
      "google",
      "gemini-2.5-computer-use-preview-10-2025",
      undefined,
      {
        apiKey: "test",
      },
    );
    anthropic = new AnthropicCUAClient(
      "anthropic",
      "claude-sonnet-4-5-20250929",
      undefined,
      {
        apiKey: "test",
      },
    );
    openai = new OpenAICUAClient("openai", "computer-use-preview", undefined, {
      apiKey: "test",
    });
    microsoft = new MicrosoftCUAClient("microsoft", "fara-7b", undefined, {
      apiKey: "test",
      baseURL: "https://example.com",
    });
  });

  it("Anthropic/Google return the provider's mediaType verbatim", async () => {
    google.setScreenshotProvider(async () => jpeg);
    anthropic.setScreenshotProvider(async () => jpeg);

    expect(await google.captureScreenshot()).toEqual(jpeg);
    expect(await anthropic.captureScreenshot()).toEqual(jpeg);
  });

  it("OpenAI/Microsoft build the data URL with the provider's mediaType", async () => {
    openai.setScreenshotProvider(async () => jpeg);
    microsoft.setScreenshotProvider(async () => jpeg);

    // OpenAI returns the structured result; Microsoft returns a data URL string.
    expect(await openai.captureScreenshot()).toEqual(jpeg);
    expect(await microsoft.captureScreenshot()).toBe(
      "data:image/jpeg;base64,jpeg-bytes",
    );
  });

  it("options.base64Image still defaults to image/png", async () => {
    google.setScreenshotProvider(async () => jpeg);
    const result = await google.captureScreenshot({ base64Image: "png-bytes" });
    expect(result).toEqual({ base64: "png-bytes", mediaType: "image/png" });
  });
});
