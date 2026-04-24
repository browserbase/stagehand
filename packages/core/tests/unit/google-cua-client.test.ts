import { describe, expect, it } from "vitest";
import { GoogleCUAClient } from "../../lib/v3/agent/GoogleCUAClient.js";

type ParseScreenshotDataUrlFn = (screenshot: string) => {
  mimeType: string;
  base64Data: string;
};

const parseScreenshotDataUrl = (
  GoogleCUAClient.prototype as unknown as {
    parseScreenshotDataUrl: ParseScreenshotDataUrlFn;
  }
).parseScreenshotDataUrl;

function createClient(): GoogleCUAClient {
  return new GoogleCUAClient(
    "google",
    "google/gemini-2.5-computer-use-preview-10-2025",
    "test instructions",
    { apiKey: "test" },
  );
}

describe("GoogleCUAClient screenshot MIME handling", () => {
  it("preserves image data URLs passed via captureScreenshot options", async () => {
    const client = createClient();
    const jpegDataUrl = "data:image/jpeg;base64,abc123";

    const screenshot = await client.captureScreenshot({
      base64Image: jpegDataUrl,
    });

    expect(screenshot).toBe(jpegDataUrl);
  });

  it("defaults raw base64 captureScreenshot options to PNG data URL", async () => {
    const client = createClient();

    const screenshot = await client.captureScreenshot({
      base64Image: "abc123",
    });

    expect(screenshot).toBe("data:image/png;base64,abc123");
  });

  it("extracts JPEG mime type and base64 payload from data URLs", () => {
    const client = createClient();

    const parsed = parseScreenshotDataUrl.call(
      client,
      "data:image/jpg;base64,abc123",
    );

    expect(parsed).toEqual({
      mimeType: "image/jpeg",
      base64Data: "abc123",
    });
  });

  it("falls back to PNG mime type for non-image data URLs", () => {
    const client = createClient();

    const parsed = parseScreenshotDataUrl.call(
      client,
      "data:application/octet-stream;base64,abc123",
    );

    expect(parsed).toEqual({
      mimeType: "image/png",
      base64Data: "abc123",
    });
  });
});
