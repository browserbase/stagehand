# Stagehand integrations

This package contains shared integration surfaces for Stagehand V4. It is private while the public
API and packaging contract are validated.

## Code mode

The `./codemode` export gives an agent one `code_execute` tool backed by a persistent Stagehand
browser. Frameworks can either launch the thin local MCP server or wrap `StagehandCodeExecutor` as a
native tool.

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

The executor initializes the browser on the first valid call, serializes calls, and preserves pages,
cookies, and navigation state until its owner closes it.

### Low-level eval integration

Eval harnesses that already own Stagehand and browser initialization should call
`executeStagehandSnippet` directly. This reuses the exact generated-code semantics without replacing
the eval harness's startup, cleanup, task bindings, or metrics collection.

### Local MCP integration

The `./codemode/stdio-server` export is an internal process entrypoint. It is not a command-line
interface and accepts no arguments. The owning framework launches one process per agent run, keeps
it alive across calls, terminates it if a call hangs, and closes it when the run ends.

### Configuration

`stagehandCodeConfigFromEnv()` recognizes:

| Variable                                                           | Purpose                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `STAGEHAND_BROWSER`                                                | Optional `local` or `browserbase` override                       |
| `BROWSERBASE_API_KEY`                                              | Selects and authenticates Browserbase when present               |
| `STAGEHAND_MODEL_NAME`                                             | Optional Stagehand model name                                    |
| `STAGEHAND_MODEL_API_KEY`                                          | Optional explicit model-provider key                             |
| `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | Selects `google/gemini-2.5-flash-lite` when no model is explicit |

Without a browser override, the helper selects Browserbase when `BROWSERBASE_API_KEY` exists and a
headless local browser otherwise.

### Skill and reference

`codemode/SKILL.md` is the concise agent guide. `codemode/REFERENCE.md` is the longer API lookup.
Both are exported as raw package assets and as bundle-safe JavaScript strings.

### Security boundary

The code-mode executor does not provide a sandbox. Generated JavaScript runs in the host process and
inherits that process's filesystem, network, and environment access. A framework may place the tool
inside its own sandbox, container, or other isolation boundary.
