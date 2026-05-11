/**
 * Command tree for the evals TUI.
 *
 * Models the user-visible command surface as a tree:
 *   root → run, list, new, config{path,set,reset,core{path,set,reset,setup}},
 *          experiments{list,show,open,compare}
 *
 * Both the REPL (tui/repl.ts) and argv mode (cli.ts) build the same tree
 * via `buildCommandTree()` and dispatch user input through it. This is the
 * single source of truth for which commands exist and how they nest.
 *
 * Resolution rules (see resolveCommand):
 *   - Commands resolve relative to the current context (REPL contextPath).
 *   - The leading sigil `evals` strips itself and resolves the remainder
 *     from root — mirrors `evals X Y` from the shell.
 *   - Bare `evals` pops all context to root.
 *   - Meta commands (.., help, ?, exit/quit/q, clear, --help/-h) short-
 *     circuit before tree resolution and work at any depth.
 *
 * Existing handlers in tui/commands/* are wrapped, never rewritten.
 */

import process from "node:process";
import type { TaskRegistry } from "../framework/types.js";
import { tokenize } from "./tokenize.js";
import { bb, cyan, dim } from "./format.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandHandler = (
  args: string[],
  ctx: CommandContext,
) => Promise<void> | void;

export type CommandNode = {
  /** Canonical lowercase name. */
  name: string;
  aliases?: readonly string[];
  summary: string;
  /** If present, executable as a leaf with the given args. */
  handler?: CommandHandler;
  /** If present, descendable as a namespace. */
  children?: readonly CommandNode[];
  /** Per-node help printer. Receives the absolute path that was resolved. */
  printHelp?: (subPath: readonly string[]) => void | Promise<void>;
  /** Hidden from auto-listings (still resolvable). */
  hidden?: boolean;
};

export type CommandContext = {
  entryDir: string;
  /** Lazy registry accessor — REPL caches, argv discovers on first call. */
  getRegistry: () => Promise<TaskRegistry>;
  setRegistry: (r: TaskRegistry) => void;
  /** Mutable in REPL (the run leaf assigns/clears); null in argv. */
  abortRef: { current: AbortController | null } | null;
  /** Mutable string[] in REPL; null in argv. Mutated via the helpers below. */
  contextPath: string[] | null;
  pushContext?: (segment: string) => void;
  popContext?: () => void;
  setContextPath?: (path: readonly string[]) => void;
};

export type Resolution =
  | { kind: "noop" }
  | { kind: "meta"; name: MetaName; args: string[] }
  | { kind: "run"; node: CommandNode; args: string[]; absolutePath: string[] }
  | { kind: "unknown"; token: string; context: readonly string[] };

export type MetaName =
  | "back"
  | "to-root"
  | "exit"
  | "clear"
  | "help"
  | "help-q";

const META_NAMES: Record<string, MetaName> = {
  "..": "back",
  exit: "exit",
  quit: "exit",
  q: "exit",
  clear: "clear",
  help: "help",
  "?": "help-q",
  "--help": "help",
  "-h": "help",
};

// ---------------------------------------------------------------------------
// Tree walking + resolution
// ---------------------------------------------------------------------------

export function findChild(
  node: CommandNode,
  token: string,
): CommandNode | undefined {
  if (!node.children) return undefined;
  const lower = token.toLowerCase();
  return node.children.find(
    (c) =>
      c.name.toLowerCase() === lower ||
      (c.aliases?.some((a) => a.toLowerCase() === lower) ?? false),
  );
}

export function walkPath(
  root: CommandNode,
  path: readonly string[],
): CommandNode {
  let node = root;
  for (const seg of path) {
    const child = findChild(node, seg);
    if (!child) return node;
    node = child;
  }
  return node;
}

type Match = {
  node: CommandNode;
  matchedNames: string[];
  remaining: string[];
};

/**
 * Greedy walk: consume each leading token that matches a child of the
 * current node. Stop at the first non-match — those tokens become args
 * for the deepest matched node's handler.
 */
