# Stagehand-CLI Session Isolation Implementation

## Summary

Successfully implemented agent-browser-style session isolation for stagehand-cli to enable safe concurrent test execution with remote browsers (Browserbase).

## Problem

Previously, when using `--ws` flag with stagehand-cli:
- Each command created a new ephemeral connection
- Multiple concurrent commands using `$BROWSERBASE_CONNECT_URL` could interfere with each other
- No session tracking or isolation between concurrent tests
- Risk of session contamination in parallel eval runs

## Solution

Implemented persistent daemon mode with CDP URL support, matching agent-browser's architecture:

### Key Changes

**1. Daemon Mode with CDP Support** (`packages/cli/src/index.ts`)

- Modified `runDaemon()` to accept `cdpUrl` parameter
- Forces LOCAL mode when CDP URL provided
- Connects to remote browser via CDP instead of launching local browser
- Stores CDP URL in session file for change detection

```typescript
async function runDaemon(
  session: string,
  headless: boolean,
  envOverride?: "LOCAL" | "BROWSERBASE",
  cdpUrl?: string  // NEW
): Promise<void>
```

**2. Session Isolation**

- Each `--session` name gets isolated daemon process
- Session files stored in `/tmp/browse-{session}.*`:
  - `.sock` - Unix socket for IPC
  - `.pid` - Daemon process ID
  - `.ws` - WebSocket URL
  - `.cdp` - CDP URL (NEW)

**3. CDP URL Change Detection**

- Detects when CDP URL changes for same session name
- Automatically restarts daemon with new connection
- Prevents stale connections

```typescript
async function ensureDaemon(..., cdpUrl?: string): Promise<void> {
  // Check if CDP URL changed
  if (isRunning && cdpUrl) {
    const storedCdpUrl = await fs.readFile(getCdpPath(session), "utf-8");
    if (storedCdpUrl !== cdpUrl) {
      // Restart daemon with new URL
      await killChromeProcesses(session);
      await cleanupStaleFiles(session);
    }
  }
}
```

**4. Always Use Daemon**

- Removed direct connection bypass for `--ws` flag
- All commands now route through daemon (with or without CDP URL)
- Ensures consistent behavior and session isolation

```typescript
async function runCommand(command: string, args: unknown[]): Promise<unknown> {
  const cdpUrl = opts.ws || process.env.BROWSERBASE_CONNECT_URL;

  // Use daemon mode for ALL commands
  await ensureDaemon(session, headless, envOverride, cdpUrl);
  return sendCommand(session, command, args, headless, envOverride);
}
```

## Usage Pattern

### Concurrent Tests (Safe)

```bash
# Test A - session-A with CDP URL A
stagehand --session test-A --ws $BROWSERBASE_CONNECT_URL_A open https://example.com
stagehand --session test-A --ws $BROWSERBASE_CONNECT_URL_A snapshot -c

# Test B - session-B with CDP URL B (runs concurrently!)
stagehand --session test-B --ws $BROWSERBASE_CONNECT_URL_B open https://github.com
stagehand --session test-B --ws $BROWSERBASE_CONNECT_URL_B snapshot -c
```

### Session Lifecycle

1. First command with `--session X --ws $URL_X`:
   - Creates daemon for session X
   - Connects to remote browser via CDP URL
   - Stores CDP URL in `/tmp/browse-X.cdp`
   - Maintains persistent connection

2. Subsequent commands with same session:
   - Reuses existing daemon
   - Reuses existing connection (fast!)
   - Verifies CDP URL hasn't changed

3. Command with different CDP URL:
   - Detects URL change
   - Restarts daemon with new connection
   - Updates stored CDP URL

## Test Results

### Test 1: Basic Session ✅

```bash
./test-simple.sh
```

Result: Successfully connected to Browserbase session, navigated, and retrieved URL.

### Test 2: Concurrent Session Isolation ✅

```bash
./test-concurrent.sh
```

Result:
- Session A opened example.com
- Session B opened github.com (concurrently)
- No cross-contamination
- Both sessions maintained correct state

Output:
```
✅ SUCCESS: Sessions are properly isolated!
   - session-A is on example.com
   - session-B is on github.com
```

### Test 3: CDP URL Change Detection ✅

```bash
./test-cdp-change.sh
```

Result:
- First URL: Navigated to example.com
- Second URL with same session name: Detected change, restarted daemon
- Successfully navigated to github.com with new connection

