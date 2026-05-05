import { describe, expect, it, vi } from "vitest";
import { fillFormVisionTool } from "../../lib/v3/agent/tools/fillFormVision.js";
import type { V3 } from "../../lib/v3/v3.js";

describe("fillFormVisionTool variable redaction", () => {
  it("returns playwrightArguments with %tokens%, never substituted secret values", async () => {
    const typedValues: string[] = [];
    const fakePage = {
      click: vi.fn().mockResolvedValue("xpath=/html/body"),
      type: vi.fn(async (text: string) => {
        typedValues.push(text);
      }),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
      screenshot: vi.fn().mockResolvedValue(Buffer.from("png")),
    };

    const fakeV3 = {
      context: { awaitActivePage: async () => fakePage },
      logger: () => {},
      isAgentReplayActive: () => false,
      recordAgentReplayStep: () => {},
    } as unknown as V3;

    const variables = {
      username: { value: "john@example.com", description: "login email" },
      password: "s3cret!",
    };

    const tool = fillFormVisionTool(fakeV3, undefined, variables);

    const result = (await tool.execute(
      {
        fields: [
          {
            action: "type %username% into the email field",
            value: "%username%",
            coordinates: { x: 10, y: 20 },
          },
          {
            action: "type %password% into the password field",
            value: "%password%",
            coordinates: { x: 30, y: 40 },
          },
        ],
      },
      {} as Parameters<typeof tool.execute>[1],
    )) as {
      success: boolean;
      playwrightArguments?: Array<{
        action: string;
        value: string;
        coordinates: { x: number; y: number };
      }>;
    };

    expect(result.success).toBe(true);
    expect(result.playwrightArguments).toBeDefined();

    // The page must have received the substituted values for actual typing.
    expect(typedValues).toEqual(["john@example.com", "s3cret!"]);

    // The returned tool result must keep placeholder tokens, never raw secrets.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("john@example.com");
    expect(serialized).not.toContain("s3cret!");
    expect(serialized).not.toContain("originalValue");

    for (const field of result.playwrightArguments ?? []) {
      expect(field.value.startsWith("%")).toBe(true);
      expect(field.value.endsWith("%")).toBe(true);
    }
  });
});
