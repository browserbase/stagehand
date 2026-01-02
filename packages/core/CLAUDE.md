# Stagehand Core Package

This is the main Stagehand SDK (`@browserbasehq/stagehand`). It contains the V3 implementation of the browser automation framework.

## Directory Structure

```
packages/core/
├── lib/v3/                    # V3 implementation
│   ├── v3.ts                  # Main orchestrator (exported as Stagehand)
│   ├── index.ts               # Public exports
│   ├── handlers/              # API handlers
│   │   ├── actHandler.ts      # Action execution
│   │   ├── extractHandler.ts  # Data extraction
│   │   ├── observeHandler.ts  # Action planning
│   │   ├── v3AgentHandler.ts  # Tools-based agent
│   │   ├── v3CuaAgentHandler.ts # Computer Use Agent
│   │   └── handlerUtils/      # Shared handler utilities
│   ├── understudy/            # CDP browser abstraction
│   │   ├── context.ts         # V3Context - manages browser context
│   │   ├── page.ts            # Page abstraction
│   │   ├── frame.ts           # Frame abstraction
│   │   └── a11y/              # Accessibility tree utilities
│   │       └── snapshot.ts    # captureHybridSnapshot()
│   ├── llm/                   # LLM abstraction
│   │   ├── LLMClient.ts       # Base LLM interface
│   │   └── LLMProvider.ts     # Provider factory (57+ models)
│   ├── launch/                # Browser launch
│   │   ├── local.ts           # Local Chrome (chrome-launcher)
│   │   └── browserbase.ts     # Browserbase sessions
│   ├── dom/                   # DOM scripts
│   │   └── *.ts               # Scripts injected into pages
│   ├── agent/                 # Agent components
│   │   ├── tools/             # Built-in agent tools
│   │   └── utils/             # Agent utilities
│   ├── types/                 # TypeScript types
│   │   ├── public/            # Exported types
│   │   │   ├── methods.ts     # act/extract/observe types
│   │   │   ├── sdkErrors.ts   # Error classes
│   │   │   ├── model.ts       # Model types
│   │   │   └── agent.ts       # Agent types
│   │   └── private/           # Internal types
│   ├── cache/                 # Caching utilities
│   │   ├── ActCache.ts        # Action result caching
│   │   └── AgentCache.ts      # Agent state caching
│   ├── mcp/                   # Model Context Protocol
│   └── tests/                 # Playwright tests
└── examples/                  # Usage examples
```

---

## Core Class: V3 (Stagehand)

**File**: `lib/v3/v3.ts`

The `V3` class is the main entry point, exported as `Stagehand`. It orchestrates:

1. **Browser lifecycle**: Launch/connect to browser, create context
2. **Handler delegation**: Route API calls to appropriate handlers
3. **LLM management**: Resolve model clients per-call or globally
4. **Metrics tracking**: Token usage, inference time

### Initialization Flow

```typescript
const stagehand = new Stagehand({ env: "LOCAL", model: "openai/gpt-4.1-mini" });
await stagehand.init();
```

**What happens in `init()`:**

1. Load environment variables (`.env`)
2. Launch browser:
   - `env: "LOCAL"`: `launchLocalChrome()` via chrome-launcher
   - `env: "BROWSERBASE"`: `createBrowserbaseSession()` via SDK
3. Connect to CDP WebSocket (15s timeout)
4. Create `V3Context` from CDP connection
5. Initialize handlers: `ActHandler`, `ExtractHandler`, `ObserveHandler`
6. Wait for first page to load

### Key Properties

```typescript
stagehand.context; // V3Context - browser context management
stagehand.llmClient; // LLMClient - current LLM client
stagehand.browserbaseSessionId; // Session ID (if using Browserbase)
```

---

## Handler Pattern

Each core API has a dedicated handler class. Handlers are stateless and receive all dependencies via constructor.

### Common Handler Structure

