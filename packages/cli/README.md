# Browse CLI

Browser automation CLI for AI agents. Built on [Stagehand](https://github.com/browserbase/stagehand), providing raw browser control without requiring LLM integration.

## Installation

```bash
npm install -g @browserbasehq/browse-cli
```

Requires Chrome/Chromium installed on the system.

## Quick Start

```bash
# Navigate to a URL (auto-starts browser daemon)
browse open https://example.com

# Take a snapshot to get element refs
browse snapshot -c

# Click an element by ref
browse click @0-5

# Type text
browse type "Hello, world!"

# Take a screenshot
browse screenshot ./page.png

# Stop the browser
browse stop
```

## How It Works

Browse uses a daemon architecture for fast, stateful interactions:

1. **First command** auto-starts a Chrome browser daemon
2. **Subsequent commands** reuse the same browser session
3. **State persists** between commands (cookies, refs, etc.)
4. **Multiple sessions** supported via `--session` or `BROWSE_SESSION` env var

### Self-Healing Sessions

The CLI automatically recovers from stale sessions. If the daemon or Chrome crashes:
1. Detects the failure
2. Cleans up stale processes and files
3. Restarts the daemon
4. Retries the command

Agents don't need to handle recovery - commands "just work".

## Commands

### Navigation

```bash
browse open <url> [--wait load|domcontentloaded|networkidle] [-t|--timeout ms]
browse reload
browse back
browse forward
```

The `--timeout` flag (default: 30000ms) controls how long to wait for the page load state. Use longer timeouts for slow-loading pages:

```bash
browse open https://slow-site.com --timeout 60000
```

### Click Actions

```bash
browse click <ref> [-b left|right|middle] [-c count]  # Click by ref (e.g., @0-5)
browse click_xy <x> <y> [--button] [--xpath]          # Click at coordinates
```

### Coordinate Actions

```bash
browse hover <x> <y> [--xpath]
browse scroll <x> <y> <deltaX> <deltaY> [--xpath]
browse drag <fromX> <fromY> <toX> <toY> [--steps n] [--xpath]
```

### Keyboard

```bash
browse type <text> [-d delay] [--mistakes]
browse press <key>  # e.g., Enter, Tab, Cmd+A
```

### Forms

```bash
browse fill <selector> <value> [--no-press-enter]
browse select <selector> <values...>
browse highlight <selector> [-d duration]
```

### Page Info

```bash
browse get url
browse get title
browse get text <selector>
browse get html <selector>
browse get value <selector>
browse get box <selector>  # Returns center coordinates

browse snapshot [-c|--compact]  # Accessibility tree with refs
browse screenshot [path] [-f|--full-page] [-t png|jpeg]
```

### Waiting

```bash
browse wait load [state]
browse wait selector <selector> [-t timeout] [-s visible|hidden|attached|detached]
browse wait timeout <ms>
```

### Multi-Tab

```bash
browse pages          # List all tabs
browse newpage [url]  # Open new tab
browse tab_switch <n> # Switch to tab by index
browse tab_close [n]  # Close tab (default: last)
```

### Network Capture

Capture HTTP requests to the filesystem for inspection:

```bash
browse network on     # Start capturing requests
browse network off    # Stop capturing
browse network path   # Get capture directory path
browse network clear  # Clear captured requests
```

Captured requests are saved as directories:

```
/tmp/browse-default-network/
  001-GET-api.github.com-repos/
    request.json      # method, url, headers, body
    response.json     # status, headers, body, duration
```

### Daemon Control

```bash
browse start          # Explicitly start daemon
browse stop [--force] # Stop daemon
browse status         # Check daemon status
```

## Global Options

| Option | Description |
|--------|-------------|
| `--session <name>` | Session name for multiple browsers (default: "default") |
| `--headless` | Run Chrome in headless mode |
| `--headed` | Run Chrome with visible window (default) |
| `--ws <url>` | Connect to existing Chrome via CDP WebSocket |
| `--json` | Output as JSON |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BROWSE_SESSION` | Default session name (alternative to `--session`) |

## Element References

After running `browse snapshot`, you can reference elements by their ref ID:

```bash
# Get snapshot with refs
browse snapshot -c

# Output includes refs like [0-5], [1-2], etc.
# RootWebArea "Example" url="https://example.com"
#   [0-0] link "Home"
#   [0-1] link "About"
#   [0-2] button "Sign In"

# Click using ref (multiple formats supported)
browse click @0-2       # @ prefix
browse click 0-2        # Plain ref
browse click ref=0-2    # Explicit prefix
```

The full snapshot output includes mappings:
- **xpathMap**: Cross-frame XPath selectors
- **cssMap**: Fast CSS selectors when available
- **urlMap**: Extracted URLs from links

## Multiple Sessions

Run multiple browser instances simultaneously:

```bash
# Terminal 1
BROWSE_SESSION=session1 browse open https://google.com

# Terminal 2
BROWSE_SESSION=session2 browse open https://github.com

# Or use --session flag
browse --session work open https://slack.com
browse --session personal open https://twitter.com
```

## Direct CDP Connection

Connect to an existing Chrome instance:

```bash
# Start Chrome with remote debugging
google-chrome --remote-debugging-port=9222

# Connect via WebSocket
browse --ws ws://localhost:9222/devtools/browser/... open https://example.com
```

## Optimal AI Workflow

1. **Navigate** to target page (browser auto-starts)
2. **Snapshot** to get the accessibility tree with refs
3. **Click/Fill** using refs directly (e.g., `@0-5`)
4. **Re-snapshot** after actions to verify state changes
5. **Stop** when done

```bash
browse open https://example.com
browse snapshot -c
# [0-5] textbox: Search
# [0-8] button: Submit
browse fill @0-5 "my query"
browse click @0-8
browse snapshot -c  # Verify result
browse stop
```

## Troubleshooting

### Chrome not found

The CLI uses your system Chrome/Chromium. If not found:

```bash
# macOS - Install Chrome or set path
export CHROME_PATH=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome

# Linux - Install chromium
sudo apt install chromium-browser
```

### Stale daemon

If the daemon becomes unresponsive:

```bash
browse stop --force
```

### Permission denied on socket

```bash
# Clean up stale socket files
rm /tmp/browse-*.sock /tmp/browse-*.pid
```

## Platform Support

- macOS (Intel and Apple Silicon)
- Linux (x64 and arm64)

Windows support requires WSL or TCP socket implementation.

## Development

```bash
# Clone and setup (in monorepo)
cd packages/cli
npm install          # Install dependencies first!
npm run build        # Build the CLI

# Run without building (for development)
npm run dev -- <command>

# Or with tsx directly
npx tsx src/index.ts <command>

# Run linting and formatting
npm run lint
npm run format
```

## License

MIT - see [LICENSE](./LICENSE)

## Related

- [Stagehand](https://github.com/browserbase/stagehand) - AI web browser automation framework
- [Browserbase](https://browserbase.com) - Cloud browser infrastructure
