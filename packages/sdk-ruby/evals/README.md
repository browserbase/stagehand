# Ruby SDK evals

Ruby ports of the bench-tier eval tasks from `packages/evals/tasks/bench/`
(`act`, `extract`, `observe`), run through the Ruby SDK. Tasks are
auto-discovered from `tasks/<category>/*.rb`; each is a 1:1 semantic port of
its TypeScript original (same URLs, same assertions).

## Running

From `packages/sdk-ruby` (a `.env` at the repo root is not loaded — export
`BROWSERBASE_API_KEY` first):

```bash
bundle exec ruby evals/runner.rb                     # every task on Browserbase
bundle exec ruby evals/runner.rb extract             # one category
bundle exec ruby evals/runner.rb act/dropdown        # one task
bundle exec ruby evals/runner.rb --trials 3 --concurrency 8
bundle exec ruby evals/runner.rb --local             # local Chrome (needs a model key)
```

Model resolution: `--model` / `EVAL_MODEL` (+ `EVAL_MODEL_API_KEY` or
`OPENAI_API_KEY`) when set; otherwise the Browserbase Model Gateway picks a
model per inference call (Browserbase runs only).

Each run gets a fresh Browserbase session (or local Chrome) per task × trial.
Results stream to stdout and to `evals/results/<timestamp>.jsonl` (one JSON
object per run, including the Browserbase `session_id` for postmortems). Exit
status is non-zero when any run fails.

## Writing tasks

```ruby
# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/<name>.ts

Evals.define_task("<name>") do |t|
  t.page.goto("https://…")
  t.stagehand.act("…")
  actual = t.page.locator("xpath=…").input_value
  { _success: actual == "expected", actual: actual }
end
```

The context exposes `t.stagehand`, `t.page` (the session's initial page), and
`t.logger`. Raising counts as a failure — no rescue wrapper needed. Return a
Hash with `_success:`; the harness appends timing, session id, and logs.

Out of scope here (still TypeScript-only): the dataset-backed benchmark
suites (WebVoyager, OnlineMind2Web, WebTailBench), agent-tier tasks, and the
Braintrust reporting pipeline in `packages/evals`.
