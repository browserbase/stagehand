import { describe, expect, it } from "vitest";

import { LLMProvider } from "../../lib/v3/llm/LLMProvider.js";
import { ExperimentalNotConfiguredError } from "../../lib/v3/types/public/sdkErrors.js";

describe("LLMProvider hosted vertex gating", () => {
  it("allows hosted Vertex configs when API mode is enabled", () => {
    const llmProvider = new LLMProvider(() => {});

    expect(() =>
      llmProvider.getClient(
        "vertex/gemini-2.5-pro",
        {
          project: "vertex-project",
          location: "us-central1",
          googleAuthOptions: {
            credentials: {
              client_email: "vertex@example.com",
              private_key: "private-key",
            },
          },
        },
        { disableAPI: false, experimental: false },
      ),
    ).not.toThrow();
  });

  it("keeps requiring experimental mode for bare Vertex configs in API mode", () => {
    const llmProvider = new LLMProvider(() => {});

    expect(() =>
      llmProvider.getClient(
        "vertex/gemini-2.5-pro",
        undefined,
        { disableAPI: false, experimental: false },
      ),
    ).toThrow(ExperimentalNotConfiguredError);
  });
});
