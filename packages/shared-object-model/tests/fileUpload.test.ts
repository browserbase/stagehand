import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { normalizeFileInput } from "../src/fileUpload.js";

it("encodes cross-realm buffers and preserves typed-array slices", async () => {
  const [buffer, slice] = runInNewContext(`[
    new Uint8Array([0, 127, 255]).buffer,
    new Uint8Array([42, 0, 127, 255, 42]).subarray(1, 4),
  ]`) as [ArrayBuffer, Uint8Array];

  await expect(
    normalizeFileInput([
      { name: "buffer.bin", buffer },
      { name: "slice.bin", buffer: slice },
    ]),
  ).resolves.toEqual([
    { name: "buffer.bin", data: "AH//" },
    { name: "slice.bin", data: "AH//" },
  ]);
});
