import { describe, expect, it } from "vitest";
import { Api } from "../../lib/v3/types/public/index.js";

describe("API variable schemas", () => {
  it("accepts rich variables for act requests", () => {
    const result = Api.ActRequestSchema.safeParse({
      input: "type %username% into the email field",
      options: {
        variables: {
          username: {
            value: "john@example.com",
            description: "The login email",
          },
          rememberMe: true,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts rich variables for observe requests", () => {
    const result = Api.ObserveRequestSchema.safeParse({
      instruction: "find the field where %username% should be entered",
      options: {
        variables: {
          username: {
            value: "john@example.com",
            description: "The login email",
          },
          rememberMe: true,
        },
      },
    });

    expect(result.success).toBe(true);
  });
});
