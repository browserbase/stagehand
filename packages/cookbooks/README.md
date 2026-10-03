# Stagehand cookbooks

Runnable browser jobs with matching [docs](https://docs.stagehand.dev/v4/cookbooks/overview), coding-agent prompts, defined outputs, and failure checks.

```bash
git clone --depth 1 --sparse https://github.com/browserbase/stagehand.git
cd stagehand
git sparse-checkout set packages/cookbooks/<cookbook-name>
```

| Folder                                             | Languages              | Output                                                           |
| -------------------------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| [approve-form-submission](approve-form-submission) | TypeScript, Python, Go | An approved submission or rejection; TypeScript approval receipt |
| [paginated-catalog](paginated-catalog)             | TypeScript, Python, Go | Resumable checkpoint and complete catalog                        |
| [persisted-login](persisted-login)                 | TypeScript, Python, Go | Persisted context and authentication receipt                     |
| [files-to-bucket](files-to-bucket)                 | TypeScript             | Local JSON and bounded JPEG download, optional S3 upload         |
| [ai-sdk-research-agent](ai-sdk-research-agent)     | TypeScript             | Typed report citing two approved sources                         |

Recorded real-site jobs live in [the showcase](https://stagehand.dev/showcase) and `packages/examples`. SDK method samples live in each SDK's `examples` directory. Functions templates use `browse functions init`; see the deployment docs.

## Run and verify

Each language folder is independent of the monorepo workspace so sparse checkout works. Copy its `.env.example`, configure credentials, and install from its lockfile. TypeScript uses `pnpm install --frozen-lockfile`; Python uses `uv sync --locked`; Go uses `go mod download`. From a full checkout, `just cookbook <slug>` runs the TypeScript project after installation. `just showcase-script <slug>` runs a real-site showcase script.

Cloud jobs print Browserbase session links and cap browser lifetime at five minutes. The catalog defaults to a two-page category and checkpoints progress before navigation. AI SDK loops also bound steps and generated tokens. These limits do not guarantee a dollar cost ceiling. File uploads and terminal input can outlive a browser session.

Run `pnpm typecheck` in each TypeScript folder. Catalog, approval, and download tests use `pnpm test` without credentials. Python catalog tests use `uv run --locked python -m unittest`. Run `go test ./...` in each Go folder.

## Contribution requirements

Core SDK jobs support TypeScript, Python, and Go with the same outputs and failure behavior. Ecosystem integrations may be TypeScript-only when their dependencies are specific to that ecosystem. Browserbase contexts must have one writer at a time; catalog output directories also have one writer at a time.

Every cookbook needs a README, docs page, agent prompt, commented environment template, reproducible lockfile, output checks, bounded browser work, cleanup on failure, and a deliberate failure case. Add credential-free tests for recovery or side effects. Match published SDK pins across languages and validate on an SDK upgrade. Keep snippets under Best practices and the cookbook sidebar flat until the catalog needs categories.

## Choose an approach

Use [Playwright locators](https://playwright.dev/docs/locators) when you own the application or have reliable roles and test IDs. Use Stagehand when the job's steps and output are known but natural-language interaction or extraction helps with unfamiliar pages. Keep ordinary code checks for completion, limits, and side effects.

Use site-provided [WebMCP tools](https://developer.chrome.com/docs/ai/webmcp) when the target exposes structured actions. Use an autonomous browser agent when the task requires planning the browsing steps; [Browser Use](https://browser-use.com/web-agent-api) is one hosted option. These approaches can be combined. None removes the need for authorization, output validation, or resource limits.
