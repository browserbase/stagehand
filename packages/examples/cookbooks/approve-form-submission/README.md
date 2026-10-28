# Approve a form submission

Fill a test form, show its actual values, and require human approval before Submit. Requires `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`.

## TypeScript

Follow the [repository setup](../README.md#run), then run these commands from the repository root:

```bash
pnpm install --frozen-lockfile
cp packages/examples/cookbooks/approve-form-submission/typescript/.env.example packages/examples/cookbooks/approve-form-submission/typescript/.env
```

Fill in `.env`, then run `just cookbook approve-form-submission` from the repository root. TypeScript uses AI SDK approval and a code guard. The approval prompt expires after 60 seconds.

## Python

From this cookbook's directory:

```bash
cd python
cp .env.example .env
uv sync --locked
```

Fill in `.env`, then run `uv run --locked python main.py`.

Python uses a CLI approval gate. Answer `y` or `n`. Each implementation rechecks values before Submit and permits at most one approved attempt. Browser lifetime is five minutes.

TypeScript writes `out/approval.json`. A `submission-attempted` receipt may mean the server received the form; inspect the session before rerunning. The receipt does not support approval across process restarts. Use one writer per output directory.

Run `pnpm exec turbo run typecheck test:unit --filter=stagehand-cookbook-approve-form-submission` from the repository root.
