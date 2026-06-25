import { describe, it, expect } from "vitest";
import type { FunctionCall } from "@google/genai";

import { GoogleCUAClient } from "../../lib/v3/agent/GoogleCUAClient.js";
import type { AgentAction } from "../../lib/v3/types/public/agent.js";

// Reach the private converter the same way safety-confirmation.test.ts reaches
// handleSafetyConfirmation — via the prototype, typed through `unknown`.
const convert = (
  GoogleCUAClient.prototype as unknown as {
    convertFunctionCallToAction: (
      this: GoogleCUAClient,
      functionCall: FunctionCall,
    ) => AgentAction | null;
  }
).convertFunctionCallToAction;

function createGoogleClient(): GoogleCUAClient {
  return new GoogleCUAClient(
    "google",
    "google/gemini-3.5-flash",
    "test instructions",
    { apiKey: "test" },
  );
}

function run(name: string, args: Record<string, unknown>): AgentAction | null {
  return convert.call(createGoogleClient(), { name, args } as FunctionCall);
}

// gemini-3.x sends coordinates on a 0-999 grid; the 1288x711 default viewport
// maps (500,500) -> (644, 355). We assert finite numbers rather than the exact
// mapping so the tests don't couple to normalizeCoordinates internals.
const COORDS = { x: 500, y: 500, intent: "interact with the element" };

describe("GoogleCUAClient gemini-3.x click-family conversion", () => {
  it("maps click to a left click (backcompat with 2.5 click_at)", () => {
    const action = run("click", COORDS);
    expect(action?.type).toBe("click");
    expect(action?.button).toBe("left");
    expect(Number.isFinite(action?.x as number)).toBe(true);
    expect(Number.isFinite(action?.y as number)).toBe(true);
  });

  it("preserves double_click as a double click", () => {
    expect(run("double_click", COORDS)?.type).toBe("double_click");
  });

  it("preserves triple_click as a triple click", () => {
    expect(run("triple_click", COORDS)?.type).toBe("triple_click");
  });

  it("maps right_click to a click with the right button", () => {
    const action = run("right_click", COORDS);
    expect(action?.type).toBe("click");
    expect(action?.button).toBe("right");
  });

  it("maps middle_click to a click with the middle button", () => {
    const action = run("middle_click", COORDS);
    expect(action?.type).toBe("click");
    expect(action?.button).toBe("middle");
  });

  it("maps move to a cursor move", () => {
    const action = run("move", COORDS);
    expect(action?.type).toBe("move");
    expect(Number.isFinite(action?.x as number)).toBe(true);
  });

  it("returns null (no NaN) when click-family coordinates are missing", () => {
    for (const name of [
      "double_click",
      "triple_click",
      "right_click",
      "middle_click",
      "move",
    ]) {
      expect(run(name, { intent: "no coords" })).toBeNull();
    }
  });

  it("still maps the gemini-2.5 click_at handler unchanged", () => {
    const action = run("click_at", { x: 100, y: 200 });
    expect(action?.type).toBe("click");
    expect(action?.button).toBe("left");
  });
});

describe("GoogleCUAClient arg-required handler guards", () => {
  it("rejects navigate without a url, maps it when present", () => {
    expect(run("navigate", { intent: "go" })).toBeNull();
    expect(run("navigate", { url: "" })).toBeNull();
    expect(run("navigate", { url: "https://example.com" })).toEqual({
      type: "goto",
      url: "https://example.com",
    });
  });

  it("rejects type without text, allows an empty string (clear field)", () => {
    expect(run("type", { intent: "type" })).toBeNull();
    expect(run("type_text_at", { intent: "type" })).toBeNull();
    expect(run("type", { text: "hello" })?.type).toBe("type");
    expect(run("type", { text: "" })?.type).toBe("type");
  });
});
