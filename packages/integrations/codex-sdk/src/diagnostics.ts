import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";

export async function saveCodexDiagnostic(
  directory: string,
  error: unknown,
  eventCount: number,
): Promise<string> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error.cause : undefined;
  const filename = path.join(directory, `${Date.now()}-${randomUUID()}.json`);
  const sanitized = sanitizeErrorMessage(message);
  const maxChars = 2_000_000;
  const marker = "Failed to parse item: ";
  const rejectedEvent = sanitized.startsWith(marker) ? sanitized.slice(marker.length) : undefined;
  await fs.writeFile(
    filename,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        eventCount,
        message: sanitized.slice(0, maxChars),
        truncated: sanitized.length > maxChars,
        cause: cause ? sanitizeErrorMessage(String(cause)).slice(0, 16_000) : undefined,
        rejectedEvent: rejectedEvent?.slice(0, maxChars),
        stack:
          error instanceof Error
            ? sanitizeErrorMessage(error.stack ?? "").slice(0, 16_000)
            : undefined,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  return filename;
}
