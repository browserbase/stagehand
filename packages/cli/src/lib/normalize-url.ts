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

function extractHost(input: string): string {
  return input.split(/[/:?#]/)[0]!.toLowerCase();
}

function looksLikeHost(input: string): boolean {
  if (input.includes(" ")) return false;
  const host = extractHost(input);
  if (host === "localhost") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(".")) return true;
  return false;
}

function needsHttp(input: string): boolean {
  const host = extractHost(input);
  return host === "localhost" || host === "127.0.0.1";
}
