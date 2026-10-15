export function decodeBase64(value: string, source: string): Uint8Array {
  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    throw new Error(`${source} returned invalid base64`);
  }
  // atob accepts noncanonical input; require the standard padded representation.
  if (globalThis.btoa(binary) !== value) {
    throw new Error(`${source} returned invalid base64`);
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
