import { describe, it, expect } from "vitest";

import {
  AgentProvider,
  modelToAgentProviderMap,
} from "../../lib/v3/agent/AgentProvider.js";
import { GoogleCUAClient } from "../../lib/v3/agent/GoogleCUAClient.js";
import { UnsupportedModelError } from "../../lib/v3/types/public/sdkErrors.js";
import type { ClientOptions } from "../../lib/v3/types/public/model.js";

const noopLogger = () => {};

const SERVICE_ACCOUNT_AUTH = {
  type: "googleServiceAccount",
  credentials: {
    private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----",
    client_email: "sa@my-project.iam.gserviceaccount.com",
  },
} as const;

// The GoogleGenAI client keeps its resolved options on nested internals that
// differ between SDK builds; asserting on the Stagehand-visible surface
// (routing, modelName, clientOptions) keeps these tests SDK-agnostic.
describe("Vertex AI CUA routing", () => {
  it("routes vertex/-prefixed Google CU models to the vertex provider", () => {
    expect(AgentProvider.getAgentProvider("vertex/gemini-3.5-flash")).toBe(
      "vertex",
    );
    expect(
      AgentProvider.getAgentProvider(
        "vertex/gemini-2.5-computer-use-preview-10-2025",
      ),
    ).toBe("vertex");
  });

  it("rejects vertex/-prefixed models that are not Google CU models", () => {
    expect(() =>
      AgentProvider.getAgentProvider("vertex/claude-fable-5"),
    ).toThrow(UnsupportedModelError);
  });

  it("leaves google/-prefixed models on the google provider", () => {
    expect(AgentProvider.getAgentProvider("google/gemini-3.5-flash")).toBe(
      "google",
    );
    expect(modelToAgentProviderMap["gemini-3.5-flash"]).toBe("google");
  });

  it("returns a GoogleCUAClient for an explicit vertex provider", () => {
    const provider = new AgentProvider(noopLogger);
    const client = provider.getClient("gemini-3.5-flash", {
      provider: "vertex",
      auth: SERVICE_ACCOUNT_AUTH,
      providerOptions: {
        vertex: { project: "my-project", location: "us-central1" },
      },
    } as ClientOptions);
    expect(client).toBeInstanceOf(GoogleCUAClient);
    expect(client.modelName).toBe("gemini-3.5-flash");
  });

  it("returns a GoogleCUAClient for a vertex/-prefixed model name", () => {
    const provider = new AgentProvider(noopLogger);
    const client = provider.getClient("vertex/gemini-3.5-flash", {
      providerOptions: {
        vertex: { project: "my-project", location: "us-central1" },
      },
    } as ClientOptions);
    expect(client).toBeInstanceOf(GoogleCUAClient);
    // The prefix selects the endpoint; the model id sent to the API must not
    // carry it.
    expect(client.modelName).toBe("gemini-3.5-flash");
  });
});

describe("GoogleCUAClient vertex construction", () => {
  it("constructs with a service account and no API key", () => {
    const client = new GoogleCUAClient(
      "vertex",
      "gemini-3.5-flash",
      undefined,
      {
        provider: "vertex",
        auth: SERVICE_ACCOUNT_AUTH,
        providerOptions: {
          vertex: { project: "my-project", location: "us-central1" },
        },
      } as ClientOptions,
    );
    expect(client.modelName).toBe("gemini-3.5-flash");
  });

  it("constructs in express mode with only an apiKey", () => {
    const client = new GoogleCUAClient(
      "vertex",
      "gemini-3.5-flash",
      undefined,
      {
        provider: "vertex",
        apiKey: "vertex-express-key",
      } as ClientOptions,
    );
    expect(client.modelName).toBe("gemini-3.5-flash");
  });

  it("does not fall back to Gemini API keys in vertex mode", () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "gemini-key-should-be-ignored";
    try {
      const client = new GoogleCUAClient(
        "vertex",
        "gemini-3.5-flash",
        undefined,
        {
          provider: "vertex",
          providerOptions: {
            vertex: { project: "my-project", location: "us-central1" },
          },
        } as ClientOptions,
      );
      expect(client.clientOptions.apiKey).not.toBe(
        "gemini-key-should-be-ignored",
      );
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});
