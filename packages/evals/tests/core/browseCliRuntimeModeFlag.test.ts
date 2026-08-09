import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvalLogger } from "../../logger.js";

type ExecFileCallback = (
  error: Error | null,
  result: { stdout: string; stderr: string },
) => void;

const execFileMock = vi.fn(
  (
    _file: string,
    _args: string[],
    _options: unknown,
    callback: ExecFileCallback,
  ) => {
    callback(null, { stdout: "{}", stderr: "" });
  },
);

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) =>
    (
      execFileMock as unknown as (
        ...callArgs: unknown[]
      ) => ReturnType<typeof execFileMock>
    )(...args),
}));

const { BrowseCliTool } = await import("../../core/tools/browse_cli.js");

function lastArgv(): string[] {
  const call = execFileMock.mock.calls.at(-1);
  if (!call) throw new Error("execFile was not called");
  // call[1][0] is the browse CLI entrypoint script path (execFile's "file" is
  // process.execPath, i.e. node); everything after it is the actual CLI argv.
  return (call[1] as string[]).slice(1);
}

describe("BrowseCliRuntime mode flag injection", () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it("appends --local to a modeful command (tab list)", async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      (callback as ExecFileCallback)(null, {
        stdout: JSON.stringify({ tabs: [] }),
        stderr: "",
      });
    });

    const { session, cleanup } = await new BrowseCliTool().start({
      startupProfile: "tool_launch_local",
      environment: "LOCAL",
      logger: new EvalLogger(false),
    });

    await session.listPages();

    const argv = lastArgv();
    expect(argv.slice(0, 2)).toEqual(["tab", "list"]);
    expect(argv).toContain("--local");
    expect(argv).not.toContain("--remote");

    await cleanup();
  });

  it("omits the mode flag for a modeless command (stop)", async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      (callback as ExecFileCallback)(null, {
        stdout: JSON.stringify({ tabs: [] }),
        stderr: "",
      });
    });

    const { session } = await new BrowseCliTool().start({
      startupProfile: "tool_launch_local",
      environment: "LOCAL",
      logger: new EvalLogger(false),
    });

    execFileMock.mockClear();
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      (callback as ExecFileCallback)(null, {
        stdout: JSON.stringify({ stopped: true }),
        stderr: "",
      });
    });

    await session.close();

    const argv = lastArgv();
    expect(argv[0]).toBe("stop");
    expect(argv).not.toContain("--local");
    expect(argv).not.toContain("--remote");
  });

  it("uses --remote for a BROWSERBASE session", async () => {
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      (callback as ExecFileCallback)(null, {
        stdout: JSON.stringify({ tabs: [] }),
        stderr: "",
      });
    });

    const { session, cleanup } = await new BrowseCliTool().start({
      startupProfile: "tool_create_browserbase",
      environment: "BROWSERBASE",
      logger: new EvalLogger(false),
    });

    await session.listPages();

    const argv = lastArgv();
    expect(argv).toContain("--remote");
    expect(argv).not.toContain("--local");

    await cleanup();
  });
});
