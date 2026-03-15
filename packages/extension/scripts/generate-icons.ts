/**
 * Generate placeholder extension icons as simple colored squares.
 * In production, these would be replaced with proper Stagehand branding.
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { deflateSync } from "zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const iconsDir = resolve(__dirname, "..", "icons");

mkdirSync(iconsDir, { recursive: true });

function createPng(size: number, r: number, g: number, b: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // RGB
  const ihdr = makeChunk("IHDR", ihdrData);

  // Raw pixel data: each row starts with filter byte 0, then RGB triplets
  const rowSize = 1 + size * 3;
  const raw = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y++) {
    const off = y * rowSize;
    raw[off] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = off + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const compressed = deflateSync(raw);
  const idat = makeChunk("IDAT", compressed);

  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Stagehand brand color (#e94560)
for (const size of [16, 32, 48, 128]) {
  const png = createPng(size, 233, 69, 96);
  const path = resolve(iconsDir, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`Generated ${path} (${size}x${size})`);
}
