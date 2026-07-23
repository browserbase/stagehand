# Stagehand API

The Stagehand  is a powerful service that provides a RESTful interface for browser automation and session management using the Browserbase platform. It enables recording, playback, and manipulation of browser sessions with a focus on reliability and performance.

## 📋 Prerequisites

To run the Stagehand API locally, ensure you have the following installed:

- Node.js
- pnpm

## 🛠 Installation

1. Clone the repository:

```bash
git clone https://github.com/browserbase/stagehand/
cd stagehand/packages/server-v3
```

2. Install dependencies:

```bash
pnpm install
```

3. Set up environment variables:

```bash
cp .env.example .env
```

4. Configure your `.env` file with the environment variables required by
   `src/lib/env.ts` (BB environment, API base URLs, etc.). For self-hosted
   authentication, set `STAGEHAND_SERVER_API_KEY` and send the same value in
   the `x-stagehand-api-key` header. Requests may alternatively authenticate
   with a valid Browserbase API key in `x-bb-api-key`.

5. `pnpm dev`
