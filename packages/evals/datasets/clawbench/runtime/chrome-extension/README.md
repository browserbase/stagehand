# ClawBench Chrome Extension

This is the source code for the ClawBench Chrome Extension, which acts as the client for the ClawBench benchmarking framework.

The extension is responsible for the following tasks:

- Collecting every browser action performed by the user or agent and sending it to the ClawBench server.
- Taking screenshots after browser actions, with high-frequency events throttled.
- Keeping the active tab aligned with the agent's work so server-side screen recording and screenshots capture the right browser state.

The extension should auto start when any non-built-in page is loaded, and should stop when the browser is closed. No UI or configuration is needed for the extension, as all configuration is done on the server side.

A `setup.sh` script is provided to load the extension into Chrome. Linux and macOS are supported.

## Files

| File | Description |
|------|-------------|
| `manifest.json` | Manifest V3 extension definition. Permissions: `activeTab`, `tabs`. Content scripts injected on all URLs. |
| `stealth.js` | Anti-bot-detection patches. Runs at `document_start` in `MAIN` world. Overrides `navigator.webdriver`, plugins, WebGL, permissions, etc. |
| `content.js` | Injected into every non-chrome:// page. Listens for DOM events, extracts metadata, sends to background. Runs at `document_idle` in `ISOLATED` world. |
| `background.js` | Service worker. Relays actions to server via HTTP POST. Captures screenshots with `chrome.tabs.captureVisibleTab`. |
| `setup.sh` | Detects Chrome/Chromium binary on macOS or Linux and launches with `--load-extension` and remote debugging enabled. |

## Event Capture

### Captured Events

`click`, `keydown`, `keyup`, `input`, `scroll`, `change`, `submit`, plus a synthetic `pageLoad` on each navigation.

### Throttling

High-frequency events (`scroll`, `input`) are throttled to one every 500ms. Screenshots are also throttled to one every 500ms.

### Action Payload

Each action sent to the server contains:

```json
{
  "type": "click",
  "timestamp": 1710000001234,
  "url": "https://example.com/",
  "target": {
    "tagName": "BUTTON",
    "id": "submit-btn",
    "className": "btn primary",
    "textContent": "Submit",
    "xpath": "/html[1]/body[1]/form[1]/button[1]"
  },
  "x": 255,
  "y": 245
}
```

Additional fields by event type:
- **click**: `x`, `y` (coordinates)
- **keydown/keyup**: `key` (key name)
- **input/change**: `value` (truncated to 200 chars)
- **scroll**: `scrollX`, `scrollY`
- **pageLoad**: `title`

## Anti-Bot-Detection (Stealth)

The extension includes `stealth.js`, a content script injected at `document_start` in the `MAIN` world — meaning it runs before any page JavaScript and patches the page's actual `window`/`navigator` objects (not the extension's isolated world). This reduces the chance of being blocked by reCAPTCHA, Cloudflare Turnstile, and similar bot-detection systems.

The stealth measures are split across three layers:

### Layer 1: Chrome Launch Flags (`entrypoint.sh`)

| Flag | What it does |
|------|-------------|
| Removed `--enable-automation` | Was explicitly telling Chrome to set `navigator.webdriver = true` and show the "controlled by automated software" infobar. Removing it eliminates both signals. |
| Removed `--disable-gpu` | Was disabling all GPU/WebGL rendering. Sites that fingerprint WebGL would see no renderer — a strong headless signal. |
| `--disable-blink-features=AutomationControlled` | Tells Blink not to set `navigator.webdriver = true`, even if CDP is attached. Belt-and-suspenders with the flag removal. |
| `--use-gl=angle --use-angle=swiftshader` | Enables software-rendered WebGL via SwiftShader through the ANGLE backend. This makes WebGL available with realistic renderer strings without a real GPU. Trade-off: higher CPU usage since all GL operations run in software. |
| `--enable-webgl` | Explicitly ensures WebGL contexts can be created. |
| `--remote-debugging-address=127.0.0.1` | CDP was previously bound to `0.0.0.0` (all interfaces). Now only accessible internally. External access still works through the `socat` forwarder on port 9223. Prevents page JavaScript from detecting CDP by probing network ports. |

