# Chromie Contribution Guidelines

This file contains guidelines for Chromie (AI coding assistant) when contributing to Stagehand.

## Core Principle: Test-First Bug Fixing

**Every bug fix MUST include a failing test that proves the bug exists.**

### Workflow

1. **Analyze the bug** - Understand the root cause
2. **Write a failing test** - Create a test that fails with the current code
3. **Verify the test fails** - Run `pnpm test` to confirm
4. **Implement the fix** - Write minimal code to fix the bug
5. **Verify the test passes** - Run `pnpm test` to confirm
6. **Create PR** - Submit with both test and fix

### Why Test-First?

- **Proves understanding** - The test demonstrates you understand the bug
- **Prevents regression** - The test catches if the bug returns
- **Documents behavior** - The test explains expected behavior
- **Validates the fix** - Green tests prove the fix works

---

## Test Location Guide

| Bug Type | Test Location | Test Framework |
|----------|---------------|----------------|
| Core handler bugs | `packages/core/lib/v3/tests/*.spec.ts` | Playwright Test |
| Extract failures | `packages/core/lib/v3/tests/` + `packages/evals/tasks/extract_*.ts` | Playwright + Evals |
| Act failures | `packages/core/lib/v3/tests/` + `packages/evals/tasks/` | Playwright + Evals |
| Agent bugs | `packages/core/lib/v3/tests/agent-*.spec.ts` | Playwright Test |
| Shadow DOM issues | `packages/core/lib/v3/tests/shadow-iframe.spec.ts` | Playwright Test |
| iframe issues | `packages/core/lib/v3/tests/frame-*.spec.ts` | Playwright Test |

### When to Write Playwright Tests vs Evals

**Playwright Tests** (`packages/core/lib/v3/tests/`):
- Unit/integration tests for specific functionality
- Fast, deterministic tests
- Can use mock servers or static HTML
- Run with `pnpm test`

**Evals** (`packages/evals/tasks/`):
- End-to-end tests against real websites
- Test real-world scenarios
- May be flaky due to site changes
- Run with `pnpm evals`

---

## Test Template

### Playwright Test

```typescript
// packages/core/lib/v3/tests/bug-description.spec.ts
import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";

test.describe("Bug: [Description]", () => {
  let stagehand: Stagehand;

  test.beforeEach(async () => {
    stagehand = new Stagehand({ env: "LOCAL", verbose: 0 });
    await stagehand.init();
  });

  test.afterEach(async () => {
    await stagehand.close();
  });

  test("should [expected behavior]", async () => {
    const page = stagehand.context.pages()[0];

    // Setup: Navigate to test page or mock scenario
    await page.goto("https://example.com");

    // Action: Perform the operation that was broken
    const result = await stagehand.extract("extract the title");

    // Assert: Verify expected behavior
    expect(result.extraction).toBe("Expected Title");
  });
});
```

### Eval Task

```typescript
// packages/evals/tasks/bug_description.ts
import { EvalFunction } from "../types/evals";

export const bug_description: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // Perform the operation that was broken
    const result = await v3.extract("extract the data");

    logger.log({
      message: "Extraction result",
      level: 1,
      auxiliary: { result: { value: result, type: "object" } },
    });

    // Assert expected behavior
    return {
      _success: result.extraction === "expected value",
      result,
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

## Common Bug Patterns

### Selector/Element Not Found

**Symptoms**: `XPathResolutionError`, `StagehandElementNotFoundError`

**Test approach**:
```typescript
test("should handle dynamic content loading", async () => {
  // Navigate to page with dynamic content
  // Wait for content to load
  // Perform action
  // Assert success
});
```

### Shadow DOM Issues

**Symptoms**: `StagehandShadowRootMissingError`, elements inside shadow DOM not found

**Test approach**:
```typescript
test("should interact with shadow DOM elements", async () => {
  // Navigate to page with shadow DOM
  // Use deepLocator or appropriate method
  // Assert element is found and actionable
});
```

### Timeout Issues

**Symptoms**: `ActTimeoutError`, `ExtractTimeoutError`

**Test approach**:
```typescript
test("should complete within timeout", async () => {
  // Set explicit timeout
  // Perform action that was timing out
  // Assert completes successfully
});
```

### LLM Response Parsing

**Symptoms**: `ZodSchemaValidationError`, malformed extraction

**Test approach**:
```typescript
test("should extract data matching schema", async () => {
  // Define schema
  // Extract with schema
  // Assert structure matches
});
```

---

## PR Requirements

### Title Format

```
fix(component): brief description of fix

