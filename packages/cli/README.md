# Stagehand CLI

A headless browser automation CLI designed for AI agents, built on Stagehand's battle-tested understudy primitives. Provides both coordinate-based and element-based browser control with proper cross-iframe support.

## Installation

```bash
cd packages/cli
npm install
bun run build
npm link

stagehand --help
```

Requires Chrome/Chromium installed on the system.

## Daemon Architecture

The CLI uses a persistent daemon to maintain browser state across commands. This means you can run multiple commands without launching a new browser each time:

```bash
stagehand open https://example.com    # Starts daemon, opens page
stagehand snapshot -c                 # Uses same browser, shows page content
stagehand click 450 320               # Clicks on the same page
stagehand stop                        # Stops daemon and closes browser
```

### Daemon Commands

```bash
stagehand start [--headless]          # Start daemon explicitly
stagehand stop                        # Stop daemon and close browser
stagehand stop --force                # Force kill Chrome if daemon is unresponsive
stagehand status                      # Check if daemon is running
```

### Self-Healing Sessions

The CLI automatically recovers from stale sessions. If the daemon or Chrome crashes, subsequent commands will:
1. Detect the failure
2. Clean up stale processes and files
3. Restart the daemon
4. Retry the command

This means agents don't need to check status or handle recovery - commands "just work".

### Multiple Sessions

Run multiple independent browser instances with `--session`:

```bash
stagehand --session work open https://github.com
stagehand --session personal open https://gmail.com
stagehand --session work snapshot -c  # Shows GitHub
stagehand --session personal snapshot -c  # Shows Gmail
```

### Direct Connection Mode

Bypass the daemon entirely with `--ws` to connect to an existing Chrome instance:

```bash
stagehand --ws ws://localhost:9222/devtools/browser/xxx open https://example.com
```

## Core Capabilities

The CLI provides comprehensive browser control:

- **Navigation**: Open URLs, go back/forward, reload, wait for load states
- **Coordinate actions**: Click, hover, scroll, drag at exact pixel positions
- **Element interaction**: Fill inputs, select dropdowns, check visibility
- **Information retrieval**: Get text, HTML, attributes, bounding boxes
- **Screenshots**: Full page, clipped regions, with animation control
- **Accessibility snapshots**: Hybrid DOM+a11y trees with XPath and CSS selector mappings

## Selector System

Two approaches for element targeting:

### 1. Ref-based Element Targeting (AI-optimized)

The `snapshot` command generates refs like `[0-1]`, `[0-3]` that can be used directly in subsequent commands:

```bash
$ stagehand snapshot -c
[0-1] RootWebArea: Example Domain
  [0-3] heading: Example Domain
  [0-8] link: More information...

# Use refs in commands with @ prefix
$ stagehand get text @0-8
{"text": "More information..."}

$ stagehand highlight @0-8
{"highlighted": true}
```

The daemon caches the ref mappings from the last snapshot, so you can use refs like `@0-8` without passing the full selector. Refs work with: `get`, `fill`, `select`, `highlight`, `is`, `wait selector`.

**Ref syntax options:**
- `@0-8` — recommended format
- `@[0-8]` — alternative with brackets
- `0-8` — plain format also works

The full snapshot output includes mappings:
- **xpathMap**: `"0-8": "/html[1]/body[1]/div[1]/p[2]/a[1]"` — reliable cross-frame targeting
- **cssMap**: `"0-8": "a[href=\"https://...\"]"` — CSS selectors when available (preferred for speed)
- **urlMap**: `"0-8": "https://..."` — extracted URLs from links

**Note:** Refs with CSS selectors (like links with hrefs) resolve faster than XPath-only refs.

### 2. Deep Locators

CSS, XPath, and cross-iframe selectors with `>>` hop notation:

```bash
stagehand fill "#email" "user@example.com"           # Fills and presses Enter (default)
stagehand fill "#search" "query"                     # Also presses Enter after fill
stagehand fill "#email" "user@example.com" --no-press-enter  # Fill only, no Enter
stagehand fill "iframe >> #inner-input" "cross-frame value"
```

## Key Features for Agents

### JSON Output

All commands support `--json` for machine-readable output:

```bash
$ stagehand --json get title
{"title":"Example Domain"}

$ stagehand --json snapshot
{"tree":"...","xpathMap":{...},"cssMap":{...},"urlMap":{...}}
```

### Click by Ref (Recommended)

Click elements directly using refs from the snapshot - no need to get coordinates first:

```bash
$ stagehand snapshot -c
[0-5] button: Submit
[0-8] link: Learn more

$ stagehand click @0-5
{"clicked":true,"ref":"@0-5","x":450,"y":320}
```

### Coordinate Actions

For precise pixel-level control, use `click_xy`:

```bash
$ stagehand click_xy 450 320 --xpath
{"clicked":true,"xpath":"/html[1]/body[1]/button[1]"}
```

### Browser Visibility

```bash
stagehand open https://example.com             # Visible browser (default)
stagehand --headed open https://example.com    # Explicit visible browser
stagehand --headless open https://example.com  # No visible window
```

