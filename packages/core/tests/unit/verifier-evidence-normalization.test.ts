import { describe, expect, it } from "vitest";

import {
  buildAgentEvidenceFromStepFinished,
  REDACTED_INLINE_IMAGE,
} from "../../lib/v3/verifier/evidenceNormalization.js";

describe("buildAgentEvidenceFromStepFinished", () => {
  it("captures primitive tool results as text evidence", () => {
    const evidence = buildAgentEvidenceFromStepFinished({
      type: "step_finished",
      actionName: "check",
      actionArgs: {},
      reasoning: "",
      toolOutput: { ok: true, result: false },
    });

    expect(evidence.modalities).toEqual([{ type: "text", content: "false" }]);
  });

  it("lifts inline screenshot payloads into image evidence and redacts JSON", () => {
    const inlineScreenshot =
      Buffer.from("inline screenshot").toString("base64");

    const evidence = buildAgentEvidenceFromStepFinished({
      type: "step_finished",
      actionName: "click",
      actionArgs: { describe: "Open fare details" },
      reasoning: "",
      toolOutput: {
        ok: true,
        result: {
          output: {
            success: true,
            describe: "Open fare details",
            screenshotBase64: inlineScreenshot,
          },
        },
      },
    });

    const [imageModality, jsonModality] = evidence.modalities;

    expect(JSON.stringify(evidence)).not.toContain(inlineScreenshot);
    expect(jsonModality).toMatchObject({
      type: "json",
      content: {
        output: {
          screenshotBase64: REDACTED_INLINE_IMAGE,
        },
      },
    });
    expect(imageModality).toMatchObject({
      type: "image",
      mediaType: "image/png",
    });
    if (imageModality?.type === "image") {
      expect(imageModality.bytes).toEqual(
        Buffer.from(inlineScreenshot, "base64"),
      );
    }
  });
});
