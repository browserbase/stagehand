# 1Password extension guide

Location in the Stagehand repository: `packages/examples/1password-extension`.

Stagehand opens an uploaded browser extension, starts interactive sign-in, and visits Browserbase. Supply your own extension archive and the values named in `.env.example`. No extension binary, account state, or credentials are bundled.

For the Node example, run `npm install`, then `npm run upload-extension` and `npm start`. This guide uses Stagehand v2. The Python files are preserved legacy `StagehandConfig` snippets: the source repo did not declare a compatible Python Stagehand dependency, so they require an SDK port before use with Stagehand v4.
