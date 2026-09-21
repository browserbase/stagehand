import { describe, expect, it } from "vitest";
import { buildGeminiCuaTranscript } from "../src/transcript.js";

describe("Gemini transcript Unicode retention", () => {
  it.each([1997, 1998])(
    "clips around a surrogate pair after %s ASCII characters without corrupting UTF-8",
    (prefix) => {
      const transcript = buildGeminiCuaTranscript([
        {
          type: "tool_result",
          turn: 1,
          id: "one",
          name: "read",
          text: "x".repeat(prefix) + "😀ZZ",
          error: false,
        },
      ]);
      expect(Buffer.from(transcript, "utf8").toString("utf8")).toBe(transcript);
      expect(transcript).not.toContain("�");
      expect(transcript).toContain(prefix === 1997 ? "😀…" : "x…");
    },
  );
});
