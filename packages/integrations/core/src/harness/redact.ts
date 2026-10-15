export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  // stdio-server and codexCodeBridge: credential-bearing URL query parameters.
  sanitized = sanitized.replace(
    /([?&](?:signingKey|apiKey|api_key|token|key)=)[^&\s"']+/gi,
    "$1[redacted]",
  );
  // stdio-server and codexCodeBridge: OpenAI-style secret keys.
  sanitized = sanitized.replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, "$1[redacted]");
  // stdio-server: Browserbase live and test keys.
  sanitized = sanitized.replace(
    /\b(bb_(?:live|test)_[A-Za-z0-9]{4})[A-Za-z0-9_-]+/g,
    "$1[redacted]",
  );
  // Groq secret keys (gsk_...).
  sanitized = sanitized.replace(/\b(gsk_[A-Za-z0-9]{4})[A-Za-z0-9]+/g, "$1[redacted]");
  // Cerebras secret keys (csk-...).
  sanitized = sanitized.replace(/\b(csk-[A-Za-z0-9]{4})[A-Za-z0-9]+/g, "$1[redacted]");
  // xAI secret keys (xai-...).
  sanitized = sanitized.replace(/\b(xai-[A-Za-z0-9]{4})[A-Za-z0-9]+/g, "$1[redacted]");
  // stdio-server: Google API keys.
  sanitized = sanitized.replace(/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza[redacted]");
  // stdio-server: bearer authorization values.
  return sanitized.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]");
}
