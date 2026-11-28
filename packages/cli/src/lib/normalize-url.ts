export function normalizeUrlScheme(input: string): string {
  if (hasScheme(input)) return input;
  if (!looksLikeHost(input)) return input;
  const scheme = needsHttp(input) ? "http://" : "https://";
  const candidate = scheme + input;
  if (!URL.canParse(candidate)) return input;
  const parsed = new URL(candidate);
  if (!parsed.hostname || parsed.hostname.startsWith(".")) return input;
  return candidate;
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

function isIpv4Host(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function isDomainHost(host: string): boolean {
  if (host.startsWith(".") || host.includes("..") || host.includes("@")) return false;
  const trimmed = host.endsWith(".") ? host.slice(0, -1) : host;
  const labels = trimmed.split(".");
  if (labels.length < 2) return false;
  if (labels.some((label) => label.length === 0)) return false;
  if (/^\d+$/.test(labels[labels.length - 1]!)) return false;
  return true;
}

function looksLikeHost(input: string): boolean {
  if (/\s/.test(input)) return false;
  const host = extractHost(input);
  if (host === "localhost") return true;
  if (isIpv4Host(host)) return true;
  return isDomainHost(host);
}

function needsHttp(input: string): boolean {
  const host = extractHost(input);
  return host === "localhost" || host === "127.0.0.1";
}
