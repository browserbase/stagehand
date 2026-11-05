# Stagehand cookbooks

Browser jobs you can run, adapt, and combine. Each has a [docs page](https://docs.stagehand.dev/v4/cookbooks/overview), source folder, and coding-agent prompt.

| Cookbook                                 | Languages          | Output                                      |
| ---------------------------------------- | ------------------ | ------------------------------------------- |
| [Persisted login](persisted-login)       | TypeScript, Python | Authentication and reuse receipt            |
| [Paginated catalog](paginated-catalog)   | TypeScript, Python | Checkpoint and complete catalog             |
| [Files to bucket](files-to-bucket)       | TypeScript         | JSON and JPEG; optional S3 upload           |
| [Form approval](approve-form-submission) | TypeScript, Python | Submission or rejection; TypeScript receipt |
| [Research agent](ai-sdk-research-agent)  | TypeScript         | Report citing approved sources              |

## Run

Clone the repository so the cookbooks can use the local SDKs and root workspaces:

```bash
git clone --depth 1 https://github.com/browserbase/stagehand.git
cd stagehand
```

### TypeScript

Use Node.js 22.18+ with pnpm and [just](https://just.systems/). Install dependencies once from the repository root:

```bash
pnpm install --frozen-lockfile
```

Copy the selected cookbook's `typescript/.env.example` to `typescript/.env` and fill in its keys. Then run from the repository root:

```bash
just cookbook paginated-catalog
```

Replace `paginated-catalog` with the selected cookbook's folder name. The command builds the local SDK and extension before starting the recipe in its TypeScript directory. Its `.env` and `out/` files live in that directory. TypeScript cookbooks share the root catalog and `pnpm-lock.yaml`.

### Python

Use Python 3.11+ and uv, plus Node.js 22.18+, pnpm, and just to build the extension. Install dependencies once from the repository root:

```bash
just install
```

Copy the selected cookbook's `python/.env.example` to `python/.env` and fill in its keys. Then run from the repository root:

```bash
just cookbook-python paginated-catalog
```

Replace `paginated-catalog` with the selected cookbook's folder name. The command builds the extension and starts the recipe in its Python directory, where `.env` and `out/` live. Python cookbooks keep their own `pyproject.toml` files, share the root `uv.lock` and `.venv`, and use the local Python SDK source. After building the extension, you can also run `uv run --locked python main.py` from a cookbook's `python/` directory; uv discovers the root workspace automatically.

Cloud jobs require `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`, print a session link, and limit browser lifetime to five minutes. Page and step limits bound work, not cost.

Recorded jobs live in [the showcase](https://stagehand.dev/showcase); their scripts use `just showcase-script <slug>`.

## Contribute

Include a docs page, agent prompt, README, environment template, dependency declarations, output checks, and cleanup. Core browser jobs support TypeScript and Python. Integration recipes may be TypeScript-only.

Run TypeScript checks from the repository root; Turbo builds the local dependencies first:

```bash
pnpm exec turbo run typecheck test:unit --filter='stagehand-cookbook-*'
```

Run Python catalog tests with `uv run --locked python -m unittest` from its `python/` directory. Live-test changed browser behavior locally. Keep context and checkpoint writes sequential.

Use Playwright locators for known elements, Stagehand for natural-language actions and extraction, and site-provided WebMCP tools when available. See [model configuration](https://docs.stagehand.dev/v4/configuration/models) and [Functions deployment](https://docs.stagehand.dev/v4/best-practices/deployments) for other setups.
