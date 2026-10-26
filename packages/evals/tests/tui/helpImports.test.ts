import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCommandTree, dispatch } from "../../tui/commandTree.js";

vi.mock("../../framework/benchHarness.js", () => {
  throw new Error("Help must not initialize the harness runtime");
});
vi.mock("../../core/tools/registry.js", () => {
  throw new Error("Help must not initialize the tool runtime");
});

afterEach(() => vi.restoreAllMocks());

describe("help without runtime imports", () => {
  it.each([
    { args: ["--help"], expected: "Commands:" },
    { args: ["list", "--help"], expected: "evals list" },
    { args: ["new", "--help"], expected: "evals new" },
    { args: ["experiments", "--help"], expected: "evals experiments" },
    { args: ["config", "tracing", "--help"], expected: "evals config tracing" },
  ])("prints $args with harness and tool modules unavailable", async ({ args, expected }) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const getRegistry = vi.fn(async () => {
      throw new Error("Help must not discover tasks");
    });
    await dispatch(buildCommandTree(), args, {
      entryDir: "/unused",
      getRegistry,
      setRegistry: vi.fn(),
      abortRef: null,
      contextPath: null,
    });
    expect(log.mock.calls.flat().join("\n")).toContain(expected);
    expect(getRegistry).not.toHaveBeenCalled();
  });
});
