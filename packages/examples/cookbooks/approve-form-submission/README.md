# Approve a form submission

Fill a test form, show its actual values, and require human approval before Submit. Requires `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`.

## TypeScript

```bash
cd typescript
cp .env.example .env
pnpm install --frozen-lockfile
```

Fill in `.env`, then run `pnpm start`. TypeScript uses AI SDK approval and a code guard. The approval prompt expires after 60 seconds.

## Python

```bash
cd python
cp .env.example .env
uv sync --locked
```

Fill in `.env`, then run `uv run --locked python main.py`.

## Go

```bash
cd go
cp .env.example .env
```

Fill in both keys in `.env`, then run:

```bash
set -a; . ./.env; set +a
go run .
```

Python and Go use a CLI approval gate. Answer `y` or `n`. Each implementation rechecks values before Submit and permits at most one approved attempt. Browser lifetime is five minutes.

TypeScript writes `out/approval.json`. A `submission-attempted` receipt may mean the server received the form; inspect the session before rerunning. The receipt does not support approval across process restarts. Use one writer per output directory.

Run `pnpm typecheck` and `pnpm test` in `typescript/`, or `go test ./...` in `go/`.
