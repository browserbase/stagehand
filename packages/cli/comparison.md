# CLI Comparison: agent-browser vs stagehand CLI

## Session/Daemon Management Comparison

| Aspect | agent-browser | stagehand CLI |
|--------|--------------|---------------|
| **IPC Mechanism** | Unix sockets (Unix) / TCP ports (Windows) | Unix sockets only |
| **Session ID** | Env var `AGENT_BROWSER_SESSION` or CLI arg | `--session <name>` flag |
| **State Files** | PID + port files (Windows) + stream port | PID + WebSocket URL files |
| **Browser Engine** | Playwright (Chromium/Firefox/WebKit) | Chrome via CDP directly |
| **Auto-launch** | On first non-launch command | On any command via `ensureDaemon()` |
| **Stream Server** | Optional WebSocket preview server | None |

## Command Primitives Comparison

| Category | agent-browser | stagehand CLI | Notes |
|----------|--------------|---------------|-------|
| **Navigation** | `navigate`, `back`, `forward`, `reload`, `url`, `title` | `open`, `back`, `forward`, `reload`, `get url`, `get title` | Equivalent |
| **Coordinate Actions** | `mousemove`, `mousedown`, `mouseup`, `wheel` | `click <x> <y>`, `hover <x> <y>`, `scroll`, `drag` | Stagehand has higher-level coordinate APIs |
| **Element Selection** | `getbyrole`, `getbytext`, `getbylabel`, `getbyplaceholder`, `getbytestid`, `nth` | Deep locators (CSS, XPath, `>>` hop) | Different paradigms |
| **Keyboard** | `type`, `fill`, `press`, `keyboard`, `keydown`, `keyup`, `inserttext` | `type`, `fill`, `press` | agent-browser more granular |
| **Element State** | `isvisible`, `isenabled`, `ischecked`, `count`, `boundingbox` | `is visible`, `is checked`, `get box`, `get visible` | Similar |
| **Screenshots** | `screenshot` (PNG/JPEG, element/page) | `screenshot` (PNG/JPEG, fullpage, clip) | Similar |
| **Accessibility** | `snapshot` with `e1`, `e2` refs → Playwright selectors | `snapshot` with `[0-1]` refs → XPath + CSS selectors | Different ref systems |
| **Tab Management** | `tab_new`, `tab_list`, `tab_switch`, `tab_close`, `window_new` | `newpage`, `pages` | agent-browser more complete |
| **Cookies/Storage** | `cookies_get/set/clear`, `storage_get/set/clear`, `state_save/load` | None | Missing in stagehand |
| **Network** | `route`, `unroute`, `requests`, `headers`, `credentials`, `offline` | None | Missing in stagehand |
| **Tracing** | `trace_start/stop`, `har_start/stop`, `video`, `screencast` | None | Missing in stagehand |
| **Evaluate** | `evaluate`, `evalhandle`, `addscript`, `addinitscript`, `expose` | `eval` | agent-browser more complete |
| **Wait** | `wait`, `waitforurl`, `waitforloadstate`, `waitforfunction`, `waitfordownload` | `wait load`, `wait selector`, `wait timeout` | agent-browser more options |
| **Form Controls** | `check`, `uncheck`, `select`, `multiselect`, `upload`, `setvalue` | `select` | agent-browser more complete |
| **Dialogs** | `dialog` (accept/dismiss handler) | None | Missing in stagehand |
| **Frames** | `frame`, `mainframe` | Deep locator `>>` hops | Different approaches |

## Pros/Cons

### agent-browser
**Pros:**
- Multi-browser support (Chromium, Firefox, WebKit)
- Windows support via TCP fallback
- Comprehensive command set (90+ commands)
- State persistence (cookies, storage, save/load)
- Network interception and mocking
- Tracing and recording capabilities
- Playwright-based selectors (semantic, robust)
- Stream server for real-time preview

**Cons:**
- Large dependency (Playwright)
- No direct CDP access
- No AI-specific optimizations
- Refs are sequential (`e1`, `e2`) - lose meaning across snapshots

### stagehand CLI
**Pros:**
- Direct CDP control (lower overhead)
- XPath-based refs with frame prefix (`[0-1]`) - stable addressing
- CSS selector generation in snapshot
- URL extraction in snapshot (`urlMap`)
- Coordinate-based actions with XPath return
- Smaller footprint (Chrome-only)
- Built on battle-tested Stagehand understudy layer
- Shadow DOM and OOPIF handling

**Cons:**
- Chrome-only
- Unix-only (no Windows TCP fallback)
- Fewer commands (30 vs 90+)
- No network interception
- No state persistence
- No tracing/recording
- No dialog handling

## Architecture Differences

```
agent-browser:
┌─────────┐     ┌────────┐     ┌────────────┐
│ CLI     │────▶│ Daemon │────▶│ Playwright │
│ client  │ IPC │ server │     │ Browser    │
└─────────┘     └────────┘     └────────────┘

stagehand CLI:
┌─────────┐     ┌────────┐     ┌─────────────┐
│ CLI     │────▶│ Daemon │────▶│ V3Context   │────▶ Chrome CDP
│ client  │ IPC │ server │     │ (understudy)│
└─────────┘     └────────┘     └─────────────┘
```

The key difference: agent-browser wraps Playwright's high-level API, while stagehand CLI uses direct CDP via the understudy layer, giving more control but requiring more implementation work for advanced features.