Output:
```
[stagehand] CDP URL changed for session test-session, restarting daemon...
✅ SUCCESS: CDP URL change detected and daemon restarted correctly!
```

## Files Modified

1. `/Users/shrey/Developer/stagehand-cli/packages/cli/src/index.ts`
   - Added `cdpUrl` parameter to `runDaemon()`
   - Added `cdpUrl` parameter to `ensureDaemon()`
   - Added `getCdpPath()` helper function
   - Added CDP URL storage and change detection
   - Modified `runCommand()` to always use daemon
   - Updated help text for `--ws` flag

2. `/Users/shrey/Developer/browserbase-skills/skills/browser-automation/SKILL.md`
   - Updated documentation to mandate explicit `--ws` flag
   - Clarified session isolation behavior
   - Updated all command examples

## Benefits

1. **Safe Concurrent Execution**: Multiple tests can run in parallel without interference
2. **Performance**: Persistent connections mean faster subsequent commands
3. **Predictability**: Explicit `--ws` flag makes session URL visible
4. **Debugging**: Session files enable inspection of daemon state
5. **Flexibility**: Same session name can switch between different remote browsers

## Integration with Evals

The eval framework (`skillAgents.ts`) already creates unique Browserbase sessions per test and passes them via `BROWSERBASE_CONNECT_URL`. With these changes:

1. Each test subprocess gets unique `$BROWSERBASE_CONNECT_URL`
2. Skill commands use `--ws $BROWSERBASE_CONNECT_URL` (explicit)
3. Each test gets isolated session name (can use PID or test ID)
4. Concurrent tests won't interfere with each other

Example:
```typescript
// In skillAgents.ts (existing code that now works safely)
const sessionInfo = await createBrowserbaseSession();
const env = {
  BROWSERBASE_CONNECT_URL: sessionInfo.connectUrl,  // Unique per test
};

// Skill subprocess runs:
// stagehand --session ${testId} --ws $BROWSERBASE_CONNECT_URL open ...
```

## Next Steps

1. Update `skillAgents.ts` to pass unique session names to skill subprocesses
2. Run full eval suite with 10-20 concurrent tests
3. Monitor for any session-related issues
4. Document best practices for concurrent testing

## Verification Commands

```bash
# Check running daemons
ps aux | grep "stagehand.*daemon"

# Check session files
ls -la /tmp/browse-*.*

# Check stored CDP URLs
cat /tmp/browse-session-A.cdp

# Stop all sessions
for session in test-A test-B test-C; do
  stagehand --session $session stop
done
```

## Comparison with agent-browser

| Feature | agent-browser | stagehand-cli (NEW) | Status |
|---------|--------------|---------------------|--------|
| Session isolation via `--session` | ✅ | ✅ | **Matches** |
| Persistent daemon connection | ✅ | ✅ | **Matches** |
| CDP URL support | ✅ `--cdp` | ✅ `--ws` | **Matches** |
| CDP URL change detection | ✅ | ✅ | **Matches** |
| Session file storage | ✅ | ✅ | **Matches** |
| Concurrent execution safety | ✅ | ✅ | **Matches** |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Concurrent Test Execution                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              │
                 ┌────────────┴────────────┐
                 │                         │
         ┌───────▼────────┐        ┌──────▼────────┐
         │   Test A       │        │   Test B      │
         │   (subprocess) │        │  (subprocess) │
         └───────┬────────┘        └──────┬────────┘
                 │                         │
    BROWSERBASE_CONNECT_URL_A   BROWSERBASE_CONNECT_URL_B
                 │                         │
         ┌───────▼────────┐        ┌──────▼────────┐
         │  stagehand     │        │  stagehand    │
         │  --session A   │        │  --session B  │
         │  --ws $URL_A   │        │  --ws $URL_B  │
         └───────┬────────┘        └──────┬────────┘
                 │                         │
         ┌───────▼────────┐        ┌──────▼────────┐
         │  Daemon A      │        │  Daemon B     │
         │  (persistent)  │        │  (persistent) │
         └───────┬────────┘        └──────┬────────┘
                 │                         │
          CDP Connection            CDP Connection
                 │                         │
         ┌───────▼────────┐        ┌──────▼────────┐
         │  Browserbase   │        │  Browserbase  │
         │  Session A     │        │  Session B    │
         │  (example.com) │        │  (github.com) │
         └────────────────┘        └───────────────┘
```

## Implementation Date

January 28, 2026

## Tested By

All tests passing with Browserbase remote sessions.
