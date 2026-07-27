import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type DecodedPng = {
  width: number;
  height: number;
  channels: number;
  pixels: Buffer;
};

export function screenshotHasOrangeViewportEdge(png: Buffer): boolean {
  const { width, height, channels, pixels } = decodePng(png);
  const band = Math.max(2, Math.min(24, Math.floor(Math.min(width, height) / 20)));
  let edgePixels = 0;
  let orangePixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      edgePixels += 1;
      const offset = (y * width + x) * channels;
      const red = pixels[offset] ?? 0;
      const green = pixels[offset + 1] ?? 0;
      const blue = pixels[offset + 2] ?? 0;
      if (red >= 190 && green <= 200 && blue <= 160 && red - green >= 35) {
        orangePixels += 1;
      }
    }
  }

  return orangePixels >= Math.max(50, Math.floor(edgePixels * 0.005));
}

export function decodePng(png: Buffer): DecodedPng {
  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new TypeError("Expected a PNG screenshot");
  }

  let width = 0;
  let height = 0;
  let channels = 0;
  const imageData: Buffer[] = [];

  for (let offset = PNG_SIGNATURE.length; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new TypeError("Unsupported PNG screenshot format");
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (width === 0 || height === 0 || channels === 0 || imageData.length === 0) {
    throw new TypeError("PNG screenshot is missing image data");
  }

  const filtered = inflateSync(Buffer.concat(imageData));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = filtered[inputOffset++] ?? -1;
    const rowOffset = y * stride;
    const previousRowOffset = rowOffset - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = filtered[inputOffset++] ?? 0;
      const left = x >= channels ? (pixels[rowOffset + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[previousRowOffset + x] ?? 0) : 0;
      const upperLeft =
        y > 0 && x >= channels ? (pixels[previousRowOffset + x - channels] ?? 0) : 0;
      pixels[rowOffset + x] = unfilterByte(filter, value, left, up, upperLeft);
    }
  }

  return { width, height, channels, pixels };
}

export function unfilterByte(
  filter: number,
  value: number,
  left: number,
  up: number,
  upperLeft: number,
): number {
  switch (filter) {
    case 0:
      return value;
    case 1:
      return (value + left) & 0xff;
    case 2:
      return (value + up) & 0xff;
    case 3:
      return (value + Math.floor((left + up) / 2)) & 0xff;
    case 4:
      return (value + paeth(left, up, upperLeft)) & 0xff;
    default:
      throw new TypeError(`Unsupported PNG filter: ${filter}`);
  }
}

export function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}
