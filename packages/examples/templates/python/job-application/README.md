# Stagehand + Browserbase: Job Application Automation

Stagehand is the SDK for browser agents.

This template uses Stagehand V4 to discover every role on a public test job board, fill each application with unique test data, upload a PDF resume, and submit it.

## Run

```bash
cp .env.example .env
uv sync
uv run python main.py
```

Set `BROWSERBASE_API_KEY` in `.env`. `MAX_CONCURRENCY` defaults to `2`; set `MAX_JOBS` to a positive number when you want a bounded test run.

Expected output includes the number of discovered jobs, a submission line for every application, and a final completed-submission count. Runtime errors still make the process exit nonzero.

Docs: https://docs.stagehand.dev/v4/first-steps/introduction
