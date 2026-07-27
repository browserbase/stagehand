import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodePng, paeth, unfilterByte } from "./png.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}

function png(options: {
  width?: number;
  height?: number;
  bitDepth?: number;
  interlace?: number;
  imageData?: Buffer;
}): Buffer {
  const width = options.width ?? 2;
  const height = options.height ?? 2;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = options.bitDepth ?? 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = options.interlace ?? 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", options.imageData ?? Buffer.alloc(0)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function filteredImage(filter: number, pixels: Buffer, width: number, height: number): Buffer {
  const channels = 4;
  const stride = width * channels;
  const filtered = Buffer.alloc((stride + 1) * height);
  let output = 0;

  for (let y = 0; y < height; y += 1) {
    filtered[output++] = filter;
    for (let x = 0; x < stride; x += 1) {
      const offset = y * stride + x;
      const left = x >= channels ? (pixels[offset - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[offset - stride] ?? 0) : 0;
      const upperLeft = y > 0 && x >= channels ? (pixels[offset - stride - channels] ?? 0) : 0;
      const predictor =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : filter === 4
                ? paeth(left, up, upperLeft)
                : 0;
      filtered[output++] = ((pixels[offset] ?? 0) - predictor) & 0xff;
    }
  }

  return deflateSync(filtered);
}

describe("PNG screenshot decoder", () => {
  it.each([0, 1, 2, 3, 4])("reconstructs filter type %s", (filter) => {
    const pixels = Buffer.from([
      240, 100, 20, 255, 210, 80, 10, 240, 200, 70, 5, 230, 180, 60, 0, 220,
    ]);
    const decoded = decodePng(png({ imageData: filteredImage(filter, pixels, 2, 2) }));

    expect(decoded).toMatchObject({ width: 2, height: 2, channels: 4 });
    expect(decoded.pixels).toStrictEqual(pixels);
  });

  it("applies each byte filter and Paeth tie-breaking", () => {
    expect([0, 1, 2, 3, 4].map((filter) => unfilterByte(filter, 10, 20, 30, 15))).toEqual([
      10, 30, 40, 35, 40,
    ]);
    expect(paeth(10, 10, 10)).toBe(10);
    expect(paeth(10, 30, 0)).toBe(30);
    expect(() => unfilterByte(5, 0, 0, 0, 0)).toThrow("Unsupported PNG filter: 5");
  });

  it.each([
    ["16-bit depth", { bitDepth: 16, imageData: deflateSync(Buffer.alloc(18)) }],
    ["interlacing", { interlace: 1, imageData: deflateSync(Buffer.alloc(18)) }],
    ["an empty image", { width: 0, imageData: deflateSync(Buffer.alloc(1)) }],
  ])("rejects %s", (_name, options) => {
    expect(() => decodePng(png(options))).toThrow(TypeError);
  });

  it("rejects truncated image data", () => {
    const compressed = filteredImage(0, Buffer.alloc(16), 2, 2);
    expect(() => decodePng(png({ imageData: compressed.subarray(0, 3) }))).toThrow();
  });
});
