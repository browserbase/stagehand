import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeAnnotatedPageContent } from "./index.js";

const fixture = readFileSync(new URL("./fixtures/content.base64", import.meta.url), "utf8").trim();
const expected = {
  version: "ANNOTATED_PAGE_CONTENT_VERSION_1_0",
  rootNode: {
    childrenNodes: [
      {
        contentAttributes: {
          attributeType: "CONTENT_ATTRIBUTE_TEXT",
          textData: { textContent: "Hello, 世界" },
        },
      },
      {
        contentAttributes: {
          commonAncestorDomNodeId: 42,
          attributeType: "CONTENT_ATTRIBUTE_FORM_CONTROL",
          formControlData: {
            formControlType: "FORM_CONTROL_TYPE_INPUT_EMAIL",
            fieldName: "email",
            isReadonly: false,
          },
          interactionInfo: {
            isDisabled: false,
            clickabilityReasons: ["CLICKABILITY_REASON_EDITABLE"],
          },
        },
      },
    ],
  },
  mainFrameData: { mediaData: { durationMilliseconds: "9007199254740993", isPlaying: false } },
};

describe("APC protobuf decoding", () => {
  it("decodes nested nodes and actionable metadata without losing presence or int64 precision", () => {
    expect(decodeAnnotatedPageContent(fixture)).toStrictEqual(expected);
  });

  it("omits absent fields and ignores unknown wire fields", () => {
    expect(decodeAnnotatedPageContent("")).toStrictEqual({});
    const bytes = Buffer.concat([Buffer.from(fixture, "base64"), Buffer.from([0xa0, 0x06, 0x01])]);
    expect(decodeAnnotatedPageContent(bytes.toString("base64"))).toStrictEqual(expected);
  });

  it.each(["not!base64", "EgU=", "AA=="])("rejects malformed payload %s", (content) => {
    expect(() => decodeAnnotatedPageContent(content)).toThrow();
  });
});
