# Reuse an authenticated session

Log in to the public test site and reuse a Browserbase context on later runs. Each run writes `out/login.json` with authentication, reuse, and session details.

Add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` to a language folder's `.env`. `BROWSERBASE_CONTEXT_ID` is optional: if it is unset, the example creates a context and prints its ID. Save that ID for reuse. The environment template includes the test site's public login credentials.

- TypeScript: `pnpm install --frozen-lockfile`, then `pnpm start`.
- Python: `uv sync --locked`, then `uv run --locked python main.py`.
- Go: export `.env` with `set -a; . ./.env; set +a`, then `go run .`.

Run twice sequentially with the same context. A fresh context should authenticate; the next run should report reuse. A wrong password fails only when login is needed, so use a fresh test context for that check.

Adapt the login URL, protected URL, and authenticated marker together. Credentials use Stagehand variables. The script attempts login once and does not handle MFA. Closing the browser persists the context; browser lifetime is five minutes. Use one writer per context and keep credentials out of logs and version control. Print a newly created context ID so it can be saved; keep existing IDs out of logs.

Run `pnpm typecheck` in `typescript/` or `go test ./...` in `go/`.
