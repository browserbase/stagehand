import { describe, it } from "node:test";

import {
  assertFetchOk,
  assertFetchStatus,
  fetchWithContext,
  getBaseUrl,
  getHeaders,
  HTTP_OK,
} from "../utils.js";

interface ReplayResponseBody {
  success: boolean;
  data?: {
    pages: Array<{
      url: string;
      timestamp: number;
      duration: number;
      actions: Array<{
        method: string;
        parameters: Record<string, unknown>;
        result: Record<string, unknown>;
        timestamp: number;
        endTime?: number;
        tokenUsage?: {
          inputTokens?: number;
          outputTokens?: number;
          timeMs?: number;
          cost?: number;
        };
      }>;
    }>;
    clientLanguage?: string;
  };
}

describe("GET /v1/sessions/:id/replay (V3)", () => {
  it("should return an empty replay result for local server", async () => {
    const url = getBaseUrl();
    const headers = getHeaders("3.0.0");

    const ctx = await fetchWithContext<ReplayResponseBody>(
      `${url}/v1/sessions/test-session-id/replay`,
      {
        method: "GET",
        headers,
      },
    );

    assertFetchStatus(ctx, HTTP_OK, "Replay should return 200");
    assertFetchOk(ctx.body !== null, "Response should have body", ctx);
    assertFetchOk(ctx.body.success, "Response should indicate success", ctx);
    assertFetchOk(
      ctx.body.data !== undefined,
      "Response should include data",
      ctx,
    );
    assertFetchOk(
      Array.isArray(ctx.body.data.pages),
      "Replay pages should be an array",
      ctx,
    );
    assertFetchOk(
      ctx.body.data.pages.length === 0,
      "Replay pages should be empty on local server",
      ctx,
    );
  });
});
