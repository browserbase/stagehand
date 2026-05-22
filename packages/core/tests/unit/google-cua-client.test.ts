import { describe, expect, it } from "vitest";
import { parseImageDataUrl } from "../../lib/v3/agent/GoogleCUAClient.js";

describe("parseImageDataUrl", () => {
  it("parses a PNG data URL into mimeType and base64 payload", () => {
    const result = parseImageDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(result).toEqual({
      mimeType: "image/png",
      data: "iVBORw0KGgo=",
    });
  });

  it("parses a JPEG data URL into mimeType and base64 payload", () => {
    const result = parseImageDataUrl("data:image/jpeg;base64,/9j/4AAQSkZJRg==");
    expect(result).toEqual({
      mimeType: "image/jpeg",
      data: "/9j/4AAQSkZJRg==",
    });
  });

  it("parses a WebP data URL into mimeType and base64 payload", () => {
    const result = parseImageDataUrl("data:image/webp;base64,UklGRiQAAABXRUJQ");
    expect(result).toEqual({
      mimeType: "image/webp",
      data: "UklGRiQAAABXRUJQ",
    });
  });

  it("falls back to image/png for raw base64 input (preserving prior behavior)", () => {
    const raw = "iVBORw0KGgoAAAANSUhEUgAA";
    const result = parseImageDataUrl(raw);
    expect(result).toEqual({
      mimeType: "image/png",
      data: raw,
    });
  });

  it("falls back to image/png for non-image data URLs", () => {
    const input = "data:text/plain;base64,SGVsbG8=";
    const result = parseImageDataUrl(input);
    expect(result).toEqual({
      mimeType: "image/png",
      data: input,
    });
  });
});
