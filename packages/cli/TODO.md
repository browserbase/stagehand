# Stagehand CLI - Feature Parity TODO

Based on comparison with [agent-browser](https://github.com/vercel-labs/agent-browser), these items are needed for feature parity.

## Session/Daemon Enhancements

- [ ] **STAGEHAND_SESSION env var** - Allow session name via environment variable (like `AGENT_BROWSER_SESSION`)

## Tab Management

- [x] **tab_switch** - Switch to tab by index
- [x] **tab_close** - Close tab by index
- [x] **newpage** - Create new tab (already implemented as `newpage`)
- [x] **pages** - List tabs (already implemented as `pages`)

## Cookies & Storage

- [ ] **cookies_get** - Retrieve cookies (optionally by URL)
- [ ] **cookies_set** - Set cookies
- [ ] **cookies_clear** - Clear all cookies
- [ ] **storage_get** - Read localStorage/sessionStorage
- [ ] **storage_set** - Write to localStorage/sessionStorage
- [ ] **storage_clear** - Clear storage

## Dialog Handling

- [ ] **dialog** - Set handler for alert/confirm/prompt dialogs (accept/dismiss with optional text)

## Form Controls

- [ ] **check** - Check a checkbox
- [ ] **uncheck** - Uncheck a checkbox
- [ ] **upload** - Set files on file input
- [x] **select** - Select dropdown option (already implemented)
- [x] **fill** - Fill input (already implemented)

## Wait Commands

- [ ] **waitforurl** - Wait for URL to match pattern
- [x] **wait load** - Wait for load state (already implemented)
- [x] **wait selector** - Wait for selector (already implemented)
- [x] **wait timeout** - Fixed delay (already implemented)

## Keyboard

- [ ] **keydown** - Press key down without releasing
- [ ] **keyup** - Release a pressed key
- [x] **press** - Press and release key (already implemented)
- [x] **type** - Type text (already implemented)

## Network

- [x] **network on/off** - Enable/disable network capture to filesystem
- [x] **network path** - Get capture directory path for agent filesystem access
- [x] **network clear** - Clear captured requests
- [ ] **headers** - Set extra HTTP headers for all requests

## Not Planned (for now)

These features from agent-browser are not planned for immediate parity:

- **Windows TCP support** - Unix sockets only for now
- **Multi-browser** - Chrome only (via CDP)
- **Stream server** - Real-time preview WebSocket server
- **Tracing/HAR** - `trace_start/stop`, `har_start/stop`
- **Video/Screencast** - Recording capabilities
- **Network mocking** - `route`, `unroute` for request interception
- **State persistence** - `state_save`, `state_load`

## Already Implemented

These commands are already at parity or have stagehand-specific equivalents:

| Category | Commands |
|----------|----------|
| Navigation | `open`, `back`, `forward`, `reload` |
| Page Info | `get url`, `get title`, `get text`, `get html`, `get value`, `get box` |
| Coordinate Actions | `click`, `hover`, `scroll`, `drag` |
| Keyboard | `type`, `fill`, `press` |
| Element State | `is visible`, `is checked`, `get visible`, `get checked` |
| Screenshots | `screenshot` (PNG/JPEG, fullpage, clip) |
| Accessibility | `snapshot` (with XPath, CSS, URL maps) |
| Tabs | `newpage`, `pages` |
| Viewport | `viewport` |
| Evaluate | `eval` |
| Wait | `wait load`, `wait selector`, `wait timeout` |
| Daemon | `start`, `stop`, `status` |
