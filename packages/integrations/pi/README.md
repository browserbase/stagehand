# Stagehand for Pi

Install the native extension with Pi’s package manager:

```sh
pi install npm:@browserbasehq/pi
pi
```

Requires Node.js 24+, an authenticated Pi model provider, and local Chrome (or `BROWSERBASE_API_KEY` for Browserbase). The initial npm release is pending; before publishing, use the development build below. No private workspace dependency is needed by the installed package.

The extension registers `run`, `snapshot`, and `screenshot` directly through Pi’s extension API. It launches a browser on the first call, reuses it throughout the session, and closes it on shutdown.

## Develop from source

From the Stagehand repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter @browserbasehq/pi
pi install ./packages/integrations/pi
```

The package uses the official `pi.extensions` manifest and `pi-package` catalog keyword. The build bundles the private Core facade and leaves Stagehand (including its browser extension assets) as a runtime dependency.

[Setup and configuration](https://docs.stagehand.dev/v4/integrations/pi) · [Pi package format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)