Pass `--headless` or `--headed` on the first command to set the daemon's mode. Subsequent commands use the same browser.

### Default Viewport

The browser launches with a consistent default viewport of 1288x711 pixels (matching Stagehand core). You can change this at any time:

```bash
stagehand viewport 1920 1080                   # Set custom viewport
stagehand viewport 1920 1080 --scale 2         # With device scale factor
```

### Wait Strategies

```bash
stagehand wait load networkidle          # Wait for network idle
stagehand wait selector "#loaded"        # Wait for element
stagehand wait selector "#gone" -s hidden # Wait for element to disappear
stagehand wait timeout 2000              # Fixed delay
```

## Command Reference

### Daemon Control

```bash
stagehand start [--headless]          # Start browser daemon
stagehand stop [--force]              # Stop daemon and close browser
stagehand status                      # Check daemon status (returns JSON)
```

### Navigation

```bash
stagehand open <url> [--wait load|domcontentloaded|networkidle]
stagehand reload
stagehand back
stagehand forward
```

### Click Actions

```bash
stagehand click <ref> [--button left|right|middle] [--count n]   # Click by ref (e.g., @0-5)
stagehand click_xy <x> <y> [--button] [--count n] [--xpath]      # Click at coordinates
```

### Coordinate Actions

```bash
stagehand hover <x> <y> [--xpath]
stagehand scroll <x> <y> <deltaX> <deltaY> [--xpath]
stagehand drag <fromX> <fromY> <toX> <toY> [--steps n] [--xpath]
```

### Keyboard Input

```bash
stagehand type "Hello world" [--delay ms] [--mistakes]
stagehand press Enter|Tab|Escape|Cmd+A|Ctrl+C
```

The `--mistakes` flag enables human-like typing with occasional typos and corrections.

### Element Actions

```bash
stagehand fill <selector> <value> [--no-press-enter]
stagehand select <selector> <value...>
stagehand highlight <selector> [--duration ms]
```

By default, `fill` presses Enter after filling (useful for search boxes). Use `--no-press-enter` to disable.

### Page Information

```bash
stagehand get url
stagehand get title
stagehand get text <selector>
stagehand get html <selector>
stagehand get value <selector>
stagehand get box <selector>           # Returns {x, y} center coordinates
stagehand get visible <selector>
stagehand get checked <selector>
```

### Screenshots

```bash
stagehand screenshot [path]            # Save to file or output base64
stagehand screenshot -f                # Full page
stagehand screenshot -t jpeg -q 85     # JPEG with quality
stagehand screenshot --clip '{"x":0,"y":0,"width":800,"height":600}'
stagehand screenshot --no-animations   # Disable CSS animations
stagehand screenshot --hide-caret      # Hide text cursor
```

### Accessibility Snapshot

```bash
stagehand snapshot                     # Full output with all maps
stagehand snapshot -c                  # Compact tree only
```

### Multi-Tab

```bash
stagehand pages                        # List all open tabs
stagehand newpage [url]                # Open new tab
stagehand tab_switch <index>           # Switch to tab by index
stagehand tab_close [index]            # Close tab by index (defaults to last tab)
```

### Viewport & Misc

```bash
stagehand viewport <width> <height> [--scale factor]
stagehand eval "document.title"
stagehand cursor                       # Enable visual cursor overlay
stagehand is visible <selector>
stagehand is checked <selector>
```

## Optimal AI Workflow

1. **Navigate** to target page (browser auto-starts)
2. **Snapshot** to get the accessibility tree with refs
3. **Click/Fill** using refs directly (e.g., `@0-5`)
4. **Re-snapshot** after actions to verify state changes
5. **Stop** when done

```bash
stagehand open https://example.com
stagehand snapshot -c
# [0-5] textbox: Search
# [0-8] button: Submit
stagehand fill @0-5 "my query"
stagehand click @0-8
stagehand snapshot -c  # Verify result
stagehand stop
```

## CSS Selector Generation

The snapshot automatically generates CSS selectors for elements with identifiable attributes, prioritized as:

1. ID (`#myId`)
2. Test IDs (`[data-testid="..."]`, `[data-test-id="..."]`, `[data-cy="..."]`)
3. Form element names (`input[name="..."]`)
4. Accessibility labels (`[aria-label="..."]`)
5. Input type + placeholder (`input[type="email"][placeholder="..."]`)
6. Link hrefs (`a[href="..."]`)
7. Semantic classes (utility classes like Tailwind are filtered out)
8. Role attributes (`[role="button"]`)

## Architecture

Built on Stagehand's understudy layer:

- **V3Context**: CDP connection and page management
- **Page**: Navigation, coordinates, screenshots
- **Locator**: Element actions with cross-iframe support
- **a11y/**: Hybrid DOM + accessibility tree construction with multi-frame XPath resolution

Benefits:
- Proper OOPIF (out-of-process iframe) handling
- Shadow DOM piercing
- Robust CDP session management
- Production-tested at scale

## Development

```bash
# Run without building
cd /path/to/stagehand
npx tsx packages/cli/src/index.ts <command>

# Rebuild after changes
cd packages/cli
bun run build
```

## License

MIT
