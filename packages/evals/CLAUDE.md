# Stagehand Evals Package

This package contains the evaluation suite for Stagehand. It provides a framework for running automated tests against live websites to measure Stagehand's capabilities.

## Quick Start

```bash
# Run all evals
pnpm evals

# Run specific task
pnpm evals extract_repo_name

# Run by category
pnpm evals observe_*

# Run with options
pnpm evals --env=browserbase --trials=5
```

## Directory Structure

```
packages/evals/
├── tasks/               # Individual eval task files (126 tasks)
│   ├── agent/           # Agent-specific tasks (30+)
│   ├── extract_*.ts     # Extract tasks
│   ├── observe_*.ts     # Observe tasks
│   ├── *.ts             # Act and combination tasks
├── suites/              # External benchmark suites
│   ├── gaia/            # GAIA benchmark
│   ├── webvoyager/      # WebVoyager benchmark
│   ├── webbench/        # WebBench benchmark
│   └── osworld/         # OSWorld benchmark
├── types/
│   └── evals.ts         # Type definitions
├── evals.config.json    # Task registry and configuration
├── run.ts               # CLI entry point
├── index.eval.ts        # Braintrust eval orchestrator
├── taskConfig.ts        # Model and task configuration
├── scoring.ts           # Scoring functions
├── logger.ts            # EvalLogger utility
├── initV3.ts            # Stagehand initialization
└── summary.ts           # Result aggregation
```

---

## Writing Eval Tasks

### Basic Task Structure

Create a new file in `tasks/`:

```typescript
// tasks/my_new_task.ts
import { EvalFunction } from "../types/evals";

export const my_new_task: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // Perform actions
    await v3.act("click the button");

    // Extract data
    const { extraction } = await v3.extract("get the result");

    // Log intermediate results
    logger.log({
      message: "Extracted result",
      level: 1,
      auxiliary: {
        result: { value: extraction, type: "object" },
      },
    });

    // Return success/failure
    return {
      _success: extraction === "expected value",
      extraction,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
```

### Register the Task

Add to `evals.config.json`:

```json
{
  "tasks": [
    {
      "name": "my_new_task",
      "categories": ["extract"]
    }
  ]
}
```

### EvalFunction Signature

```typescript
type EvalFunction = (taskInput: {
  v3: V3; // Stagehand instance
  v3Agent?: AgentInstance; // Agent instance (for agent tasks)
  logger: EvalLogger; // Logging utility
  debugUrl: string; // Debug URL for session
  sessionUrl: string; // Browserbase session URL
  modelName: AvailableModel; // Current model being tested
  input: EvalInput; // Task input with params
}) => Promise<{
  _success: boolean; // Pass/fail
  logs: LogLine[]; // Captured logs
  debugUrl: string; // Debug URL
  sessionUrl: string; // Session URL
  error?: unknown; // Error if failed
}>;
```

---

## Task Categories

| Category                    | Description                    | Example Tasks                                   |
| --------------------------- | ------------------------------ | ----------------------------------------------- |
| `act`                       | Single action execution        | `amazon_add_to_cart`, `dropdown`, `login`       |
| `extract`                   | Data extraction                | `extract_repo_name`, `extract_github_stars`     |
| `observe`                   | Action planning                | `observe_github`, `observe_amazon_add_to_cart`  |
| `combination`               | Multi-step workflows           | `arxiv`, `allrecipes`, `peeler_complex`         |
| `agent`                     | Agent-based tasks              | `agent/google_flights`, `agent/sf_library_card` |
| `targeted_extract`          | Extract from specific selector | `extract_recipe`, `extract_hamilton_weather`    |
| `regression`                | Regression tests               | `wichita`, `heal_simple_google_search`          |
| `experimental`              | Experimental features          | `apple`, `costar`                               |
| `llm_clients`               | LLM provider tests             | `hn_aisdk`, `hn_langchain`                      |
| `external_agent_benchmarks` | External benchmarks            | `agent/gaia`, `agent/webvoyager`                |

---

## Running Evals

### Command Line Options

```bash
pnpm evals [task-name] [options]
```

| Option                                 | Description               | Default        |
| -------------------------------------- | ------------------------- | -------------- |
| `--env=local\|browserbase`             | Environment               | `local`        |
| `--trials=N`                           | Number of trials per eval | `3`            |
| `--concurrency=N`                      | Max parallel sessions     | `10`           |
| `--provider=openai\|anthropic\|google` | Model provider filter     | all            |
| `--model=MODEL_NAME`                   | Specific model            | default models |
| `--api=true\|false`                    | Use API mode              | `false`        |
| `--max_k=N`                            | Limit number of evals     | unlimited      |

### Examples

```bash
# Run extract tasks locally
pnpm evals extract_*

# Run with Browserbase
pnpm evals amazon_add_to_cart --env=browserbase

# Run 5 trials with specific model
pnpm evals observe_github --trials=5 --model=anthropic/claude-sonnet-4

# Run agent tasks with high concurrency
pnpm evals agent/* --concurrency=20
```

