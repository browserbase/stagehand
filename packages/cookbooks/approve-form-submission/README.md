# Approve before submitting a form

Fill a form with Stagehand, then require a human to approve the submit click.

## TypeScript

Uses Vercel AI SDK `toolApproval` and a code guard for one approved submit attempt. Requires `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`.

```bash
cd typescript
cp .env.example .env
pnpm install --frozen-lockfile
pnpm start
```

Answer `y` or `n` when the CLI asks to submit.

## Python

Fills the form, then blocks on stdin before `act()` clicks Submit. Requires `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`.

```bash
cd python
cp .env.example .env
uv sync --locked
uv run --locked python main.py
```

## Go

Uses a CLI approval gate. From `go/`, copy `.env.example` to `.env`, set the Browserbase key, then run `set -a; . ./.env; set +a; go run .`. Go 1.26+ is required.

Cloud jobs print a session link and cap browser lifetime at five minutes. Every language checks actual form values before requesting approval and again before submitting. Rejection ends the run. The TypeScript approval prompt times out after 60 seconds. `out/approval.json` is an atomic receipt, not a cross-process resume token. A `submission-attempted` receipt requires inspection before rerunning because a failed browser call may still have reached the server. One process per output directory.

Run `pnpm test` and `pnpm typecheck` from `typescript/` without credentials. Python and Go use a direct CLI gate rather than the AI SDK tool loop.
