# Stagehand cookbooks

Real-world examples on real websites, each one recorded and benchmarked on [stagehand.dev/showcase](https://stagehand.dev/showcase).

| Cookbook                                                                                | Category               | Site                       |
| --------------------------------------------------------------------------------------- | ---------------------- | -------------------------- |
| [Compare laptop specs across product pages](laptop-spec-comparison)                     | Shopping               | staples.com                |
| [Build a list of YC startups in an industry](yc-companies-by-industry)                  | Companies & jobs       | ycombinator.com            |
| [Collect remote roles across different job boards](remote-roles-across-ats)             | Companies & jobs       | jobs.ashbyhq.com           |
| [Monitor SaaS pricing pages](saas-pricing-monitor)                                      | QA & monitoring        | linear.app                 |
| [QA a checkout flow end to end](qa-checkout-flow)                                       | QA & monitoring        | saucedemo.com              |
| [Catch UI regressions with one test across app variants](qa-find-ui-regressions)        | QA & monitoring        | saucedemo.com              |
| [Pull the latest quarterly results of a public company](digitalocean-quarterly-results) | Research & public data | investors.digitalocean.com |
| [Turn a leaderboard into structured data](stagehand-evals-leaderboard)                  | Research & public data | stagehand.dev              |
| [Solve today's Wordle](wordle-solver)                                                   | Games                  | nytimes.com                |

## Run a cookbook

Copy `.env.example` to `.env` in this folder and fill in `BROWSERBASE_API_KEY` and `ANTHROPIC_API_KEY`. Then, from the repository root:

```bash
just cookbook laptop-spec-comparison
```

## Benchmark a cookbook

`just showcase <slug>` benchmarks four lanes, three runs each, all on the same model (Claude Sonnet 5 by default, `SHOWCASE_MODEL` to change it):

- **Stagehand code mode agent**: an agent given the task's goal, driving Stagehand's code-mode MCP server (`@browserbasehq/stagehand-integrations`), where it writes Playwright-shaped code.
- **Playwright MCP agent**: the same agent loop and goal, driving the stock [Playwright MCP](https://github.com/microsoft/playwright-mcp) server.
- **Cookbook script**: this folder's `workflow.ts`, the flow written once as plain Stagehand calls.
- **Cookbook script, cached**: the same script after one warm-up run, with Stagehand's server-side cache on.

Both agents use Anthropic prompt caching (`cache_control`), configured the way a real Claude agent would be. The harness downloads the Browserbase recording of the most typical code-mode run and writes everything to `<slug>/.out/`:

- `results.json`: token usage (including cache reads and writes), cost, duration and success for every run, medians, the timeline of agent tool calls and the extracted output
- `recording.mp4` and `poster.jpg`, compressed with ffmpeg

```bash
just showcase laptop-spec-comparison
just showcase laptop-spec-comparison --runs 1 --skip-baseline --skip-script
```

Every lane uses the same Browserbase session settings (see `_harness/session.ts`) and the same success check. Medians are taken over successful runs, and failed runs still count toward the success rate. A skipped lane keeps its numbers from the previous `results.json`, so one lane can be re-run on its own. Prices per model live in `_harness/pricing.ts` and are copied into each results file.

## Add a cookbook

1. Create `<slug>/workflow.ts` exporting a zod `schema` and `run(stagehand, page)`.
2. Create `<slug>/task.ts` with the start URL, a natural-language goal for the baseline, and a `check` on the output.
3. Copy `index.ts` and `README.md` from an existing cookbook.
4. Only target sites allowed by the Browserbase acceptable use policy, stay logged out, and stop before any purchase or booking.
