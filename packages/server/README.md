# Stagehand API

The Stagehand API is a powerful service that provides a RESTful interface for browser automation and session management using the Browserbase platform. It enables recording, playback, and manipulation of browser sessions with a focus on reliability and performance.

## 📋 Prerequisites

To run the Stagehand API locally, ensure you have the following installed:

- Node.js
- pnpm

## 🛠 Installation

1. Clone the repository:

```bash
git clone https://github.com/browserbasehq/stagehand.git
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

## 🚀 Development

To start the development server:

```bash
pnpm add vercel
```

```bash
pnpm vercel dev
```

This will:

1. Build the TypeScript files
2. Start the server in development mode
3. **Not** watch for changes. You must re-build the project to see your changes reflected.

## 🧪 Linting and Code Quality

The project uses ESLint and Prettier for code quality. To run linting:

```bash
# Run linter
pnpm lint

# Fix linting issues
pnpm lint:fix
```

### Editor Extensions

It is _highly_ recommended to install the ESLint and Prettier extensions for your editor. This will help you catch errors and format your code correctly.

#### VSCode

- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

#### JetBrains IDEs

- [ESLint](https://plugins.jetbrains.com/plugin/7494-eslint)
- [Prettier](https://plugins.jetbrains.com/plugin/10456-prettier)

## 🏗 Project Structure

```
src/
├── lib/            # Core library functions
│   ├── stream.ts   # Streaming response handling
│   └── sessionStore/manager utilities
├── routes/         # API routes
│   └── v1/         # V1 API endpoints
└── server.ts       # Server entry point
```

## 📡 API Endpoints

The API follows a mocked file-based router (as in, the file structure does not represent the actual routes, but is used to organize the code) under the `src/routes` directory. For detailed API documentation including request/response schemas, authentication, and headers, please refer to the [Stagehand API Documentation](https://www.notion.so/browserbase/Stagehand-API-Docs-510b182337c14928b2445c38744dd2e4?pvs=4).

## 🚢 Deployment

The Stagehand API is deployed to AWS ECS. To deploy a new version, run the [`push_to_ecr.sh`](./scripts/push_to_ecr.sh) script from this directory.

```bash
chmod +x ./scripts/push_to_ecr.sh
./scripts/push_to_ecr.sh
```

You can also run `pnpm run deploy` to run the same script.

## 🤝 Contributing

To contribute to this project:

1. Create a new branch for your changes
2. Make your changes and commit them
3. Submit a pull request

For bugs and feature requests, please refer to the [Stagehand API Issue Tracker](https://www.notion.so/browserbase/1863c11b6614807897e7dcda227f47df?v=1863c11b66148081854d000c9e54f893&pvs=4).

## 🔧 Troubleshooting

Common issues and solutions:

1. **Database Connection Issues**

   - Verify database credentials in `.env`
   - Ensure PostgreSQL is running
   - Check network connectivity

2. **Unauthorized Requests**
   - Ensure `.env` file exists and is named correctly
   - Verify `bb_key_whitelist` in [Posthog](https://us.posthog.com/project/130716) includes your Browserbase API key
   - Check API key is properly formatted (e.g. `bb_live_...`)

## 📮 Support

Please document any issues, bugs, or feature requests in the [Stagehand API Issue Tracker](https://www.notion.so/browserbase/1863c11b6614807897e7dcda227f47df?v=1863c11b66148081854d000c9e54f893&pvs=4).

## Logging

To maintain consistent logging and enable proper log management in production, **never use `console.log`** in this codebase. Instead, use the logger:

```typescript
import logger from "@/lib/logger.js";

// Log levels - use the appropriate level for your message
logger.trace("Very detailed debugging information");
logger.debug("Debugging information");
logger.info("General information about system operation");
logger.warn("Warning about potential issues");
logger.error("Error conditions");
logger.fatal("Critical errors causing system shutdown");

// For structured logging (recommended)
logger.info({ userId: "123", action: "login" }, "User logged in");

// For error logging with stack traces
try {
  // code that might throw
} catch (error) {
  logger.error({ err: error }, "Failed to process request");
}
```

### Migration Helper

If you're migrating existing code that uses `console.*` methods, you can use the `consoleReplacer`:

```typescript
import { consoleReplacer } from "@/lib/logger.js";

// Instead of:
// console.log("This happened", data);

// Use:
consoleReplacer.log("This happened", data);
```

This maintains identical call signatures while properly logging through the structured logger.
