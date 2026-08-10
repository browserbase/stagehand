import { describe, expect, it } from "vitest";
import { validateExperimentalFeatures } from "../../lib/v3/agent/utils/validateExperimentalFeatures.js";
import { StagehandInvalidArgumentError } from "../../lib/v3/types/public/sdkErrors.js";

describe("agent variable experimental validation", () => {
  it("allows variables without experimental mode", () => {
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: false,
        agentConfig: { mode: "dom" },
        executeOptions: {
          instruction: "fill %username%",
          variables: { username: "john@example.com" },
        },
      }),
    ).not.toThrow();
  });

  it("allows rich variables without experimental mode", () => {
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: false,
        agentConfig: { mode: "dom" },
        executeOptions: {
          instruction: "fill %username%",
          variables: {
            username: {
              value: "john@example.com",
              description: "The login email",
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it("continues to reject variables in CUA mode", () => {
    expect(() =>
      validateExperimentalFeatures({
        isExperimental: true,
        agentConfig: { mode: "cua" },
        executeOptions: {
          instruction: "fill %username%",
          variables: { username: "john@example.com" },
        },
      }),
    ).toThrow(StagehandInvalidArgumentError);
  });
});
