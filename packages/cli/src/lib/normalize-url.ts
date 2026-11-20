/**
 * Normalizes a URL-like string by adding a scheme if it looks like a bare host.
 *
 * Returns the input unchanged if it already has a scheme, contains spaces,
 * or doesn't look like a valid host (no dots, not localhost, not an IP).
 *
 * Uses http:// for localhost and 127.0.0.1, https:// for everything else.
 */
export function normalizeUrlScheme(input: string): string {
  if (hasScheme(input)) return input;
  if (!looksLikeHost(input)) return input;
  const scheme = needsHttp(input) ? "http://" : "https://";
  return scheme + input;
}

function hasScheme(input: string): boolean {
  const match = input.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!match) return false;
  const afterColon = input.slice(match[0].length);
  if (/^\d+($|[/?#])/.test(afterColon)) return false;
  return true;
}

function looksLikeHost(input: string): boolean {
  if (input.includes(" ")) return false;
  const hostPart = input.split("/")[0]!.split(":")[0]!;
  if (hostPart === "localhost") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostPart)) return true;
  if (hostPart.includes(".")) return true;
  return false;
}

function needsHttp(input: string): boolean {
  const hostPart = input.split("/")[0]!.split(":")[0]!;
  return hostPart === "localhost" || hostPart === "127.0.0.1";
}
