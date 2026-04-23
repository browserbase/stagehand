import { describe, expect, it } from "vitest";

import {
  normalizeClientOptionsForModel,
  toApiModelClientOptions,
} from "../../lib/v3/modelProviderOptions.js";
import { StagehandInvalidArgumentError } from "../../lib/v3/types/public/sdkErrors.js";

describe("modelProviderOptions", () => {
  it("promotes Bedrock providerOptions into runtime client options", () => {
    const result = normalizeClientOptionsForModel(
      {
        providerOptions: {
          region: "us-east-1",
          accessKeyId: "AKIATEST",
          secretAccessKey: "secret-test",
        },
      },
      "bedrock/us.amazon.nova-lite-v1:0",
    );

    expect(result).toMatchObject({
      providerOptions: {
        region: "us-east-1",
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret-test",
      },
      region: "us-east-1",
      accessKeyId: "AKIATEST",
      secretAccessKey: "secret-test",
    });
  });

  it("serializes Bedrock providerOptions into providerConfig for hosted API", () => {
    const result = toApiModelClientOptions(
      {
        providerOptions: {
          region: "us-east-1",
          accessKeyId: "AKIATEST",
          secretAccessKey: "secret-test",
        },
      },
      "bedrock/us.amazon.nova-lite-v1:0",
    );

    expect(result).toEqual({
      providerConfig: {
        provider: "bedrock",
        options: {
          region: "us-east-1",
          accessKeyId: "AKIATEST",
          secretAccessKey: "secret-test",
        },
      },
    });
  });

  it("merges legacy Vertex settings with providerOptions", () => {
    const result = normalizeClientOptionsForModel(
      {
        project: "legacy-project",
        providerOptions: {
          location: "us-central1",
          headers: new Headers({
            "x-vertex-priority": "high",
          }) as unknown as Record<string, string>,
        },
      },
      "vertex/gemini-2.5-pro",
    );

    expect(result).toMatchObject({
      project: "legacy-project",
      location: "us-central1",
      headers: {
        "x-vertex-priority": "high",
      },
      providerOptions: {
        location: "us-central1",
      },
    });
  });

  it("serializes Vertex settings into providerConfig and strips top-level legacy fields", () => {
    const result = toApiModelClientOptions(
      {
        project: "legacy-project",
        location: "global",
        headers: {
          "x-top-level": "kept-in-provider-config",
        },
      },
      "vertex/gemini-2.5-pro",
    );

    expect(result).toEqual({
      providerConfig: {
        provider: "vertex",
        options: {
          project: "legacy-project",
          location: "global",
          headers: {
            "x-top-level": "kept-in-provider-config",
          },
        },
      },
    });
  });

  it("rejects providerOptions for unsupported providers", () => {
    expect(() =>
      toApiModelClientOptions(
        {
          providerOptions: {
            region: "us-east-1",
          },
        },
        "openai/gpt-4.1-mini",
      ),
    ).toThrow(StagehandInvalidArgumentError);
  });
});
