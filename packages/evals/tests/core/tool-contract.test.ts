import { describe, expect, it } from "vitest";
import type {
  AgentMount,
  CoreSession,
  CoreTool,
  ToolStartResult,
} from "../../core/contracts/tool.js";

describe("tool surface contract", () => {
  it("keeps native surface and agent delivery independent", async () => {
    const screenshot = Buffer.from("surface screenshot");
    const cliMount = {
      via: "cli",
      promptInstructions: "Use the wrapper command.",
      command: { bin: "stagehand-browser", env: {} },
    } satisfies AgentMount;

    const runningCodeSurface: ToolStartResult = {
      session: {} as CoreSession,
      agentMount: cliMount,
      captureEvidence: async () => ({
        screenshot,
        url: "https://example.com",
        ariaTree: "- document\n  - heading: Example",
      }),
      cleanup: async () => {},
      metadata: {
        environment: "local",
        browserOwnership: "tool",
        connectionMode: "launch",
      },
    };

    const codeSurface: CoreTool = {
      id: "playwright_code",
      surface: "code",
      family: "playwright",
      supportedStartupProfiles: [],
      supportedCapabilities: [],
      supportedTargetKinds: [],
      start: async () => runningCodeSurface,
    };

    expect(codeSurface.surface).toBe("code");
    expect(runningCodeSurface.agentMount?.via).toBe("cli");
    await expect(runningCodeSurface.captureEvidence?.()).resolves.toEqual({
      screenshot,
      url: "https://example.com",
      ariaTree: "- document\n  - heading: Example",
    });
  });

  it("describes injected handles without harness-owned task bindings", () => {
    const mount = {
      via: "handles",
      promptInstructions: "Use the run tool.",
      handles: { page: {} },
      runTool: {
        description: "Run browser code.",
        codeParamDescription: "JavaScript to execute.",
        denyMessage: "Use the run tool.",
      },
    } satisfies AgentMount;

    expect(mount.via).toBe("handles");
  });

  it("requires delivery-specific fields at compile time", () => {
    // @ts-expect-error CLI mounts require a command.
    const invalidMount: AgentMount = {
      via: "cli",
      promptInstructions: "Use the CLI.",
    };

    expect(invalidMount.via).toBe("cli");
  });
});
