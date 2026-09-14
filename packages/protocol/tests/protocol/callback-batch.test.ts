import { describe, expect, it } from "vitest";
import { StagehandMethods, StagehandRpcRequestSchema } from "../../schema-registry.js";
import {
  CallbackBatchOptionsSchema,
  CallbackBatchResultSchema,
  MAX_CALLBACK_BATCH_TIMEOUT_MS,
} from "../../schemas.js";

describe("callback batch protocol", () => {
  it("registers a wire-safe Stagehand request", () => {
    expect(
      StagehandRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 8,
        method: "stagehand.callback_batch",
        params: {
          callback_source: "async () => undefined",
          input: { id: 7 },
          options: { page_id: "page-1", timeout: 2_000 },
        },
      }),
    ).toMatchObject({
      method: StagehandMethods.stagehandCallbackBatch.name,
      params: {
        callbackSource: "async () => undefined",
        input: { id: 7 },
        options: { pageId: "page-1", timeout: 2_000 },
      },
    });
  });

  it("represents undefined by omitting the result value", () => {
    expect(CallbackBatchResultSchema.parse({})).toEqual({});
    expect(CallbackBatchResultSchema.parse({ value: null })).toEqual({
      value: null,
    });
    expect(CallbackBatchResultSchema.safeParse({ ok: true }).success).toBe(false);
  });

  it("reserves the RPC grace period below Chromium's maximum timer delay", () => {
    expect(
      CallbackBatchOptionsSchema.parse({ timeout: MAX_CALLBACK_BATCH_TIMEOUT_MS }).timeout,
    ).toBe(MAX_CALLBACK_BATCH_TIMEOUT_MS);
    expect(
      CallbackBatchOptionsSchema.safeParse({ timeout: MAX_CALLBACK_BATCH_TIMEOUT_MS + 1 }).success,
    ).toBe(false);
  });
});
