export async function downloadCover(
  url: URL,
  fetchCover: typeof fetch = fetch,
): Promise<Uint8Array> {
  if (
    url.protocol !== "https:" ||
    url.hostname !== "books.toscrape.com" ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error("Cover URL must be HTTPS on books.toscrape.com");
  const response = await fetchCover(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) throw new Error(`Cover download failed: ${response.status}`);
  if (!response.headers.get("content-type")?.split(";")[0].trim().startsWith("image/"))
    throw new Error("Cover response is not an image");
  const maxBytes = 5 * 1024 * 1024;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw new Error("Cover exceeds the 5 MiB download limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    throw new Error("Cover is not a JPEG");
  return bytes;
}
