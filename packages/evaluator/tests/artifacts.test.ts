import { expect, test } from "vitest";
import sharp from "sharp";
import { collectCanonicalEvidence, isImageEvidence, isTextEvidence } from "../src/evidence.js";
import type { Trajectory } from "../src/types.js";

test("nested Cursor screenshot buffers become images without leaking bytes or changing the source", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
    "base64",
  );
  const result = {
    value: {
      content: [
        { text: { text: "Warranty: 1 year" } },
        { image: { data: png.toJSON(), mimeType: "image/png" } },
      ],
    },
  };
  const trajectory: Trajectory = {
    task: { id: "cursor", instruction: "Read the warranty" },
    steps: [
      {
        actionName: "mcp",
        actionArgs: { providerIdentifier: "stagehand" },
        reasoning: "",
        toolOutput: { ok: true, result },
        agentEvidence: {
          modalities: [
            { type: "image", bytes: png.toJSON() as unknown as Buffer, mediaType: "image/png" },
            { type: "json", content: result },
            { type: "text", content: JSON.stringify(result) },
          ],
        },
        probeEvidence: {},
      },
    ],
    status: "complete",
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  const source = JSON.stringify(trajectory);
  const { evidence } = await collectCanonicalEvidence(trajectory, { chunked: true });
  const images = evidence.filter(isImageEvidence);
  expect(images).toHaveLength(1);
  expect(images[0].bytes).toEqual(png);
  const text = evidence
    .filter(isTextEvidence)
    .map((e) => e.content)
    .join("\n");
  expect(text).toContain("Warranty: 1 year");
  expect(text).not.toContain("137,80,78,71");
  expect(JSON.stringify(trajectory)).toBe(source);
});

test("unresized JPEG screenshots retain their MIME type and original bytes", async () => {
  const jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } })
    .jpeg()
    .toBuffer();
  const trajectory: Trajectory = {
    task: { id: "jpeg", instruction: "Read the page" },
    steps: [
      {
        actionName: "snapshot",
        actionArgs: {},
        reasoning: "",
        agentEvidence: { modalities: [] },
        probeEvidence: { screenshot: jpeg },
        toolOutput: { ok: true },
      },
    ],
    status: "complete",
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  const { evidence } = await collectCanonicalEvidence(trajectory, { chunked: true });
  const images = evidence.filter(isImageEvidence);
  expect(images).toHaveLength(1);
  expect(images[0].mediaType).toBe("image/jpeg");
  expect(images[0].bytes).toEqual(jpeg);
});
