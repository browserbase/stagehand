import { describe, expect, it } from "vitest";
import { assertPublicExtensionArtifact } from "../extensionArtifactPackaging.js";

describe("extension artifact packaging", () => {
  it("accepts an explicitly public extension artifact", () => {
    expect(() =>
      assertPublicExtensionArtifact({ residentTransportConfigured: false }),
    ).not.toThrow();
  });

  it.each([{ residentTransportConfigured: true }, {}, null])(
    "rejects private or ambiguous extension metadata %#",
    (metadata) => {
      expect(() => assertPublicExtensionArtifact(metadata)).toThrow(
        "Refusing to package a privately configured resident extension",
      );
    },
  );
});
