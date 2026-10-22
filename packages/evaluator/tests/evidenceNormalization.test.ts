import { expect, test } from "vitest";
import {
  buildAgentEvidenceFromStepFinished,
  REDACTED_INLINE_IMAGE,
  redactInlineImagePayloads,
} from "../src/evidenceNormalization.js";
import type { AgentStepFinishedEvent } from "../src/agentEvidenceEvents.js";

test("redaction keeps a __proto__ key as data and leaves the prototype alone", () => {
  const input = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
  const out = redactInlineImagePayloads(input) as Record<string, unknown>;
  expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  expect(Object.keys(out)).toEqual(["__proto__", "ok"]);
  expect(JSON.stringify(out)).toBe('{"__proto__":{"polluted":true},"ok":1}');
});

test("{ data, mimeType } image blocks become image modalities with their MIME type", () => {
  const data = Buffer.from("jpeg-bytes").toString("base64");
  const evidence = buildAgentEvidenceFromStepFinished({
    actionName: "screenshot",
    toolOutput: {
      ok: true,
      result: { content: [{ type: "image", data, mimeType: "image/jpeg" }] },
    },
  } as unknown as AgentStepFinishedEvent);
  expect(evidence.modalities[0]).toMatchObject({ type: "image", mediaType: "image/jpeg" });
  expect(evidence.modalities[1]).toEqual({
    type: "json",
    content: { content: [{ type: "image", data: REDACTED_INLINE_IMAGE, mimeType: "image/jpeg" }] },
  });
});

test("non-image data fields are left alone", () => {
  const value = { data: "hello", mimeType: "text/plain" };
  expect(redactInlineImagePayloads(value)).toEqual(value);
});

test("malformed base64 is not emitted as an image modality", () => {
  const evidence = buildAgentEvidenceFromStepFinished({
    actionName: "screenshot",
    toolOutput: {
      ok: true,
      result: { content: [{ type: "image", data: "not base64!", mimeType: "image/png" }] },
    },
  } as unknown as AgentStepFinishedEvent);
  expect(evidence.modalities.map((m) => m.type)).toEqual(["json"]);
});
