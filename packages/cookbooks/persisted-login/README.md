# Reuse an authenticated session

Run a recurring authenticated job with a Browserbase context. The first run logs into the public test site with `%variable%` credentials. Later runs check authenticated state before deciding whether to log in again. Each run writes `out/login.json` with `authenticated`, `reused`, and the session ID.

Create a context in your Browserbase project and put its ID in `BROWSERBASE_CONTEXT_ID`. Copy `.env.example` to `.env` in a language folder and fill in the API keys. The example includes the public test site's credentials.

- TypeScript: `pnpm install --frozen-lockfile`, then `pnpm start`.
- Python: `uv sync --locked`, then `uv run --locked python main.py`.
- Go: export the variables in `.env`, then `go run .`.

Run twice, sequentially. The first run should report authentication and the second should report context reuse. A wrong password with a fresh context must fail. A previously authenticated context will skip login even if the password has changed.

The browser closes after every run, which persists the context. Browser lifetime is capped at five minutes. Only one run may write a given context at a time. Context IDs grant access to saved authenticated state; keep them out of logs and version control. Use a separate context per account and environment.

Adapt the fixed login and protected URLs and the `a[href="/logout"]` marker together for your own application. The marker must prove access to a protected page. This recipe does not automate MFA or solve expired-account problems. It attempts login once and fails when authentication cannot be verified.
