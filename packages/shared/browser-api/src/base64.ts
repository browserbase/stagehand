// Keep character-class validation linear (length % 4 === 0 enforces quartet alignment)
// so V8 regex backtracking does not overflow the call stack on large captures.
const BASE64_PATTERN = /^[A-Za-z\d+/]*={0,2}$/;

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
