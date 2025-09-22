import sharp from "sharp";

export async function imageResize(
  img: Buffer,
  scaleFactor: number,
): Promise<Buffer> {
  const metadata = await sharp(img).metadata();
  // calculate new dimensions
  const width = Math.round(metadata.width * scaleFactor);
  const height = Math.round(metadata.height * scaleFactor);
  return await sharp(img)
    .resize(width, height, { fit: "inside", kernel: sharp.kernel.lanczos3 })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: true,
    })
    .toBuffer();
}
