import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { saveCodexDiagnostic } from "../src/diagnostics.js";
import { safeJson } from "../src/session.js";

describe("Codex stream diagnostics", () => {
  it("preserves the rejected event and parser cause beyond clipped logs", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-diagnostic-test-"));
    try {
      const raw = '{"type":"item.completed","text":"' + "🏡".repeat(2000);
      const file = await saveCodexDiagnostic(
        directory,
        new Error(`Failed to parse item: ${raw}`, {
          cause: new SyntaxError("Unterminated string"),
        }),
        26,
      );
      const result = JSON.parse(await fs.readFile(file, "utf8"));
      expect(result.rejectedEvent).toBe(raw);
      expect(result.cause).toContain("Unterminated string");
      expect(result.truncated).toBe(false);
      expect(result.eventCount).toBe(26);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps images out of telemetry without mutating original events", () => {
    const data = "a".repeat(10000);
    const event = { type: "image", data };
    expect(safeJson(event)).toContain("binary omitted");
    expect(event.data).toBe(data);
  });
});
