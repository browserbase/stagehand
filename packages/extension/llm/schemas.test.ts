import { describe, expect, it } from "vite-plus/test";
import { ChatCompletionOptionsSchema } from "./schemas.js";

describe("ChatCompletionOptionsSchema", () => {
  it("uses the AI SDK retry default", () => {
    expect(ChatCompletionOptionsSchema.parse({ messages: [] }).maxRetries).toBe(2);
  });

  it("accepts nonnegative integer retry counts", () => {
    expect(ChatCompletionOptionsSchema.parse({ messages: [], maxRetries: 0 }).maxRetries).toBe(0);
    expect(ChatCompletionOptionsSchema.parse({ messages: [], maxRetries: 4 }).maxRetries).toBe(4);
  });

  it("rejects invalid retry counts and removed generation settings", () => {
    expect(() => ChatCompletionOptionsSchema.parse({ messages: [], maxRetries: -1 })).toThrow();
    expect(() => ChatCompletionOptionsSchema.parse({ messages: [], maxRetries: 1.5 })).toThrow();
    expect(() => ChatCompletionOptionsSchema.parse({ messages: [], temperature: 0 })).toThrow();
  });
});