### Layer 2: Chrome Profile (`entrypoint.sh`)

An empty Chrome profile with no bookmarks, no history, and no preferences is a strong signal of a freshly-created automated browser. The entrypoint now pre-populates:

- **Preferences**: `accept_languages`, `safebrowsing`, `dns_prefetching`, `window_placement`, `skip_first_run_ui`, etc.
- **Bookmarks**: Three common entries (Google, YouTube, Wikipedia).
- **Local State**: Profile metadata with a named profile ("Person 1").

### Layer 3: JavaScript Patches (`stealth.js`)

| # | Patch | Why |
|---|-------|-----|
| 1 | `navigator.webdriver → false` | The #1 bot detection signal. Real Chrome returns `false`; automated Chrome returns `true`. Even with the Blink flag, CDP attachment can re-enable it. |
| 2 | `navigator.languages → ['en-US', 'en']` | Ensures consistent locale regardless of container environment. |
| 3 | `navigator.plugins` — fake Chrome PDF Plugin, Chrome PDF Viewer, Native Client | Headless/automated Chrome reports an empty `PluginArray` (length 0). Real Chrome always has PDF and NaCl plugins. |
| 4 | `navigator.mimeTypes` — fake `application/pdf` entries | Must match the fake plugins. Empty mimeTypes = headless signal. |
| 5 | WebGL `getParameter()` — return SwiftShader vendor/renderer | Even with SwiftShader actually running, this ensures consistent, known-good strings across Chromium versions. Intercepts `UNMASKED_VENDOR_WEBGL` (0x9245) and `UNMASKED_RENDERER_WEBGL` (0x9246). |
| 6 | `Permissions.query({name:'notifications'})` → `'prompt'`, `Notification.permission` → `'default'` | Automated browsers deny all permissions by default. Real browsers return `'prompt'`/`'default'` for notifications. |
| 7 | `window.chrome.runtime` — ensure object exists | Some bot detectors check `if (!window.chrome \|\| !window.chrome.runtime)` to distinguish headless Chrome from real Chrome. |
| 8 | Remove `$cdc_`/`cdc_` properties on `document` | Chromedriver injects these properties. Not used by CDP directly, but removed as a precaution. |
| 9 | `navigator.hardwareConcurrency` → 8 (if < 4) | Docker containers with limited CPUs may report 1-2, which is suspicious for a desktop browser. |
| 10 | `navigator.deviceMemory` → 8 (if < 4) | Same — low memory is suspicious for desktop. |
| 11 | Iframe `navigator.webdriver` patching | Advanced fingerprinters create iframes and check `navigator.webdriver` inside them to bypass page-level overrides. We hook `document.createElement('iframe')` and patch the iframe's navigator on load. |

### Layer 4: Dockerfile

`libegl1` and `libgbm1` are installed to provide the EGL and GBM libraries that Chrome's ANGLE/SwiftShader backend needs. Without them, `--use-gl=angle` silently falls back to no-GPU mode.

### Test Results

Verified against bot-detection sites (2026-03-28):

| Test | Result |
|------|--------|
| bot.sannysoft.com | 10/11 main tests pass (only "WebDriver New" orange — CDP attachment quirk; "WebDriver Advanced" passes) |
| intoli headless detection | "You are not Chrome headless" |
| Cloudflare (nowsecure.nl) | Soft Turnstile challenge (not hard-blocked) |
| CreepJS | Fingerprint generated without bot flag |

## Local Development

Run Chrome with the extension loaded:

```bash
./setup.sh https://example.com
```

The server must be running on `http://localhost:7878` for the extension to send data.
