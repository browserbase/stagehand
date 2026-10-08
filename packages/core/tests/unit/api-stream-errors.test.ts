import { describe, expect, it, vi } from "vitest";

import { StagehandAPIClient } from "../../lib/v3/api.js";
import { StagehandHttpError } from "../../lib/v3/types/public/apiErrors.js";

describe("StagehandAPIClient streamed errors", () => {
  it("preserves the status code sent in a system error event", async () => {
    const client = new StagehandAPIClient({
      apiKey: "bb-test",
      logger: vi.fn(),
    });
    const apiClient = client as unknown as {
      execute: (args: { method: "act" }) => Promise<unknown>;
      request: () => Promise<Response>;
      sessionId: string;
    };
    apiClient.sessionId = "session-test";
    apiClient.request = async () =>
      new Response(
        `data: ${JSON.stringify({
          type: "system",
          data: {
            status: "error",
            error: "Payment required",
            statusCode: 402,
          },
        })}\n\n`,
      );

    await expect(apiClient.execute({ method: "act" })).rejects.toMatchObject({
      message: "Payment required",
      statusCode: 402,
    });

    await expect(apiClient.execute({ method: "act" })).rejects.toBeInstanceOf(
      StagehandHttpError,
    );
  });
});
