# Stagehand API

The Stagehand  is a powerful service that provides a RESTful interface for browser automation and session management using the Browserbase platform. It enables recording, playback, and manipulation of browser sessions with a focus on reliability and performance.

## 📋 Prerequisites

To run the Stagehand API from source, ensure you have the following installed:

- Node.js (we recommend 24.22.1 or a later patched Node 24 release)
- pnpm

Building a standalone server binary requires Node 22.23.4+, 24.22.1+, or 26.12.1+ within those major lines to include the [October 2026 security fixes](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). The binary embeds the Node runtime used to build it. Prebuilt binaries do not require a separate Node installation; install the updated binary and restart the server to use its patched runtime.

## 🛠 Installation

1. Clone the repository:

```bash
git clone --branch v3 https://github.com/browserbase/stagehand/
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

4. Configure your `.env` file with the environment variables required by `src/lib/env.ts` (BB environment, API base URLs, etc.).

5. `pnpm dev`

