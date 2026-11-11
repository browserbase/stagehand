const BASE64_PATTERN = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/;

export function decodeBase64(value: string, source: string): Uint8Array {
  if (value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) {
    throw new Error(`${source} returned invalid base64`);
  }

  let binary: string;
  try {
    binary = globalThis.atob(value);
  } catch {
    throw new Error(`${source} returned invalid base64`);
  }
  if (globalThis.btoa(binary) !== value) {
    throw new Error(`${source} returned invalid base64`);
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
