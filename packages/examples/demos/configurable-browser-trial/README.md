# bbpoc — Browserbase Verified Trial in a Box

> Turn a one-week "advanced stealth" trial into a one-day, self-serve smoke test.
> Edit **one file**, run **one command**, get a **leadership-ready scorecard**.

Every Browserbase proof-of-concept looks the same: a customer hands over a list
of their own bot-protected URLs, then someone spends a week wiring up
concurrency, logging, retries, and stealth settings just to find out the success
rate. `bbpoc` is that week, pre-built. You bring the URLs; it runs them at scale
with stealth + residential proxies, classifies every outcome, and emits the exact
scorecard a Browserbase CE would otherwise assemble by hand.

```
┌──────────────┐     ┌─────────────────────────┐     ┌──────────────────────┐
│  trial.yaml  │ ──▶ │  bbpoc run               │ ──▶ │  scorecard.html      │
│  your URLs   │     │  stealth · proxies ·     │     │  scorecard.md        │
│  + tasks     │     │  captcha · concurrency · │     │  results.json        │
│  + targets   │     │  retry-on-new-proxy      │     │  (session replays)   │
└──────────────┘     └─────────────────────────┘     └──────────────────────┘
```

---

## Quick start (talk to it — recommended)

This repo ships as a **Claude Code skill**. Open the folder in Claude Code (or
Cursor) and just describe what you want to test — Claude writes the config, runs
the trial, and hands you the scorecard. No YAML, no flags to learn.

```bash
git clone <this repo> my-trial && cd my-trial
npm ci
cp .env.example .env   # fill in your Browserbase + model keys
```

Then, in Claude Code:

```
/bbpoc test these for us:
  portal.acme.com/login  — log in and confirm the dashboard loads
  acme.com/search        — search "widgets" and read the first result
  80% bar, run each 5 times
```

Claude generates `trial.yaml`, runs it on real cloud browsers, and points you at
`results/scorecard.html`. The skill lives in `.claude/skills/bbpoc/` — it's
auto-discovered when you open this repo. To use it in any project, copy that
folder into your global `~/.claude/skills/`.

## Quick start (CLI — power users / CI)

Prefer flags? The engine underneath is a normal CLI:

```bash
npx bbpoc init        # scaffolds trial.yaml + .env
# edit trial.yaml — your URLs, tasks, targets
npx bbpoc smoke       # quick sanity — 1 attempt per site
npx bbpoc run         # full trial — N attempts per site, at concurrency
```

Open `results/scorecard.html` and send it to your team.

> **Need Enterprise/Scale access?** Advanced stealth ("Verified") and residential
> proxies are Enterprise-plan features. If a run errors on session creation, ask
> your Browserbase contact to enable them — or run a control with
> `npx bbpoc run --preset baseline` to see the un-stealthed baseline.

---

## The one file you edit: `trial.yaml`

```yaml
name: "Acme — Browserbase Verified Trial"
customer: "Acme Inc."

defaults:
  attempts: 3 # run EACH site N times (stability is the real bar)
  concurrency: 5
  region: us-west-2
  target: 0.8 # per-site success target
  model: anthropic/claude-sonnet-4-5
  features:
    advancedStealth: true # "Verified" — DEFAULT ON (the #1 trial mistake is leaving it off)
    proxies: true # residential proxies — pair with stealth
    solveCaptchas: true
    # proxyCountry: BR      # geo-target the proxy if the site checks location

sites:
  - name: "Login flow"
    url: "https://portal.example.com/login"
    task: "Log in with the provided credentials and confirm the dashboard loads."
    expect: "The account dashboard is visible after login."
    antibot: akamai # informational
    target: 0.85
```

That's it. No pipeline code, no logging setup, no concurrency plumbing.

---

## What you get

**`scorecard.md` — the acceptance matrix** (the artifact CEs build by hand):

| Site       | Success    | Target | Result   | Top failure      | Anti-bot seen |
| ---------- | ---------- | ------ | -------- | ---------------- | ------------- |
| Login flow | 8/10 (80%) | 80%    | ✅ Met   | —                | Akamai        |
| Search     | 4/10 (40%) | 80%    | ❌ Below | CAPTCHA unsolved | hCaptcha      |

**`scorecard.html` — a branded, leadership-ready report** with per-site donuts,
the exact feature posture used, and a **replayable Browserbase session link for
every single attempt** (pass _and_ fail) — the evidence customers actually want.

**`results.json`** — raw data for your own dashboards.

---

## Commands

| Command        | What it does                                   |
| -------------- | ---------------------------------------------- |
| `bbpoc init`   | Scaffold `trial.yaml` + `.env`                 |
| `bbpoc smoke`  | Quick sanity run, 1 attempt/site               |
| `bbpoc run`    | Full trial per `trial.yaml`                    |
| `bbpoc report` | Rebuild reports from a previous `results.json` |

**Useful flags** (on `run` / `smoke`):

| Flag                                        | Purpose                                   |
| ------------------------------------------- | ----------------------------------------- |
| `--preset verified\|baseline\|stealth-only` | Flip the whole feature posture            |
| `--concurrency <n>`                         | e.g. `--concurrency 100` for a scale test |
| `--attempts <n>`                            | Override attempts per site                |
| `--no-stealth` / `--no-proxies`             | Run a control to prove the lift           |
| `-c, --config <path>`                       | Use a different manifest                  |

**Prove the value of stealth** by running the same manifest twice:

```bash
npx bbpoc run --preset baseline -o results/baseline   # stealth OFF
npx bbpoc run --preset verified -o results/verified    # stealth ON
```

…then compare the two `scorecard.html` files side by side. (Customers routinely
see jumps like 30% → 80% once Verified + proxies are on.)

---

## How it decides pass vs. fail

For each attempt, `bbpoc`:

1. Opens the URL in a fresh Browserbase session (fresh session = fresh proxy IP —
   the "retry to rotate the proxy" pattern, built in).
2. Drives the task with a Stagehand agent.
3. Scrapes the page and **classifies the outcome**: `pass`, `blocked (anti-bot)`,
   `CAPTCHA unsolved`, `account/OTP wall`, `timeout`, or `error` — and names the
   vendor it detected (Cloudflare, Akamai, PerimeterX, DataDome, hCaptcha, …).

So a failure tells you _why_: "you weren't blocked by Browserbase, you hit
Akamai" vs. "the agent ran out of steps." That distinction is the whole game.

---

## The skill is the front door

`.claude/skills/bbpoc/` contains the skill that drives everything from plain
English, plus a `FAQ.md`. Because it's a project skill, it's available the moment
you open this repo in Claude Code. It can also answer "what's a context?", "why is
this site still blocked?", and "how do I geo-target a proxy?" — so your trial
rarely needs a support ticket. Copy the folder into `~/.claude/skills/` to use it
everywhere.

---

## Requirements

- Node ≥ 20
- A Browserbase account (`BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`)
- A model key: `ANTHROPIC_API_KEY` (default), `OPENAI_API_KEY`, or `GOOGLE_GENERATIVE_AI_API_KEY`

Built on [Browserbase](https://browserbase.com) + [Stagehand](https://github.com/browserbase/stagehand).
