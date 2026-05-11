import { describe, expect, it, vi } from "vitest";
import {
  dispatch,
  findChild,
  resolveCommand,
  tokenizeArgv,
  walkPath,
  type CommandContext,
  type CommandNode,
} from "../../tui/commandTree.js";
import { tokenize } from "../../tui/tokenize.js";
import type { TaskRegistry } from "../../framework/types.js";

// ---------------------------------------------------------------------------
// Fake tree — keeps tests independent of the real handlers.
// ---------------------------------------------------------------------------

function makeTree(
  handlers: Record<string, ReturnType<typeof vi.fn>>,
): CommandNode {
  const compare: CommandNode = {
    name: "compare",
    summary: "compare experiments",
    handler: handlers.compare,
  };
  const list: CommandNode = {
    name: "list",
    summary: "list experiments",
    handler: handlers.expList,
  };
  const experiments: CommandNode = {
    name: "experiments",
    summary: "experiments namespace",
    handler: handlers.experiments,
    children: [list, compare],
  };
  const configPath: CommandNode = {
    name: "path",
    summary: "config path",
    handler: handlers.configPath,
  };
  const configCorePath: CommandNode = {
    name: "path",
    summary: "core path",
    handler: handlers.corePath,
  };
  const configCore: CommandNode = {
    name: "core",
    summary: "config core",
    handler: handlers.configCore,
    children: [configCorePath],
  };
  const config: CommandNode = {
    name: "config",
    summary: "config namespace",
    handler: handlers.config,
    children: [configPath, configCore],
  };
  const run: CommandNode = {
    name: "run",
    summary: "run evals",
    handler: handlers.run,
  };
  const rootHelp = handlers.rootHelp;
  return {
    name: "evals",
    summary: "root",
    printHelp: rootHelp,
    children: [run, config, experiments],
  };
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  const contextPath: string[] = [];
  return {
    entryDir: "/tmp/fake",
    getRegistry: async () => ({ tasks: [] }) as unknown as TaskRegistry,
    setRegistry: () => {},
    abortRef: { current: null },
    contextPath,
    pushContext: (s) => contextPath.push(s),
    popContext: () => {
      contextPath.pop();
    },
    setContextPath: (path) => {
      contextPath.length = 0;
      for (const p of path) contextPath.push(p);
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("run act --trials 3")).toEqual([
      "run",
      "act",
      "--trials",
      "3",
    ]);
  });

  it("treats `>` as a separator outside quotes", () => {
    expect(tokenize("experiments > list")).toEqual(["experiments", "list"]);
    expect(tokenize("experiments>list")).toEqual(["experiments", "list"]);
    expect(tokenize("config > core > path")).toEqual([
      "config",
      "core",
      "path",
    ]);
  });

  it("collapses runs of `>` and whitespace", () => {
    expect(tokenize("experiments > > list")).toEqual(["experiments", "list"]);
    expect(tokenize("  experiments   >   list  ")).toEqual([
      "experiments",
      "list",
    ]);
  });

  it("preserves `>` inside quoted strings", () => {
    expect(tokenize(`run "foo > bar" --extra`)).toEqual([
      "run",
      "foo > bar",
      "--extra",
    ]);
    expect(tokenize(`run 'a>b'`)).toEqual(["run", "a>b"]);
  });

  it("returns an empty array for empty input or pure separators", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize(" > > ")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tokenizeArgv
// ---------------------------------------------------------------------------

describe("tokenizeArgv", () => {
  it("passes through args without `>`", () => {
    expect(tokenizeArgv(["run", "act", "--trials", "3"])).toEqual([
      "run",
      "act",
      "--trials",
      "3",
    ]);
  });

  it("drops standalone `>` tokens", () => {
    expect(tokenizeArgv(["experiments", ">", "list"])).toEqual([
      "experiments",
      "list",
    ]);
  });

  it("splits args containing `>`", () => {
    expect(tokenizeArgv(["experiments>list"])).toEqual(["experiments", "list"]);
    expect(tokenizeArgv(["config>core>path"])).toEqual([
      "config",
      "core",
      "path",
    ]);
  });
});

// ---------------------------------------------------------------------------
// findChild + walkPath
// ---------------------------------------------------------------------------

describe("findChild + walkPath", () => {
  const tree = makeTree({} as never);

  it("finds children by name", () => {
    expect(findChild(tree, "experiments")?.name).toBe("experiments");
    expect(findChild(tree, "EXPERIMENTS")?.name).toBe("experiments");
    expect(findChild(tree, "missing")).toBeUndefined();
  });

  it("walks a path of segments", () => {
    expect(walkPath(tree, []).name).toBe("evals");
    expect(walkPath(tree, ["experiments"]).name).toBe("experiments");
    expect(walkPath(tree, ["config", "core"]).name).toBe("core");
  });

  it("returns the deepest valid node for partial paths", () => {
    // "missing" doesn't exist as a child of "config" — bail at config.
    expect(walkPath(tree, ["config", "missing"]).name).toBe("config");
  });
});

// ---------------------------------------------------------------------------
// resolveCommand
// ---------------------------------------------------------------------------

describe("resolveCommand", () => {
  const tree = makeTree({} as never);

  it("returns noop on empty tokens", () => {
    expect(resolveCommand(tree, [], [])).toEqual({ kind: "noop" });
  });

  it("recognizes meta tokens at any depth", () => {
    expect(resolveCommand(tree, [], [".."])).toEqual({
      kind: "meta",
      name: "back",
      args: [],
    });
    expect(resolveCommand(tree, ["experiments"], ["help"])).toMatchObject({
      kind: "meta",
      name: "help",
    });
    expect(resolveCommand(tree, [], ["?"])).toMatchObject({
      kind: "meta",
      name: "help-q",
    });
    expect(resolveCommand(tree, [], ["exit"])).toMatchObject({
      kind: "meta",
      name: "exit",
    });
    expect(resolveCommand(tree, [], ["--help"])).toMatchObject({
      kind: "meta",
      name: "help",
    });
  });

  it("resolves relative to the current context", () => {
    const r = resolveCommand(tree, ["experiments"], ["list"]);
    expect(r).toMatchObject({
      kind: "run",
      absolutePath: ["experiments", "list"],
    });
  });

  it("strips the `evals` sigil and resolves from root", () => {
    const r = resolveCommand(
      tree,
      ["experiments"],
      ["evals", "config", "path"],
    );
    expect(r).toMatchObject({
      kind: "run",
      absolutePath: ["config", "path"],
    });
  });

  it("treats bare `evals` as to-root meta", () => {
    expect(resolveCommand(tree, ["experiments"], ["evals"])).toMatchObject({
      kind: "meta",
      name: "to-root",
    });
  });

  it("returns unknown when context-only resolution fails", () => {
    // `config` is a root child but not a child of `experiments` → unknown
    // at depth, no Pass 2 fallback.
    const r = resolveCommand(tree, ["experiments"], ["config", "path"]);
    expect(r).toMatchObject({
      kind: "unknown",
      token: "config",
      context: ["experiments"],
    });
  });

  it("returns unknown for unknown tokens at root", () => {
    const r = resolveCommand(tree, [], ["nope"]);
    expect(r).toMatchObject({ kind: "unknown", token: "nope", context: [] });
  });

  it("yields remaining args for partial path matches", () => {
    const r = resolveCommand(
      tree,
      [],
      ["experiments", "compare", "exp1", "exp2"],
    );
    expect(r).toMatchObject({
      kind: "run",
      args: ["exp1", "exp2"],
      absolutePath: ["experiments", "compare"],
    });
  });
});

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

describe("dispatch", () => {
  function makeHandlers() {
    return {
      run: vi.fn(),
      config: vi.fn(),
      configPath: vi.fn(),
      configCore: vi.fn(),
      corePath: vi.fn(),
      experiments: vi.fn(),
      expList: vi.fn(),
      compare: vi.fn(),
      rootHelp: vi.fn(),
    };
  }

  it("runs a leaf with the remaining args", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx();
    await dispatch(tree, ["experiments", "compare", "exp1"], ctx);
    expect(h.compare).toHaveBeenCalledWith(["exp1"], ctx);
  });

  it("treats `experiments > list` identically to `experiments list`", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    await dispatch(tree, tokenize("experiments > list"), makeCtx());
    expect(h.expList).toHaveBeenCalledOnce();
  });

  it("auto-descends on bare invocation of a descendable node (REPL)", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx();
    await dispatch(tree, ["experiments"], ctx);
    expect(h.experiments).toHaveBeenCalledOnce();
    expect(ctx.contextPath).toEqual(["experiments"]);
  });

  it("does not auto-descend in argv mode (contextPath null)", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx({ contextPath: null });
    await dispatch(tree, ["experiments"], ctx);
    expect(h.experiments).toHaveBeenCalledOnce();
    expect(ctx.contextPath).toBeNull();
  });

  it("descends to the absolute path even when invoked from depth", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx();
    ctx.setContextPath?.(["experiments"]);
    // Inside experiments, `evals config` should set context to ["config"].
    await dispatch(tree, ["evals", "config"], ctx);
    expect(ctx.contextPath).toEqual(["config"]);
  });

  it("`..` pops one level", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx();
    ctx.setContextPath?.(["config", "core"]);
    await dispatch(tree, [".."], ctx);
    expect(ctx.contextPath).toEqual(["config"]);
  });

  it("`..` at root prints a hint and is a no-op", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await dispatch(tree, [".."], ctx);
    expect(ctx.contextPath).toEqual([]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("bare `evals` pops all context to root", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx();
    ctx.setContextPath?.(["config", "core"]);
    await dispatch(tree, ["evals"], ctx);
    expect(ctx.contextPath).toEqual([]);
  });

  it("rejects unknown tokens at depth (no run-shorthand fallback)", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx();
    ctx.setContextPath?.(["experiments"]);
    await expect(dispatch(tree, ["nope"], ctx)).rejects.toThrow(
      /Unknown command "nope"/,
    );
    expect(h.run).not.toHaveBeenCalled();
  });

  it("falls back to run for unknown tokens at root", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx();
    await dispatch(tree, ["act"], ctx);
    expect(h.run).toHaveBeenCalledWith(["act"], ctx);
  });

  it("strips the `evals` sigil before falling back to run", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx();
    await dispatch(tree, ["evals", "act"], ctx);
    expect(h.run).toHaveBeenCalledWith(["act"], ctx);
  });

  it("rejects REPL-only metas in argv mode", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const ctx = makeCtx({ contextPath: null });
    await expect(dispatch(tree, [".."], ctx)).rejects.toThrow(
      /not available outside the REPL/,
    );
  });

  it("routes `--help` after a leaf to that leaf's printHelp", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    // Add a printHelp to compare for this test.
    const compare = tree.children![2].children![1];
    const printCompareHelp = vi.fn();
    (compare as { printHelp?: (s: readonly string[]) => void }).printHelp =
      printCompareHelp;
    await dispatch(tree, ["experiments", "compare", "--help"], makeCtx());
    expect(printCompareHelp).toHaveBeenCalled();
    expect(h.compare).not.toHaveBeenCalled();
  });

  it("routes bare `help` to the current context's printHelp", async () => {
    const h = makeHandlers();
    const tree = makeTree(h);
    const printExperimentsHelp = vi.fn();
    (
      tree.children![2] as {
        printHelp?: (s: readonly string[]) => void;
      }
    ).printHelp = printExperimentsHelp;
    const ctx = makeCtx();
    ctx.setContextPath?.(["experiments"]);
    await dispatch(tree, ["help"], ctx);
    expect(printExperimentsHelp).toHaveBeenCalled();
  });
});
