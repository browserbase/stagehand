# Stagehand Caching with Variables Demo

This demo showcases Stagehand's caching mechanism, specifically demonstrating:

1. **Privacy-Preserving Caching**: Variable VALUES are NOT stored in cache, only variable KEYS
2. **Cache Efficiency**: Different variable values still hit the same cache entry
3. **Agent Caching**: Testing whether `agent()` uses caching (it does!)

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Add your OPENAI_API_KEY to .env

# Run Demo 1: Act caching with variables
npm run demo:act-cache

# Run Demo 2: Agent caching test
npm run demo:agent-cache

# Run both demos
npm run demo:all
```

## How Stagehand Caching Works

### Act Caching with Variables

The key insight is that **cache keys are based on variable KEYS, not VALUES**.

```typescript
// This is how the cache key is generated:
cacheKey = hash({
  instruction: "Type %username% into the username field",
  url: "https://example.com/login",
  variableKeys: ["username"], // Only KEYS, not values!
});
```

This means:

- Running with `username = "john@example.com"` creates a cache entry
- Running with `username = "secret@example.com"` **HITS THE SAME CACHE**
- The actual username value is **NEVER STORED** in the cache file

### What's Stored in Cache

```json
{
  "version": 1,
  "instruction": "Type %username% into the username field",
  "url": "https://the-internet.herokuapp.com/login",
  "variableKeys": ["username"],
  "actions": [
    {
      "method": "fill",
      "selector": "#username",
      "arguments": ["%username%"]
    }
  ]
}
```

Notice:

- The `instruction` contains the placeholder `%username%`
- The `variableKeys` array lists which variables are expected
- The `arguments` contain `%username%` placeholder, NOT the actual value
- **No actual username values in the cache file!**

### At Replay Time

When a cache hit occurs:

1. Cached action is loaded (with `%username%` placeholder)
2. Current variable values are substituted
3. Action is executed with real values
4. No LLM call needed!

## Demo 1: Act Caching with Variables

This demo runs the same `act()` command with three different usernames:

```
Run 1: john.doe@example.com     -> Cache MISS (LLM inference)
Run 2: john.doe@example.com     -> Cache HIT (instant)
Run 3: jane.smith@example.com   -> Cache HIT (still works!)
Run 4: secret.user@example.com  -> Cache HIT (still works!)
```

**Key Takeaway**: Different usernames still hit the same cache because only the variable KEY is part of the cache key.

## Demo 2: Agent Caching Test

Tests whether `stagehand.agent()` uses caching:

- **Result**: YES, agent has full caching support
- Stores entire workflow (all steps)
- Replays steps without LLM calls

However, **agent does NOT support variables** like `act()` does. Variable data in agent instructions is stored in cache as-is.

## Comparison Table

| Feature              | `act()` Cache                    | `agent()` Cache                      |
| -------------------- | -------------------------------- | ------------------------------------ |
| Caching supported    | Yes                              | Yes                                  |
| Variables supported  | Yes                              | **No**                               |
| Privacy preservation | **Yes**                          | No                                   |
| Multi-step workflows | Single action                    | Full workflow                        |
| Cache key based on   | instruction + url + variableKeys | instruction + url + options + config |

## Performance Benefits

| Scenario         | Time per Action | Cost         |
| ---------------- | --------------- | ------------ |
| Cache MISS (LLM) | 1-3 seconds     | ~$0.001-0.01 |
| Cache HIT        | <100ms          | $0           |

For high-volume automation:

- 10,000 payments × 5 actions = 50,000 actions
- Without cache: ~$500-2,500, 15+ hours
- With cache: ~$0.50 (10 cache populating runs), <1 hour

## Privacy Use Cases

The variable caching mechanism is perfect for:

1. **Login Forms**: Different usernames, same cached action
2. **Payment Forms**: Different card numbers, never stored in cache
3. **Search Inputs**: Different queries, cached navigation
4. **Form Filling**: Sensitive data never persisted

```typescript
// Example: Login with sensitive credentials
await page.act("Type %email% into the email field", {
  variables: { email: "sensitive@example.com" },
});

await page.act("Type %password% into the password field", {
  variables: { password: "super-secret-password" },
});

// Cache files will contain:
// - %email% placeholder (not the actual email)
// - %password% placeholder (not the actual password)
```

## Future: Agent Cache with Variables

Currently, agent does NOT support variables. To add this functionality would require:

1. Variable placeholder syntax in agent instructions
2. Stripping variable values from cached steps
3. Value injection during replay
4. Cache key based on variable keys (like act)

This demo sets up the testing framework for when/if this feature is added.

## File Structure

```
stagehand-caching-demo/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── src/
│   ├── 01-act-cache-with-variables.ts   # Demo 1
│   └── 02-agent-cache-test.ts           # Demo 2
└── .cache/                              # Cache directory (created on run)
    ├── act-cache/                       # Act cache files
    └── agent-cache/                     # Agent cache files
```

## Commands

```bash
# Run demos
npm run demo:act-cache          # Demo 1: Act with variables
npm run demo:agent-cache        # Demo 2: Agent caching
npm run demo:all                # Both demos

# Cache management
npm run clear-cache             # Clear all cache files

# Run with fresh cache
npm run demo:act-cache -- --fresh
npm run demo:agent-cache -- --fresh

# Inspect cache contents
cat .cache/act-cache/*.json | jq .
cat .cache/agent-cache/*.json | jq .
```

## Environment Variables

| Variable                 | Required | Description                           |
| ------------------------ | -------- | ------------------------------------- |
| `OPENAI_API_KEY`         | Yes      | OpenAI API key for LLM calls          |
| `ANTHROPIC_API_KEY`      | No       | Anthropic API key (for Claude models) |
| `BROWSERBASE_API_KEY`    | No       | For running in Browserbase cloud      |
| `BROWSERBASE_PROJECT_ID` | No       | For running in Browserbase cloud      |

## Troubleshooting

### Cache not being hit

1. Make sure you're using the same instruction text
2. Check that the URL matches (exact match required)
3. Verify variable keys are the same (order matters)

### LLM errors

1. Check your `OPENAI_API_KEY` is set correctly
2. Ensure you have API credits available
3. Try a different model if rate limited

### Browser not launching

1. Make sure Playwright is installed: `npx playwright install chromium`
2. Check you're running in LOCAL env (not BROWSERBASE without credentials)
