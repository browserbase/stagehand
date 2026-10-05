# Reuse an authenticated session

Log in to the public test site and reuse a Browserbase context on later runs. Each run writes `out/login.json` with authentication, reuse, and session details.

Create a Browserbase context and set `BROWSERBASE_CONTEXT_ID` in a language folder's `.env`. Add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY`. The environment template includes the test site's public login credentials.

- TypeScript: `pnpm install --frozen-lockfile`, then `pnpm start`.
- Python: `uv sync --locked`, then `uv run --locked python main.py`.
- Go: export `.env` with `set -a; . ./.env; set +a`, then `go run .`.

Run twice sequentially with the same context. A fresh context should authenticate; the next run should report reuse. A wrong password fails only when login is needed, so use a fresh test context for that check.

Adapt the login URL, protected URL, and authenticated marker together. Credentials use Stagehand variables. The script attempts login once and does not handle MFA. Closing the browser persists the context; browser lifetime is five minutes. Use one writer per context and keep context IDs out of logs and version control.

Run `pnpm typecheck` in `typescript/` or `go test ./...` in `go/`.
