import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let cleaned = false;
vi.mock("../../framework/agentToolRuntime.js", () => ({
  startAgentToolRuntime: async () => ({
    running: {
      callTool: async (name: string) => {
        calls.push(name);
        return {
          content: [{ type: "text", text: `called ${name}` }],
          isError: name === "screenshot",
        };
      },
      captureEvidence: async () => ({ url: "https://example.com" }),
    },
    cleanup: async () => {
      cleaned = true;
    },
  }),
}));

import { prepareUnrealAgentToolAdapter } from "../../framework/unrealAgentToolAdapter.js";

const run = promisify(execFile);

describe("Unreal Agent facade command", () => {
  it("forwards each allowed tool and records evidence", async () => {
    calls.length = 0;
    cleaned = false;
    const adapter = await prepareUnrealAgentToolAdapter({
      environment: "LOCAL",
      plan: {} as never,
      logger: {} as never,
    });
    try {
      for (const name of ["snapshot", "screenshot", "run"]) {
        const args = name === "run" ? [name, "return 1"] : [name];
        if (name === "screenshot") {
          await expect(
            run(`${adapter.cwd}/facade`, args, { cwd: adapter.cwd, env: adapter.env }),
          ).rejects.toMatchObject({ code: 1 });
        } else {
          const result = await run(`${adapter.cwd}/facade`, args, {
            cwd: adapter.cwd,
            env: adapter.env,
          });
          expect(result.stdout).toContain(`called ${name}`);
        }
      }
      expect(calls).toEqual(["snapshot", "screenshot", "run"]);
      expect(adapter.facadeCalls).toHaveLength(3);
      expect(await adapter.drainStepObservations()).toHaveLength(3);
      await expect(
        run(`${adapter.cwd}/facade`, ["other"], { cwd: adapter.cwd, env: adapter.env }),
      ).rejects.toThrow();
    } finally {
      await adapter.cleanup();
    }
    expect(cleaned).toBe(true);
  });
});
