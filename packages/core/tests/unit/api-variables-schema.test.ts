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

  it("preserves variables for agent execute requests", () => {
    const result = Api.AgentExecuteRequestSchema.safeParse({
      agentConfig: { mode: "dom" },
      executeOptions: {
        instruction: "fill the form with %username% and %password%",
        variables: {
          username: "john@example.com",
          password: {
            value: "secret-password",
            description: "The login password",
          },
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.executeOptions.variables).toEqual({
      username: "john@example.com",
      password: {
        value: "secret-password",
        description: "The login password",
      },
    });
  });
});
