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
cd stagehand/packages/server
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

