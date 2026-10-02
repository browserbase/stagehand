# Approve before submitting a form

Fill a form with Stagehand, then require a human to approve the submit click.

## TypeScript

Uses the Vercel AI SDK `needsApproval` tool flag. Requires `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`.

```bash
cd typescript
cp .env.example .env
pnpm install
pnpm start
```

Answer `y` or `n` when the CLI asks to submit.

## Python

Fills the form, then blocks on stdin before `act()` clicks Submit. Requires `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`.

```bash
cd python
cp .env.example .env
uv sync
uv run python main.py
```

## Go

Uses a CLI approval gate. From `go/`, copy `.env.example` to `.env`, set both keys, then run `set -a; . ./.env; set +a; go run .`. Go 1.26+ is required.
