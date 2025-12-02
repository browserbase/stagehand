# CUA Primitives API Server

A Fastify server that exposes Stagehand's Computer Use Agent (CUA) browser primitives as REST endpoints, enabling external agents to control browser sessions remotely.

## Architecture

```
External Agent -> Fastify API -> BrowserSessionManager -> Stagehand Page -> Browser
```

## Prerequisites

```bash
npm install @browserbasehq/stagehand fastify
```

## Quick Start

```bash
# Start the server
npx tsx index.ts

# Or with environment variables
CUA_SERVER_PORT=8080 npx tsx index.ts
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CUA_SERVER_PORT` | `3000` | Server port |
| `CUA_SERVER_HOST` | `0.0.0.0` | Server host |

## API Endpoints

### Health Check

```bash
GET /health
```

Returns server status and active session count.

### List Sessions

```bash
GET /sessions
```

Returns array of active session IDs.

### Create Session

```bash
POST /sessions
Content-Type: application/json

{
  "env": "LOCAL",           // or "BROWSERBASE"
  "viewport": {
    "width": 1280,
    "height": 720
  }
}
```

Returns:
```json
{
  "sessionId": "session_1234567890_abc123",
  "state": {
    "screenshot": "base64...",
    "url": "about:blank",
    "viewport": { "width": 1280, "height": 720 }
  }
}
```

### Get Session State

```bash
GET /sessions/:id/state
```

Returns current browser state (screenshot, URL, viewport).

### Close Session

```bash
DELETE /sessions/:id
```

Closes the browser and removes the session.

### Execute Action

```bash
POST /sessions/:id/action
Content-Type: application/json

{
  "type": "click",
  "x": 100,
  "y": 200
}
```

Returns:
```json
{
  "success": true,
  "state": {
    "screenshot": "base64...",
    "url": "https://example.com",
    "viewport": { "width": 1280, "height": 720 }
  }
}
```

## Available Actions

### Mouse Actions

| Action | Parameters | Description |
|--------|------------|-------------|
| `click` | `x`, `y`, `button?`, `clickCount?` | Click at coordinates |
| `double_click` | `x`, `y` | Double-click at coordinates |
| `tripleClick` | `x`, `y` | Triple-click at coordinates |
| `drag` | `path: [{x, y}, ...]` | Drag along path |
| `move` | - | No-op (cursor visualization) |

### Keyboard Actions

| Action | Parameters | Description |
|--------|------------|-------------|
| `type` | `text` | Type text into focused element |
| `keypress` | `keys` (string or array) | Press keyboard keys |

### Navigation Actions

| Action | Parameters | Description |
|--------|------------|-------------|
| `goto` | `url` | Navigate to URL |
| `back` | - | Go back in history |
| `forward` | - | Go forward in history |
| `scroll` | `x?`, `y?`, `scroll_x?`, `scroll_y?` | Scroll the page |

### Utility Actions

| Action | Parameters | Description |
|--------|------------|-------------|
| `wait` | `timeMs?` (default: 1000) | Wait for duration |
| `screenshot` | - | No-op (always returned in response) |

## Example Usage

```bash
# Create a session
SESSION=$(curl -s -X POST http://localhost:3000/sessions | jq -r '.sessionId')

# Navigate to a website
curl -X POST http://localhost:3000/sessions/$SESSION/action \
  -H "Content-Type: application/json" \
  -d '{"type": "goto", "url": "https://example.com"}'

# Click a button
curl -X POST http://localhost:3000/sessions/$SESSION/action \
  -H "Content-Type: application/json" \
  -d '{"type": "click", "x": 150, "y": 300}'

# Type into an input
curl -X POST http://localhost:3000/sessions/$SESSION/action \
  -H "Content-Type: application/json" \
  -d '{"type": "type", "text": "Hello, World!"}'

# Press Enter
curl -X POST http://localhost:3000/sessions/$SESSION/action \
  -H "Content-Type: application/json" \
  -d '{"type": "keypress", "keys": "Enter"}'

# Scroll down
curl -X POST http://localhost:3000/sessions/$SESSION/action \
  -H "Content-Type: application/json" \
  -d '{"type": "scroll", "x": 640, "y": 360, "scroll_y": 500}'

# Close the session
curl -X DELETE http://localhost:3000/sessions/$SESSION
```

## Response Format

All action responses include the full browser state:

```typescript
interface ActionResponse {
  success: boolean;
  error?: string;
  state: {
    screenshot: string;  // base64 PNG
    url: string;
    viewport: {
      width: number;
      height: number;
    };
  };
}
```

## Error Handling

Errors return appropriate HTTP status codes:

- `404` - Session not found
- `500` - Action execution failed

```json
{
  "error": "Session session_123 not found",
  "code": "SESSION_NOT_FOUND"
}
```

## File Structure

```
cua-server/
├── index.ts           # Entry point
├── server.ts          # Fastify routes
├── sessionManager.ts  # Browser session lifecycle
├── actionExecutor.ts  # CUA primitive execution
├── stateCapture.ts    # Screenshot & state helpers
├── types.ts           # TypeScript types
├── start.sh           # Startup script
├── test.sh            # Canary test script
└── README.md          # This file
```

