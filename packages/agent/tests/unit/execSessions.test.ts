import { describe, expect, test } from "vitest";
import { ProcessSessionManager } from "../../lib/processSessions.js";

describe("ProcessSessionManager", () => {
  test("returns completed command output when the process exits quickly", async () => {
    const sessions = new ProcessSessionManager();
    const result = await sessions.exec({
      cmd: "printf 'hello world'",
      yield_time_ms: 50,
    });

    expect(result.running).toBe(false);
    expect(result.stdout).toContain("hello world");
    expect(result.exit_code).toBe(0);
  });
});
