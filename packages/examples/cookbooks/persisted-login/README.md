# Reuse an authenticated session

Log in to the public test site and reuse a Browserbase context on later runs. Each run writes `out/login.json` with authentication, reuse, and session details.

Add `BROWSERBASE_API_KEY` and `OPENAI_API_KEY` to a language folder's `.env`. `BROWSERBASE_CONTEXT_ID` is optional: if it is unset, the example creates a context and prints its ID. Save that ID for reuse. The environment template includes the test site's public login credentials.

Follow the [repository setup](../README.md#run), then run these commands from the repository root:

```bash
pnpm install --frozen-lockfile
cp packages/examples/cookbooks/persisted-login/typescript/.env.example packages/examples/cookbooks/persisted-login/typescript/.env
```

Fill in the TypeScript `.env`, then run `just cookbook persisted-login` from the repository root. It builds the local SDK and extension before starting the recipe.

For Python, run `uv sync --locked`, then `uv run --locked python main.py` from this cookbook's `python/` directory.

Run twice sequentially with the same context. A fresh context should authenticate; the next run should report reuse. A wrong password fails only when login is needed, so use a fresh test context for that check.

Adapt the login URL, protected URL, and authenticated marker together. Credentials use Stagehand variables. The script attempts login once and does not handle MFA. Closing the browser persists the context; browser lifetime is five minutes. Use one writer per context and keep credentials out of logs and version control. Print a newly created context ID so it can be saved; keep existing IDs out of logs.

Run `pnpm exec turbo run typecheck --filter=stagehand-cookbook-persisted-login` from the repository root.