Examples:
fix(actHandler): handle shadow DOM elements in nested iframes
fix(extractHandler): parse URLs correctly when schema uses z.string().url()
fix(agent): prevent infinite loop when task is already complete
```

### PR Body Template

```markdown
## Problem

[Describe the bug - what was happening?]

## Root Cause

[What caused the bug?]

## Solution

[How does this fix address the root cause?]

## Test Plan

- [ ] Added failing test that reproduces the bug
- [ ] Verified test fails before fix
- [ ] Verified test passes after fix
- [ ] Ran full test suite: `pnpm test`
- [ ] (If applicable) Ran relevant evals: `pnpm evals [category]`

## Related Issues

Fixes #[issue-number]
```

---

## Code Style

### Follow Existing Patterns

- Look at surrounding code for style guidance
- Use existing utilities (don't reinvent)
- Follow handler pattern for new functionality
- Keep changes minimal and focused

### Error Handling

- Throw specific error types from `types/public/sdkErrors.ts`
- Include helpful error messages
- Log at appropriate verbosity levels

### TypeScript

- Use strict types (no `any` unless necessary)
- Export types from `types/public/` for public API
- Keep internal types in `types/private/`

---

## Running Tests

### Before Submitting PR

```bash
# Build the project
pnpm build

# Run all tests
pnpm test

# Run specific test file
pnpm test packages/core/lib/v3/tests/my-test.spec.ts

# Run e2e tests locally
pnpm e2e:local

# Run relevant evals (if applicable)
pnpm evals [task-name]
```

### Test Environment

- **Local testing**: Uses local Chrome via `chrome-launcher`
- **Browserbase testing**: Uses remote browser sessions
- Default to local for faster iteration

---

## Common Mistakes to Avoid

1. **Don't skip the failing test** - Every fix needs a test
2. **Don't modify unrelated code** - Keep changes focused
3. **Don't add unnecessary abstractions** - Simpler is better
4. **Don't forget to close Stagehand** - Always use `finally { await v3.close() }`
5. **Don't hardcode timeouts** - Use configurable values
6. **Don't ignore TypeScript errors** - Fix them properly
7. **Don't add console.log** - Use the logger system

---

## Key Files for Common Fixes

| Issue Type | Key Files |
|------------|-----------|
| Action execution | `handlers/actHandler.ts`, `understudy/page.ts` |
| Data extraction | `handlers/extractHandler.ts`, `utils.ts` |
| Element selection | `understudy/a11y/snapshot.ts`, `dom/` |
| Shadow DOM | `understudy/page.ts`, `dom/` |
| Agent behavior | `handlers/v3AgentHandler.ts`, `agent/tools/` |
| Timeouts | `handlers/handlerUtils/timeoutGuard.ts` |
| LLM inference | `llm/LLMClient.ts`, `inference.ts` |
| Error handling | `types/public/sdkErrors.ts` |

---

## Escalation Context

When receiving an escalation from Slack, extract:

1. **Bug description** - What's not working?
2. **Reproduction steps** - How to trigger the bug?
3. **Error message** - Exact error text if available
4. **Environment** - Local or Browserbase? Which model?
5. **Code snippet** - User's code if provided

Use this context to:
1. Write a focused test that reproduces the issue
2. Identify the root cause in the codebase
3. Implement a minimal fix
4. Verify the fix addresses the original report