### Environment Variables

```bash
# Required for Browserbase
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=

# LLM API Keys
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=

# Optional
BRAINTRUST_API_KEY=       # For result aggregation
EVAL_ENV=local            # Override default env
EVAL_TRIAL_COUNT=3        # Override trials
EVAL_MAX_CONCURRENCY=10   # Override concurrency
```

---

## Agent Tasks

Agent tasks test multi-step autonomous execution.

### Agent Task Structure

```typescript
// tasks/agent/my_agent_task.ts
import { EvalFunction } from "../../types/evals";
import { V3Evaluator } from "@browserbasehq/stagehand";

export const my_agent_task: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  v3Agent,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // Execute agent task
    const result = await v3Agent.execute({
      instruction: "Search for the latest news and summarize",
      maxSteps: 20,
    });

    // Use V3Evaluator for LLM-based evaluation
    const evaluator = new V3Evaluator(v3);
    const { evaluation, reasoning } = await evaluator.ask({
      question: "Did the agent successfully complete the task?",
      answer: result.message,
      screenshot: true,
    });

    logger.log({
      message: "Agent evaluation",
      level: 1,
      auxiliary: {
        evaluation: { value: evaluation, type: "string" },
        reasoning: { value: reasoning, type: "string" },
      },
    });

    return {
      _success: evaluation === "YES",
      result: result.message,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
```

---

## V3Evaluator

Use `V3Evaluator` for LLM-based pass/fail evaluation.

```typescript
import { V3Evaluator } from "@browserbasehq/stagehand";

const evaluator = new V3Evaluator(v3);

// Simple YES/NO evaluation
const { evaluation, reasoning } = await evaluator.ask({
  question: "Does the page show the search results?",
  answer: "Page shows 10 search results",
  screenshot: true, // Include current screenshot
});

// evaluation: "YES" | "NO"
// reasoning: "The screenshot shows..."
```

---

## External Benchmarks

The `suites/` directory contains integrations with external benchmarks:

### GAIA

General AI Assistant benchmark for complex reasoning tasks.

```bash
pnpm evals agent/gaia --trials=1
```

### WebVoyager

Web navigation and task completion benchmark.

```bash
pnpm evals agent/webvoyager --trials=1
```

### WebBench

Real-world web automation across live sites.

### OSWorld

Chrome browser automation tasks.

### OnlineMind2Web

Real-world web interaction tasks.

---

## Scoring

Scoring functions in `scoring.ts`:

```typescript
// Exact match: 1 for success, 0 for failure
export function exactMatch(result: { _success: boolean }): number {
  return result._success ? 1 : 0;
}

// Error match: Score based on error occurrence
export function errorMatch(result: { error?: unknown }): number {
  return result.error ? 0 : 1;
}
```

---

## Results

### Output Format

Results are written to `eval-summary.json`:

```json
{
  "experimentName": "extract_browserbase_20251026035649",
  "passed": [
    {
      "eval": "extract_repo_name",
      "model": "openai/gpt-4.1-mini",
      "categories": ["extract"]
    }
  ],
  "failed": [
    {
      "eval": "extract_github_stars",
      "model": "google/gemini-2.0-flash",
      "categories": ["extract"],
      "error": "Extraction mismatch"
    }
  ],
  "summary": {
    "total": 10,
    "passed": 8,
    "failed": 2,
    "success_rate": 0.8
  }
}
```

---

## Default Models

From `taskConfig.ts`:

**Standard evals:**

- `google/gemini-2.0-flash`
- `openai/gpt-4.1-mini`
- `anthropic/claude-haiku-4-5`

**Agent evals:**

- `anthropic/claude-sonnet-4-20250514`

**CUA (Computer Use Agent) evals:**

- `openai/computer-use-preview-2025-03-11`
- `google/gemini-2.5-computer-use-preview-10-2025`
- `anthropic/claude-sonnet-4-20250514`

---

## Adding New Evals

### 1. Create Task File

```typescript
// tasks/my_task.ts
import { EvalFunction } from "../types/evals";

export const my_task: EvalFunction = async ({
  v3,
  logger,
  debugUrl,
  sessionUrl,
}) => {
  // Implementation
};
```

### 2. Register in Config

```json
// evals.config.json
{
  "tasks": [{ "name": "my_task", "categories": ["extract"] }]
}
```

### 3. Run and Verify

```bash
pnpm evals my_task --trials=1
```

### 4. Check Results

```bash
cat eval-summary.json | jq '.passed[] | select(.eval == "my_task")'
```

---

## Best Practices

1. **Always close Stagehand** - Use `finally` block with `await v3.close()`
2. **Log intermediate results** - Use `logger.log()` for debugging
3. **Handle errors gracefully** - Catch and return error details
4. **Use specific assertions** - Prefer exact match over fuzzy matching
5. **Test locally first** - Run with `--env=local` before Browserbase
6. **Keep tasks focused** - One clear objective per task
7. **Use V3Evaluator for complex checks** - When exact match isn't possible
