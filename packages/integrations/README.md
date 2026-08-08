# Stagehand integrations

This package contains shared integration surfaces for Stagehand V4. It is private while the public API and packaging contract are validated.

## Code mode

The `./codemode` export gives an agent one `code_execute` tool backed by a persistent Stagehand browser. Frameworks can either launch the thin local MCP server or wrap `StagehandCodeExecutor` as a native tool.

```ts
import {
  StagehandCodeExecutor,
  stagehandCodeConfigFromEnv,
} from "@browserbasehq/stagehand-integrations/codemode";

const executor = new StagehandCodeExecutor(stagehandCodeConfigFromEnv());

try {
  const result = await executor.execute({
    code: `
      await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
      return { title: await page.title(), url: await page.url() };
    `,
  });
  console.log(result);
} finally {
  await executor.close();
}
```

The executor initializes the browser on the first valid call, serializes calls, and preserves pages, cookies, and navigation state until its owner closes it.

### Low-level eval integration

Eval harnesses that already own Stagehand and browser initialization should call `executeStagehandSnippet` directly. This reuses the exact generated-code semantics without replacing the eval harness's startup, cleanup, task bindings, or metrics collection.

### Local MCP integration

The `./codemode/stdio-server` export is an internal process entrypoint. It is not a command-line interface and accepts no arguments. The owning framework launches one process per agent run and selects local or Browserbase startup through its environment:

```text
STAGEHAND_BROWSER=local
STAGEHAND_BROWSER=browserbase
```

The process stays alive across calls and closes when its input stream ends. `SIGINT` and `SIGTERM` perform bounded graceful cleanup and preserve signal-style exit codes. If generated JavaScript blocks the JavaScript event loop, the server cannot run its cleanup handlers. The owner must terminate the entire process tree, escalate to `SIGKILL` after its own deadline, and start a new process before accepting more work. Killing only the Node process can leave its local browser child alive.

### Framework examples

- [Vercel Sandbox](./examples/vercel-sandbox) source-installs the stdio server inside a Firecracker microVM and returns a framework-neutral, bearer-authenticated MCP connection.

### Configuration

`stagehandCodeConfigFromEnv()` recognizes:

| Variable                                                           | Purpose                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `STAGEHAND_BROWSER`                                                | Optional `local` or `browserbase` override                       |
| `BROWSERBASE_API_KEY`                                              | Selects and authenticates Browserbase when present               |
| `BROWSERBASE_PROJECT_ID`                                           | Optional Browserbase project forwarded when creating a session   |
| `STAGEHAND_MODEL_NAME`                                             | Optional Stagehand model name                                    |
| `STAGEHAND_MODEL_API_KEY`                                          | Optional explicit model-provider key                             |
| Provider API keys                                                  | Supplies the key for a matching explicit model provider          |
| `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_API_KEY` | Selects `google/gemini-2.5-flash-lite` when no model is explicit |

Without a browser override, the helper selects Browserbase when `BROWSERBASE_API_KEY` exists and a headless local browser otherwise.

Native callers run generated JavaScript in their own process. An `AbortSignal` can cancel queued work before the snippet begins, but it cannot safely preempt arbitrary JavaScript already running in the same process. Native integrations that require hard time limits should put the executor behind a child-process boundary, as the stdio MCP integration does.

### Skill and reference

`codemode/SKILL.md` is the concise agent guide. `codemode/REFERENCE.md` is the longer API lookup. Both are exported as raw package assets and as bundle-safe JavaScript strings.

### Security boundary

The code-mode executor does not provide a sandbox. Generated JavaScript runs in the host process and inherits that process's filesystem, network, and environment access. A framework may place the tool inside its own sandbox, container, or other isolation boundary.

For untrusted generated code, use the source-installed microVM architecture in the
[Vercel Sandbox example](./examples/vercel-sandbox). The sandbox provider supplies the security
boundary.
