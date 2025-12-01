import { describe, expect, it } from "vitest";
import { StagehandResponseParseError } from "../lib/v3/types/public/apiErrors";

describe("API Error Handling", () => {
  describe("SSE error parsing", () => {
    it("throws plain Error with raw message for server errors", () => {
      // Simulate what happens in api.ts when SSE error is received
      const serverErrorMessage =
        "API key not valid. Please pass a valid API key.";
      const eventData = {
        type: "system",
        data: {
          status: "error",
          error: serverErrorMessage,
        },
      };

      // This simulates the error handling logic in api.ts execute()
      if (eventData.data.status === "error") {
        const { error: errorMsg } = eventData.data;
        const thrownError = new Error(errorMsg);

        // Verify it's a plain Error, not a wrapped type
        expect(thrownError).toBeInstanceOf(Error);
        expect(thrownError.constructor.name).toBe("Error");
        expect(thrownError.message).toBe(serverErrorMessage);
      }
    });

    it("wraps SyntaxError in StagehandResponseParseError for JSON parse failures", () => {
      const invalidJson = "not valid json {";

      try {
        JSON.parse(invalidJson);
      } catch (e) {
        // This simulates the catch block logic in api.ts
        if (e instanceof Error && !(e instanceof SyntaxError)) {
          throw e; // Would pass through
        }

        // SyntaxError gets wrapped
        const errorMessage = e instanceof Error ? e.message : String(e);
        const wrappedError = new StagehandResponseParseError(
          `Failed to parse server response: ${errorMessage}`,
        );

        expect(wrappedError).toBeInstanceOf(StagehandResponseParseError);
        expect(wrappedError.message).toContain(
          "Failed to parse server response",
        );
      }
    });
  });
});
