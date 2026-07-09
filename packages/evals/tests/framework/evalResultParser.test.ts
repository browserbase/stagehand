import { describe, expect, it } from "vitest";
import {
  buildEvalResultInstructions,
  parseEvalResultText,
} from "../../framework/evalResultParser.js";

describe("parseEvalResultText", () => {
  it("parses a well-formed trailing marker line", () => {
    const parsed = parseEvalResultText(
      'I finished.\nEVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"checkout"}',
    );
    expect(parsed.success).toBe(true);
    expect(parsed.summary).toBe("done");
    expect(parsed.finalAnswer).toBe("checkout");
  });

  it("uses the last marker line when several are present", () => {
    const parsed = parseEvalResultText(
      [
        'EVAL_RESULT: {"success":false,"summary":"first attempt"}',
        "retrying...",
        'EVAL_RESULT: {"success":true,"summary":"second attempt"}',
      ].join("\n"),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.summary).toBe("second attempt");
  });

  it("ignores the literal marker inside the JSON payload", () => {
    // The marker text appearing inside summary/finalAnswer must not hijack
    // which text gets parsed — only lines beginning with the marker count.
    const parsed = parseEvalResultText(
      'EVAL_RESULT: {"success":true,"summary":"printed EVAL_RESULT: line as instructed","finalAnswer":"ok"}',
    );
    expect(parsed.success).toBe(true);
    expect(parsed.summary).toBe("printed EVAL_RESULT: line as instructed");
  });

  it("falls back to the first line after the marker when trailing text follows", () => {
    const parsed = parseEvalResultText(
      'EVAL_RESULT: {"success":true,"summary":"done"}\nSome trailing SDK text.',
    );
    expect(parsed.success).toBe(true);
    expect(parsed.summary).toBe("done");
  });

  it("returns success:false for malformed JSON after the marker", () => {
    const parsed = parseEvalResultText("EVAL_RESULT: {success: yes}");
    expect(parsed.success).toBe(false);
    expect(parsed.raw).toBe("EVAL_RESULT: {success: yes}");
  });

  it("parses bare JSON when no marker is present", () => {
    const parsed = parseEvalResultText('{"success":true,"summary":"bare"}');
    expect(parsed.success).toBe(true);
    expect(parsed.summary).toBe("bare");
  });

  it("returns success:false for text without marker or JSON", () => {
    const parsed = parseEvalResultText("I could not finish the task.");
    expect(parsed.success).toBe(false);
  });

  it("only accepts success === true as success", () => {
    expect(parseEvalResultText('EVAL_RESULT: {"success":"true"}').success).toBe(
      false,
    );
    expect(parseEvalResultText('EVAL_RESULT: {"success":1}').success).toBe(
      false,
    );
  });

  it("instructions mention the marker and the JSON schema", () => {
    const instructions = buildEvalResultInstructions();
    expect(instructions).toContain("EVAL_RESULT:");
    expect(instructions).toContain('"success"');
  });
});