function matchPath(start: CommandNode, tokens: readonly string[]): Match {
  let node = start;
  const matched: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const child = findChild(node, tokens[i]);
    if (!child) break;
    node = child;
    matched.push(child.name);
    i++;
  }
  return { node, matchedNames: matched, remaining: tokens.slice(i) };
}

export function resolveCommand(
  root: CommandNode,
  contextPath: readonly string[],
  tokens: readonly string[],
): Resolution {
  if (tokens.length === 0) return { kind: "noop" };

  const first = tokens[0].toLowerCase();
  const meta = META_NAMES[first];
  if (meta) {
    return { kind: "meta", name: meta, args: tokens.slice(1) };
  }

  // Leading sigil: `evals` strips itself and resolves the remainder
  // from root, regardless of current context.
  if (first === "evals") {
    const rest = tokens.slice(1);
    if (rest.length === 0) {
      return { kind: "meta", name: "to-root", args: [] };
    }
    const m = matchPath(root, rest);
    if (m.matchedNames.length > 0) {
      return {
        kind: "run",
        node: m.node,
        args: m.remaining,
        absolutePath: m.matchedNames,
      };
    }
    return { kind: "unknown", token: rest[0], context: [] };
  }

  // Relative — match against the current context, no root fallback.
  const current = walkPath(root, contextPath);
  const m = matchPath(current, tokens);
  if (m.matchedNames.length > 0) {
    return {
      kind: "run",
      node: m.node,
      args: m.remaining,
      absolutePath: [...contextPath, ...m.matchedNames],
    };
  }

  return { kind: "unknown", token: tokens[0], context: contextPath };
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

export function renderPrompt(contextPath: readonly string[]): string {
  const segs = contextPath.map((p) => `${cyan(p)} ${dim(">")} `).join("");
  return `${bb("evals")} ${dim(">")} ${segs}`;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Resolve `tokens` against the tree and execute the result. Caller owns
 * error handling and prompt reprinting.
 */
export async function dispatch(
  root: CommandNode,
  tokens: string[],
  ctx: CommandContext,
): Promise<void> {
  const result = resolveCommand(root, ctx.contextPath ?? [], tokens);

  switch (result.kind) {
    case "noop":
      return;

    case "meta":
      await runMeta(result.name, result.args, root, ctx);
      return;

    case "run": {
      // Help is only triggered when `help` / `--help` / `-h` sits IMMEDIATELY
      // after the matched path. Later positions are arguments or flag values
      // and must reach the handler unchanged (e.g. `config set trials --help`
      // must surface a parse error, not silently print help).
      const first = result.args[0];
      const wantsHelp =
        first === "help" || first === "--help" || first === "-h";
      if (wantsHelp && result.node.printHelp) {
        await result.node.printHelp(result.absolutePath);
        return;
      }

      if (result.node.handler) {
        await result.node.handler(result.args, ctx);
      } else if (result.args.length > 0) {
        throw new Error(
          `Unknown subcommand "${result.args[0]}" in ${pretty(
            result.absolutePath,
          )}`,
        );
      } else if (result.node.printHelp) {
        await result.node.printHelp(result.absolutePath);
      }

      // Descend on bare (REPL only). `config` and `config core` already
      // printed via their handler; `experiments` printed via printHelp.
      if (
        ctx.contextPath !== null &&
        result.node.children &&
        result.args.length === 0
      ) {
        const target = result.absolutePath;
        const same =
          target.length === ctx.contextPath.length &&
          target.every((s, i) => s === ctx.contextPath![i]);
        if (!same) {
          ctx.setContextPath?.(target);
        }
      }
      return;
    }

    case "unknown": {
      // Unknown-token shorthand at root: hand off to the run leaf so
      // `evals act` keeps working. Only at root — at depth this errors.
      if (result.context.length === 0) {
        const runNode = findChild(root, "run");
        if (runNode?.handler) {
          // Strip a leading "evals" sigil so parseRunArgs doesn't
          // misinterpret it as a target or flag.
          const forwarded =
            tokens[0]?.toLowerCase() === "evals" ? tokens.slice(1) : tokens;
          await runNode.handler(forwarded, ctx);
          return;
        }
      }
      throw new Error(unknownMessage(result.token, result.context));
    }
  }
}

async function runMeta(
  name: MetaName,
  args: string[],
  root: CommandNode,
  ctx: CommandContext,
): Promise<void> {
  switch (name) {
    case "back": {
      if (ctx.contextPath === null) {
        throw new Error('".." is not available outside the REPL');
      }
      if (ctx.contextPath.length === 0) {
        console.log(dim("  Already at root."));
        return;
      }
      ctx.popContext?.();
      return;
    }

    case "to-root": {
      // Bare `evals` mid-line. In REPL, pop all context. In argv, no-op.
      if (ctx.contextPath === null) return;
      ctx.setContextPath?.([]);
      return;
    }

    case "exit": {
      if (ctx.contextPath === null) {
        throw new Error("`exit` is not available outside the REPL");
      }
      console.log(dim("\n  Goodbye.\n"));
      process.exit(0);
    }
    // eslint-disable-next-line no-fallthrough -- exit terminates
    case "clear": {
      if (ctx.contextPath === null) {
        throw new Error("`clear` is not available outside the REPL");
      }
      console.clear();
      return;
    }

    case "help":
    case "help-q": {
      const path = ctx.contextPath ?? [];
      const current = walkPath(root, path);

      if (args.length > 0) {
        // `help <child>` — resolve relative to current context.
        const m = matchPath(current, args);
        if (m.matchedNames.length > 0 && m.node.printHelp) {
          await m.node.printHelp([...path, ...m.matchedNames]);
          return;
        }
      }

      if (current.printHelp) {
        await current.printHelp(path);
        return;
      }
      if (root.printHelp) {
        await root.printHelp([]);
      }
      return;
    }
  }
}

function pretty(path: readonly string[]): string {
  return path.length === 0 ? "evals >" : `evals > ${path.join(" > ")}`;
}

function unknownMessage(token: string, context: readonly string[]): string {
  if (context.length === 0) {
    return `Unknown command "${token}". Type "help" for the command list.`;
  }
  return `Unknown command "${token}" in ${pretty(
    context,
  )}. Type "evals ${token} …" to run from root, "help" to see subcommands here, or ".." to leave the context.`;
}

// ---------------------------------------------------------------------------
// Tree factory — wraps existing handlers as leaf nodes.
// ---------------------------------------------------------------------------

/**
 * Build the canonical command tree. The factory is parameter-less because
 * leaves close over the `CommandContext` they receive at dispatch time —
 * the same tree instance can serve REPL (with abortRef + contextPath) and
 * argv (both null) contexts.
 */
export function buildCommandTree(): CommandNode {
  // Help printers are imported lazily to avoid pulling braintrust into
  // quiet commands like `config path`.
  const help = async () => import("./commands/help.js");

  const runNode: CommandNode = {
    name: "run",
    summary: "Run evals",
    printHelp: async () => (await help()).printRunHelp(),
    handler: async (args, ctx) => {
      const { parseRunArgs, resolveRunOptions } = await import(
        "./commands/parse.js"
      );
      const { readConfig } = await import("./commands/config.js");
      const { runCommand } = await import("./commands/run.js");

      const flags = parseRunArgs(args);
      const configFile = readConfig(ctx.entryDir);
      const resolved = resolveRunOptions(
        flags,
        configFile.defaults,
        process.env,
        configFile.core,
      );

      // Argv mode (no abortRef): handle --legacy here, mirroring cli.ts.
      if (ctx.abortRef === null) {
        if (flags.legacy) {
          const { runLegacy } = await import("./commands/legacy.js");
          const { discoverTasks } = await import("../framework/discovery.js");
          const { getRuntimeTasksRoot } = await import("../runtimePaths.js");
          const registry = await discoverTasks(getRuntimeTasksRoot(), false);
          await runLegacy(resolved, flags, registry);
          return;
        }
        await runCommand(resolved);
        return;
      }

      // REPL mode: pass abort signal so Esc can cancel.
      const registry = await ctx.getRegistry();
      ctx.abortRef.current = new AbortController();
      try {
        await runCommand(resolved, registry, ctx.abortRef.current.signal);
      } finally {
        ctx.abortRef.current = null;
      }
    },
  };

  const listNode: CommandNode = {
    name: "list",
    summary: "List tasks and categories",
    printHelp: async () => (await help()).printListHelp(),
    handler: async (args, ctx) => {
      const { printList } = await import("./commands/list.js");
      const detailed = args.includes("--detailed") || args.includes("-d");
      const tierFilter = args.find((a) => !a.startsWith("-"));
      const registry = await ctx.getRegistry();
      printList(registry, tierFilter, detailed);
    },
  };

  const newNode: CommandNode = {
    name: "new",
    summary: "Scaffold a new task",
    printHelp: async () => (await help()).printNewHelp(),
    handler: async (args, ctx) => {
      const { scaffoldTask } = await import("./commands/new.js");
      const task = scaffoldTask(args);
      // REPL: re-discover so the new task is immediately resolvable.
      if (task && ctx.abortRef !== null) {
        const { discoverTasks } = await import("../framework/discovery.js");
        const { getRuntimeTasksRoot } = await import("../runtimePaths.js");
        const registry = await discoverTasks(getRuntimeTasksRoot(), false);
        ctx.setRegistry(registry);
      }
    },
  };

  // ---- config (leaf + children) ----
  // All `config core` leaves share the same help page (printConfigCoreHelp);
  // all `config` leaves share printConfigHelp. Setting printHelp on each leaf
  // makes `evals config core <leaf> help` resolve here in dispatch — leaves
  // never hand a stray "help" token to their wrapped handler.
  const printConfigCoreHelpThunk = async () =>
    (await help()).printConfigCoreHelp();
  const printConfigHelpThunk = async () => (await help()).printConfigHelp();

  const configCorePath: CommandNode = {
    name: "path",
    summary: "Print the config file path",
    printHelp: printConfigCoreHelpThunk,
    handler: async (_args, ctx) => {
      const { handleCore } = await import("./commands/core.js");
      await handleCore(["path"], ctx.entryDir);
    },
  };
  const configCoreSet: CommandNode = {
    name: "set",
    summary: "Set core tool/startup",
    printHelp: printConfigCoreHelpThunk,
    handler: async (args, ctx) => {
      const { handleCore } = await import("./commands/core.js");
      await handleCore(["set", ...args], ctx.entryDir);
    },
  };
  const configCoreReset: CommandNode = {
    name: "reset",
    summary: "Reset core configuration",
    printHelp: printConfigCoreHelpThunk,
    handler: async (args, ctx) => {
      const { handleCore } = await import("./commands/core.js");
      await handleCore(["reset", ...args], ctx.entryDir);
    },
  };
  const configCoreSetup: CommandNode = {
    name: "setup",
    summary: "Interactive wizard (coming soon)",
    printHelp: printConfigCoreHelpThunk,
    handler: async (_args, ctx) => {
      const { handleCore } = await import("./commands/core.js");
      await handleCore(["setup"], ctx.entryDir);
    },
  };

  const configCore: CommandNode = {
    name: "core",
    summary: "Configure core tier defaults",
    printHelp: async () => (await help()).printConfigCoreHelp(),
    handler: async (args, ctx) => {
      const { handleCore } = await import("./commands/core.js");
      await handleCore(args, ctx.entryDir);
    },
    children: [configCorePath, configCoreSet, configCoreReset, configCoreSetup],
  };

  const configPath: CommandNode = {
    name: "path",
    summary: "Print the evals.config.json file path",
    printHelp: printConfigHelpThunk,
    handler: async (_args, ctx) => {
      const { handleConfig } = await import("./commands/config.js");
      await handleConfig(["path"], ctx.entryDir);
    },
  };
  const configSet: CommandNode = {
    name: "set",
    summary: "Set a default value",
    printHelp: printConfigHelpThunk,
    handler: async (args, ctx) => {
      const { handleConfig } = await import("./commands/config.js");
      await handleConfig(["set", ...args], ctx.entryDir);
    },
  };
  const configReset: CommandNode = {
    name: "reset",
    summary: "Reset one key or all defaults",
    printHelp: printConfigHelpThunk,
    handler: async (args, ctx) => {
      const { handleConfig } = await import("./commands/config.js");
      await handleConfig(["reset", ...args], ctx.entryDir);
    },
  };

  const configNode: CommandNode = {
    name: "config",
    summary: "Get/set default run configuration",
    printHelp: async () => (await help()).printConfigHelp(),
    handler: async (args, ctx) => {
      // matchPath strips known children (path/set/reset/core) before
      // we get here, so any args remaining are unknown subcommands —
      // delegate to handleConfig which prints the right error.
      const { handleConfig, printConfig } = await import(
        "./commands/config.js"
      );
      if (args.length === 0) {
        printConfig(ctx.entryDir);
        return;
      }
      await handleConfig(args, ctx.entryDir);
    },
    children: [configPath, configSet, configReset, configCore],
  };

  // ---- experiments (pure namespace) ----
  const experimentsList: CommandNode = {
    name: "list",
    summary: "Show recent runs",
    printHelp: async () => (await help()).printExperimentsHelp("list"),
    handler: async (args) => {
      const { handleExperiments } = await import("./commands/experiments.js");
      await handleExperiments(["list", ...args]);
    },
  };
  const experimentsShow: CommandNode = {
    name: "show",
    summary: "Show one experiment",
    printHelp: async () => (await help()).printExperimentsHelp("show"),
    handler: async (args) => {
      const { handleExperiments } = await import("./commands/experiments.js");
      await handleExperiments(["show", ...args]);
    },
  };
  const experimentsOpen: CommandNode = {
    name: "open",
    summary: "Open one experiment in the browser",
    printHelp: async () => (await help()).printExperimentsHelp("open"),
    handler: async (args) => {
      const { handleExperiments } = await import("./commands/experiments.js");
      await handleExperiments(["open", ...args]);
    },
  };
  const experimentsCompare: CommandNode = {
    name: "compare",
    summary: "Generate an HTML comparison report",
    printHelp: async () => (await help()).printExperimentsHelp("compare"),
    handler: async (args) => {
      const { handleExperiments } = await import("./commands/experiments.js");
      await handleExperiments(["compare", ...args]);
    },
  };

  const experimentsNode: CommandNode = {
    name: "experiments",
    summary: "Inspect Braintrust experiment runs",
    printHelp: async () => (await help()).printExperimentsHelp(),
    handler: async (args) => {
      // Bare invocation prints help (preserves today's `evals experiments`
      // behavior). With an unknown trailing token, error out.
      if (args.length > 0) {
        throw new Error(`Unknown experiments subcommand "${args[0]}"`);
      }
      const { printExperimentsHelp } = await import("./commands/help.js");
      printExperimentsHelp();
    },
    children: [
      experimentsList,
      experimentsShow,
      experimentsOpen,
      experimentsCompare,
    ],
  };

  const root: CommandNode = {
    name: "evals",
    summary: "Stagehand evals CLI",
    printHelp: async () => (await help()).printHelp(),
    children: [runNode, listNode, configNode, experimentsNode, newNode],
  };

  return root;
}

// ---------------------------------------------------------------------------
// Argv tokenization: re-split args that contain `>` (e.g. from `\>` in shell).
// ---------------------------------------------------------------------------

/**
 * Re-tokenize a shell-split argv array on `>` boundaries.
 *
 * The shell consumes unescaped `>` as a redirect, so users who want
 * `evals experiments > list` from a terminal must escape (`\>`) or quote
 * the chunk. Either way the `>` survives in argv and we split on it here.
 *
 * Caveat: a quoted arg containing `>` (e.g. `"foo > bar"`) will also be
 * split. That's fine for known subcommand surfaces — none of our targets
 * or option values legitimately contain `>` characters.
 */
export function tokenizeArgv(args: readonly string[]): string[] {
  const out: string[] = [];
  for (const arg of args) {
    if (arg === ">") continue;
    if (!arg.includes(">")) {
      out.push(arg);
      continue;
    }
    for (const piece of arg.split(">")) {
      if (piece) out.push(piece);
    }
  }
  return out;
}

// Re-export tokenize so callers only import from one place.
export { tokenize };