```typescript
export class FooHandler {
  private readonly llmClient: LLMClient;
  private readonly resolveLlmClient: (model?: ModelConfiguration) => LLMClient;
  private readonly onMetrics?: (...) => void;

  constructor(llmClient, defaultModel, clientOptions, resolveLlmClient, ...) {
    // Store dependencies
  }

  async foo(params: FooHandlerParams): Promise<FooResult> {
    // 1. Capture snapshot
    // 2. Send to LLM
    // 3. Process response
    // 4. Execute action (if applicable)
    // 5. Return result
  }
}
```

### ActHandler (`handlers/actHandler.ts`)

Executes single atomic actions on the page.

**Flow:**

1. Capture hybrid snapshot (accessibility tree + element mappings)
2. Build prompt with instruction + DOM elements
3. Send to LLM via `actInference()`
4. LLM returns: `{ elementId, method, arguments }`
5. Map elementId to XPath selector
6. Execute action via `performUnderstudyMethod()`
7. Wait for DOM/network quiet

**Self-healing (when enabled):**

- If action fails, retake screenshot
- Re-prompt LLM with error context
- Retry up to 3 times

**Key methods:**

- `act(params)`: Main action execution
- `takeDeterministicAction(page, action)`: Direct Action → execute (skip LLM)

### ExtractHandler (`handlers/extractHandler.ts`)

Extracts structured data from pages using Zod schemas.

**Flow:**

1. If no instruction: return raw page text (accessibility tree)
2. Transform schema (convert `z.string().url()` to numeric IDs)
3. Capture hybrid snapshot
4. Send to LLM via `runExtract()`
5. LLM returns structured data matching schema
6. Inject real URLs back into numeric ID placeholders
7. Validate against Zod schema

**URL handling:**

- `z.string().url()` fields are replaced with `z.number()` before LLM call
- LLM returns numeric IDs referencing elements in DOM
- IDs are mapped back to actual URLs after extraction
- This prevents URL hallucination

### ObserveHandler (`handlers/observeHandler.ts`)

Plans actions without executing them. Returns candidate actions.

**Flow:**

1. Capture hybrid snapshot
2. If instruction provided: find matching elements
3. If no instruction: return all interactive elements
4. Build Action objects with XPath selectors
5. Return Action[] for user to choose from

**Use case:** Observe + Act pattern - plan once, execute later

### V3AgentHandler (`handlers/v3AgentHandler.ts`)

Multi-step autonomous execution using AI SDK tools.

**Tools available to agent:**

- `act`: Execute single action
- `extract`: Extract data
- `observe`: Plan actions
- `screenshot`: Capture page screenshot
- `goto`: Navigate to URL
- `scroll`: Scroll page
- `wait`: Wait for time/condition
- `close`: Close page

**Flow:**

1. Create AI SDK messages with system prompt
2. Loop until max_steps or task complete:
   - Call LLM with current state
   - Execute tool calls
   - Append results to messages
3. Return final result with message, actions, reasoning

### V3CuaAgentHandler (`handlers/v3CuaAgentHandler.ts`)

Computer Use Agent for Claude Sonnet 4 or Gemini 2.5 computer-use models.

**Difference from V3AgentHandler:**

- Direct browser control without Stagehand tool wrapping
- Uses native computer-use capabilities of the model
- Enabled via `agent({ cua: true })`

---

## CDP Abstraction (understudy/)

The `understudy` directory contains the Chrome DevTools Protocol abstraction layer.

### V3Context (`understudy/context.ts`)

Manages the browser context and page lifecycle.

**Responsibilities:**

- Own root CDP connection (`CdpConnection`)
- Manage `Page` objects (one per browser tab)
- Handle Target events (new tabs, closes)
- Track frame topology and OOPIF adoption

**Key methods:**

```typescript
context.pages(); // Get all Page objects
context.newPage(); // Create new page/tab
context.activePage; // Get current active page
```

### Page (`understudy/page.ts`)

Abstraction over a browser tab.

**Key methods:**

```typescript
page.goto(url); // Navigate
page.screenshot(); // Capture screenshot
page.evaluate(fn); // Run JS in page context
page.locator(selector); // Get element locator
page.deepLocator(xpath); // XPath across shadow DOM/iframes
```

### Snapshots (`understudy/a11y/snapshot.ts`)

**`captureHybridSnapshot()`:**

