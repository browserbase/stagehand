# Jev examples (experimental)

Demos of the experimental Jev path described in
[`packages/extension/services/jevAct/README.md`](../../extension/services/jevAct/README.md):
`act()`, `observe()` and `extract()` resolved through
[TypeSafe Jev](https://docs.typesafe.ai) decisions before any LLM is asked.

These are demos, not tests. Nothing here runs in CI.

## `examples/google-flight`

A Jev harness example for Stagehand that **only's input is a goal**:

```
Find one-way flights from Zurich to London on September 28, 2026, for one adult
in economy. Stop when matching flight options are visible. Do not select or book
a flight.
```

There is no step list, no selector and no knowledge of Google Flights anywhere
in the code. Point `--goal` and `--url` somewhere else and the same loop runs.

```bash
cp packages/integrations/jev/.env.example packages/integrations/jev/.env
# fill in TYPESAFE_API_KEY and OPENAI_API_KEY

pnpm --filter @browserbasehq/stagehand-integrations-example-jev google-flight
pnpm --filter @browserbasehq/stagehand-integrations-example-jev google-flight -- --help
```

### Configuration

| Variable           | Required | For                                                           |
| ------------------ | -------- | ------------------------------------------------------------- |
| `TYPESAFE_API_KEY` | yes      | every decision the agent takes                                |
| `OPENAI_API_KEY`   | yes      | `extract()`, and the LLM fallback paths                       |
| `MODEL_API_KEY`    | no       | overrides `OPENAI_API_KEY` when `--model` is not an OpenAI id |
| `TYPESAFE_API_URL` | no       | a different TypeSafe deployment                               |
| `TYPESAFE_MODEL`   | no       | a Jev model other than `jev-latest`                           |
| `CHROME_PATH`      | no       | only if Chrome cannot be detected automatically               |

`env.ts` reads `.env` by path rather than from the working directory, so the
keys are found whether the CLI is started with `pnpm --filter` or by file path
from the repo root. Precedence is the real environment, then this package's
`.env`, then the repo root's.

### The loop

Stagehand v4 ships no agent harness, so the example brings its own
(`agent.ts`, ~250 lines). Each turn:

| Phase       | Who                     | What                                                                                                                                                     |
| ----------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **observe** | Stagehand, no LLM       | `observe()` with no instruction: every interactive element, with the method its role implies. On the Jev path this needs no model at all.                |
| **decide**  | Jev                     | One typed Choice per shard of ≤60 candidates, run in parallel, plus a Noul asking whether the goal is already met. A runoff picks between shard winners. |
| **value**   | Jev                     | For a field, a second Choice over the spans lifted from the goal.                                                                                        |
| **act**     | Stagehand, no inference | `act(action)` with the observed `Action` replays it deterministically.                                                                                   |

So a turn costs 1–2 Jev round trips and zero LLM calls. `extract()` at the end
is the only place a model can be reached, and only if Jev's pick-and-copy path
cannot fill the schema.

### Jev cannot generate text

That is the constraint the whole design turns on. Everything the agent types is
lifted from the goal by `goal.ts` — quoted spans, proper nouns, and dates in
both ISO and written form — and Jev's only job is to choose which span belongs
in the field it is filling:

```
"… from Zurich to London on September 28, 2026 …"
  → ["2026-09-28", "September 28, 2026", "Zurich", "London"]
```

This is the same rule `packages/extension/services/jevAct/args.ts` enforces for
a single instruction, applied to a whole goal.

### Reading the output

```
turn  observe  decide  act     jev        seen  decision
----  -------  ------  ------  ---------  ----  --------------------------------------
1     [wall]   [wall]  [wall]  2× [wall]  N     combobox: Where from? (fill) ← "Zurich"
…
k     [wall]   [wall]  -       1× [wall]  N     goal reached
```

`decide` is wall clock around the Jev calls; `jev` is how many requests the turn
made and how long TypeSafe itself reported. `seen` is the candidate count, which
is what shard behaviour keys off. The run ends with one of:

| Status      | Meaning                                                      |
| ----------- | ------------------------------------------------------------ |
| `done`      | Jev scored the goal as met, above `--done-above`.            |
| `abstained` | Jev would not commit to any element above `--confidence`.    |
| `stalled`   | Nothing left worth acting on, and the goal is still not met. |
| `max-turns` | Ran out of turns.                                            |

After `done` the CLI checks the page rather than trusting the score, the same
way the reference does: it reads the visible results back with `extract()`.

### Keeping it out of trouble

The goal says not to book, and the agent is held to it by an `avoid` pattern
(`--allow-booking` removes it). Two other guards keep the loop honest: an action
that changes neither the URL nor the element count is banned from later turns,
and an action that fails is banned immediately.

### Where it gets to today

**It completes.** Twelve consecutive runs at defaults (headless, local Chrome):

```
done  5836ms  10 turns        abstained  7160ms
done  5854ms  11 turns        abstained  6985ms
done  5990ms  11 turns        max-turns 10555ms
done  6029ms  10 turns
done  6059ms  10 turns        9 of 12 reached `done`
done  6195ms  11 turns        every one of them in 5.8–6.6s
done  6304ms  11 turns
done  6317ms  11 turns
done  6632ms  10 turns
```

A completing run is ten or eleven turns and finishes inside the 7s budget with
room; the three failures are decision variance, not slowness. The whole thing
runs on Jev alone — **zero LLM calls** — and ends on
`/travel/flights/search?tfs=…ZRH…/m/04jpl…2026-09-28`, with `extract()` then
reading back twenty-five real flights.

```
turn  observe  decide  act    seen  decision
1     121ms    266ms   27ms    111  combobox: Change ticket type. Round trip
2     630ms    302ms   24ms      3  option: One way
3     459ms    261ms   29ms    110  combobox: Where from? (fill) — currently "Lyon" ← "Zurich"
4     212ms    322ms  228ms    110  combobox: Where to? (fill) ← "London"
5     141ms    274ms  234ms    109  textbox: Departure (fill) ← "2026-09-28"
6     143ms    296ms   48ms    108  button: Search
7     144ms    240ms   68ms    337  button: Done. Search for one-way flights…
8     171ms    288ms   52ms    110  button: Search
9     398ms    251ms   29ms     56  nothing to do yet; waiting for the page
10    458ms      0ms    0ms    206  goal reached (3/3 committed, results listed)
```

### Known limits

- Three runs in twelve do not converge. A per-turn choice at 0.3–0.6
  confidence, compounded over ten decisions, is why; the agent stops rather
  than flailing, and the run reports `abstained` or `max-turns`.
- Completion is verified from the URL and the page, never assumed. A goal whose
  values never appear anywhere will never be reported done, by design.
- `--confidence` defaults to 0.35, measured here. Jev derives confidence from
  the probability spread; `SHARD_SIZE` is 25 and lists over 40 are pruned to 30
  for the same reason.
- A native `<select>` is skipped. `observe()` reports the control but not its
  option list, so there is nothing for Jev to choose between.
- Waiting is adaptive, not a flat sleep: `--poll` (40ms) is the gap between
  page probes, and the page is read once its element count repeats. Replacing a
  400ms post-action sleep with this took `act` from 3546ms to ~110ms across a
  run; folding the field probe into the same call removed a second round trip
  per turn.
- Cookies are kept between runs in a small JSON jar, because Chrome will not
  flush its own when a session is torn down this fast. Without it the agent
  spends its first two turns on a consent banner no returning user would see;
  `--fresh-profile` restores the cold start.
- Past 400 interactive elements `observe()` hands off to the LLM rather than
  silently truncating, so a very dense page will cost a model call.
- Blanket cookie acceptance is kept out of the agent's reach so an unattended
  run takes "Reject all"; `--accept-cookies` removes that rail.
- What leaves the process — including, with `extract: "pick"`, extracted page
  content — is listed under "What leaves the process" in the jevAct README.
