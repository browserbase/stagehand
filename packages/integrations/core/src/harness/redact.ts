export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  sanitized = sanitized.replace(
    /([?&](?:signingKey|apiKey|api_key|token|key)=)[^&\s"']+/gi,
    "$1[redacted]",
  );
  sanitized = sanitized.replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, "$1[redacted]");
  sanitized = sanitized.replace(
    /\b(bb_(?:live|test)_[A-Za-z0-9]{4})[A-Za-z0-9_-]+/g,
    "$1[redacted]",
  );
  sanitized = sanitized.replace(/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza[redacted]");
  return sanitized.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]");
}
