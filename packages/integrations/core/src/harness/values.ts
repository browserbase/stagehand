function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

export function sliceUtf16Safe(value: string, maxLength: number): string {
  if (!Number.isFinite(maxLength) || maxLength <= 0) return "";
  const limit = Math.floor(maxLength);
  if (limit >= value.length) return value;
  const end =
    limit > 0 &&
    isHighSurrogate(value.charCodeAt(limit - 1)) &&
    isLowSurrogate(value.charCodeAt(limit))
      ? limit - 1
      : limit;
  return value.slice(0, end);
}

/** Any non-null object, arrays included — unlike the stricter non-array guards in the
 * facade tools and the cursor adapter. Check `Array.isArray` first where it matters. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Plain `JSON.stringify` that returns `undefined` on failure. It does not redact; pass
 * strings through `sanitizeErrorMessage` where secrets may appear. */
export function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

export function stringifyError(value: unknown): string {
  if (!value) return "";
  if (value instanceof Error) {
    try {
      return typeof value.message === "string" ? value.message : "[Unserializable error]";
    } catch {
      return "[Unserializable error]";
    }
  }
  if (typeof value === "string") return value;
  const json = safeJson(value);
  if (json !== undefined) return json;
  if (typeof value === "object") {
    try {
      const candidate = (value as { toString?: unknown }).toString;
      if (typeof candidate === "function") {
        const text: unknown = Reflect.apply(candidate, value, []);
        if (typeof text === "string") return text;
      }
      return Object.prototype.toString.call(value);
    } catch {
      return "[Unserializable error]";
    }
  }
  if (typeof value === "function") {
    try {
      const candidate = (value as { toString?: unknown }).toString;
      if (typeof candidate === "function") {
        const text: unknown = Reflect.apply(candidate, value, []);
        if (typeof text === "string") return text;
      }
      return Function.prototype.toString.call(value);
    } catch {
      return "[Unserializable error]";
    }
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }
  return "";
}

export function clip(value: string, maxLength: number): string {
  if (!Number.isFinite(maxLength) || maxLength <= 0) return "";
  const limit = Math.floor(maxLength);
  if (limit <= 0) return "";
  if (value.length <= limit) return value;
  if (limit === 1) return "…";
  return `${sliceUtf16Safe(value, limit - 1)}…`;
}

export function toFiniteNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isTokenCount(value: unknown): boolean {
  return (
    ((typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value)))) &&
    Number(value) >= 0
  );
}

export function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : fallback;
}
