import { describe, expect, it } from "vitest";
import { messageDataToString } from "../src/cdpClient.js";

describe("CDP WebSocket message decoding", () => {
  it("decodes every web-standard WebSocket binary representation", async () => {
    const text = '{"id":1,"result":{}}';
    const bytes = new TextEncoder().encode(text);

    await expect(messageDataToString(text)).resolves.toBe(text);
    await expect(messageDataToString(bytes.buffer)).resolves.toBe(text);
    await expect(messageDataToString(bytes)).resolves.toBe(text);
    await expect(messageDataToString(new DataView(bytes.buffer))).resolves.toBe(text);
    await expect(messageDataToString(new Blob([bytes]))).resolves.toBe(text);
  });

  it("rejects unsupported WebSocket message values", async () => {
    await expect(messageDataToString({ text: "not websocket data" })).rejects.toThrow(
      "unsupported message type",
    );
  });
});