- Captures accessibility tree
- Maps element IDs to XPath selectors
- Used by all handlers for LLM context

---

## LLM Abstraction (llm/)

### LLMClient (`llm/LLMClient.ts`)

Base interface for LLM clients.

```typescript
interface LLMClient {
  createChatCompletion(params): Promise<Response>;
  // Model-specific implementations
}
```

### LLMProvider (`llm/LLMProvider.ts`)

Factory for creating LLM clients by model name.

**Supported providers:**

- OpenAI: `openai/gpt-4.1`, `openai/gpt-4.1-mini`, etc.
- Anthropic: `anthropic/claude-sonnet-4`, `anthropic/claude-haiku-4-5`
- Google: `google/gemini-2.0-flash`, `google/gemini-2.5-*`
- Others: Together, Groq, Cerebras, Mistral, xAI, Perplexity, Ollama

---

## Error Classes (`types/public/sdkErrors.ts`)

All errors extend `StagehandError`.

| Error                             | When Thrown                        |
| --------------------------------- | ---------------------------------- |
| `StagehandNotInitializedError`    | Calling methods before `init()`    |
| `MissingEnvironmentVariableError` | Missing API keys                   |
| `ConnectionTimeoutError`          | Can't connect to Chrome (15s)      |
| `ActTimeoutError`                 | `act()` exceeds timeout            |
| `ExtractTimeoutError`             | `extract()` exceeds timeout        |
| `ObserveTimeoutError`             | `observe()` exceeds timeout        |
| `XPathResolutionError`            | Selector doesn't match element     |
| `StagehandElementNotFoundError`   | Element not in DOM                 |
| `StagehandShadowRootMissingError` | Shadow DOM pierce failed           |
| `ZodSchemaValidationError`        | LLM output doesn't match schema    |
| `AgentAbortError`                 | Agent execution cancelled          |
| `CuaModelRequiredError`           | Using CUA without compatible model |

---

## Testing

### Test Location

Tests are in `lib/v3/tests/` using Playwright Test.

### Test Configurations

- `v3.playwright.config.ts`: Default (parallel, 90s timeout)
- `v3.local.playwright.config.ts`: Local Chrome testing
- `v3.bb.playwright.config.ts`: Browserbase testing

### Running Tests

```bash
# From repo root
pnpm test            # Default config
pnpm e2e:local       # Local Chrome
pnpm e2e:bb          # Browserbase

# From packages/core
pnpm test
```

### Writing Tests

```typescript
import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";

test("should extract data", async () => {
  const stagehand = new Stagehand({ env: "LOCAL" });
  await stagehand.init();

  const page = stagehand.context.pages()[0];
  await page.goto("https://example.com");

  const data = await stagehand.extract(
    "get the title",
    z.object({
      title: z.string(),
    }),
  );

  expect(data.title).toBeDefined();
  await stagehand.close();
});
```

---

## Key Patterns

### Snapshot-Based AI

All AI operations use accessibility tree snapshots, not live DOM queries. This ensures determinism and avoids race conditions.

### Element ID → XPath Mapping

1. `captureHybridSnapshot()` assigns numeric IDs to elements
2. LLM references elements by ID
3. IDs are mapped back to XPath for execution

### Per-Call Model Override

Any method can override the default model:

```typescript
await stagehand.act("click button", { model: "anthropic/claude-sonnet-4" });
```

### Metrics Tracking

All handlers report:

- `promptTokens`, `completionTokens`, `reasoningTokens`
- `cachedInputTokens`, `inferenceTimeMs`

---

## Common Modifications

### Adding a New Handler Method

1. Add type to `types/public/methods.ts`
2. Create handler class in `handlers/`
3. Add handler to V3 constructor in `v3.ts`
4. Expose method on V3 class
5. Export from `index.ts`
6. Add tests in `tests/`

### Adding a New LLM Provider

1. Add provider client in `llm/`
2. Register in `LLMProvider.ts`
3. Add model names to `AvailableModel` type
4. Test with existing evals

### Adding a New Agent Tool

1. Add tool definition in `agent/tools/`
2. Register in `v3AgentHandler.ts` tools array
3. Add tests for new tool behavior
