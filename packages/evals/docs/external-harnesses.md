# External harnesses: the harness-richness spectrum

**Status:** design + implementation (this PR). Design-review vehicle — the
code is working but the point of this document is to agree on the shape.

## Why

We need to measure browse CLI + SKILL.md performance **across the
harness-richness spectrum**, so that skill-content improvements can be
validated regardless of model intelligence or agent scaffolding.

Two findings motivate this:

1. **The scaffolding gap is real and dominant.** The Duckbill investigation
   (STG-2448) found browse scoring 1/5 where managed Agents scored 3/5 on the
   same tasks — and the gap was *scaffolding, not model*: discovery breadth,
   retry persistence, and CUA-style behaviors that a rich harness supplies
   and a bare one doesn't.
2. **Smart harnesses mask doc flaws.** A 3-provider bare-loop smoke
   (2026-07-09, Modal sandboxes) found **5 systematic SKILL.md/template
   issues in 3 runs** that months of daily Claude Code usage never surfaced.
   Rich harnesses compensate for documentation gaps (they retry, infer, read
   `--help` unprompted, recover from stale examples); bare loops execute the
   skill text literally. If we only ever eval under Claude Code, we are
   measuring Claude Code's ability to repair our docs, not our docs.

The bare loops are therefore **reference instruments, not products**: small,
readable, deliberately unimproved. Making them smarter would destroy the
measurement.

## The spectrum

Adoption data (2026-07-09 research) says where real agent traffic lives:

| Tier | Harness | `--harness` | Real-world weight | What the harness gives the agent |
| --- | --- | --- | --- | --- |
| Bare | Raw Anthropic SDK loop | `anthropic_sdk` | 37.5M PyPI dl/wk (provider SDK) | Nothing. Hand-rolled `while stop_reason == "tool_use"` loop. |
| Bare | Vercel AI SDK | `vercel_ai_sdk` | 15.1M npm dl/wk — the JS default | `generateText` + `stopWhen: stepCountIs(N)`. Loop plumbing only, zero behavior. |
| Bare-ish | OpenAI Agents SDK | `openai_agents_sdk` | 6.8M PyPI dl/wk | Managed turn loop + tracing, but *all* behavior comes from dev-written `instructions`. Defaults untouched except `maxTurns`. |
| Full | Claude Code | `claude_code` | (existing) | Full agentic scaffolding: skills, retries, planning, permission system. |
| Full | Codex | `codex` | (existing) | Full agentic scaffolding. |
| Full | Cursor SDK | `cursor_sdk` | 343K npm dl/wk | "The same runtime, harness, and models that power Cursor" — a managed full agent. **This belongs on the smart tier next to claude_code/codex, not the bare tier**, despite being a new SDK: it ships Cursor's complete loop, planning, and tool behaviors. |

The raw provider SDKs (openai 84M + anthropic 37.5M PyPI/wk) dominate
bare-loop reality; the Vercel AI SDK is the JS-ecosystem default and genuinely
bare. That's the population our skill docs actually meet in the wild.

## Skill-delivery modes (the A/B/C arms)

Orthogonal to harness choice, each run selects how the browse skill reaches
the agent — `--skill-mode <none|prompt_show|injected>`:

| Arm | Mode | What the agent gets | Notes |
| --- | --- | --- | --- |
| A | `none` (default for bare loops) | One-line system prompt + `--help` discovery only | Measures raw CLI discoverability. Default because the bare tier exists to catch what docs/scaffolding otherwise mask. |
| B | `prompt_show` | Arm-A prompt + "run `browse skills show` first" | **Gated:** requires a browse release carrying [PR #2335](https://github.com/browserbase/stagehand/pull/2335) (`browse skills show`), unreleased at time of writing. The adapter logs a loud warning with the installed CLI version; on older releases this arm degenerates to a failed command + arm-A behavior. |
| C | `injected` | Skill content pre-loaded | For claude_code this is the existing behavior (SKILL.md installed, Skill tool). Bare loops have no Skill-tool primitive, so `injected` embeds the SKILL.md text directly in the system prompt — same information, different transport, recorded per-run in metadata. |

`claude_code`/`codex` keep their existing provisioning untouched (injected-style
skill installation); `--skill-mode` currently drives the four new harnesses.
Extending A/B arms to claude_code/codex is a follow-up (it means *not*
installing the SKILL.md those adapters currently always install).

## System-prompt policy for bare loops

**No scaffolding beyond the configured arm prompt — the bareness IS the
instrument.** The default (arm A) system prompt is exactly the one-liner the
Modal sandbox templates use, verbatim:

> You drive a real web browser by running the "browse" CLI, one command per
> tool call (e.g. "open https://example.com" or "get markdown body"). You
> have not used this CLI before and have no documentation for it beyond what
> you discover yourself. Figure out its exact commands and flags by running
> "--help" and "\<command\> --help" as needed -- do this before/while working
> the task, not just once up front.

(`BARE_LOOP_DEFAULT_SYSTEM_PROMPT` in
`framework/externalHarnessToolAdapter.ts`.) Task specifics (dataset, start
URL, instruction, EVAL_RESULT output contract) ride in the *user* prompt —
same split a real developer script uses. Nothing else: no retry advice, no
"be persistent", no tool cheat-sheets.

## Model parameterization

The existing `-m` flag works on every harness:

```
evals b:webtailbench --harness vercel_ai_sdk -m anthropic/claude-haiku-4-5-20251001
evals b:webtailbench --harness anthropic_sdk -m anthropic/claude-sonnet-4-6
evals b:webtailbench --harness openai_agents_sdk -m openai/gpt-5.4-mini
evals b:webtailbench --harness cursor_sdk -m cursor/composer-2.5
```

- `vercel_ai_sdk` accepts any `provider/model` that stagehand's
  `getAISDKLanguageModel` provider map resolves (the same resolution the
  stagehand harness uses, so model names mean the same thing on both).
- `anthropic_sdk` / `openai_agents_sdk` accept only their own provider's
  models (prefix stripped, mismatched prefixes rejected loudly).
- `cursor_sdk` takes Cursor catalog ids (`cursor/composer-2.5`).
- Per-harness default-model env overrides: `EVAL_VERCEL_AI_SDK_MODELS`,
  `EVAL_ANTHROPIC_SDK_MODELS`, `EVAL_OPENAI_AGENTS_SDK_MODELS`,
  `EVAL_CURSOR_SDK_MODELS` (matching the existing `EVAL_CLAUDE_CODE_MODELS` /
  `EVAL_CODEX_MODELS`).

## Step caps

Bare-loop default is **40 steps** (`DEFAULT_BARE_LOOP_MAX_STEPS`): the
3-provider smoke showed 20 is cap-binding for webtailbench-style tasks when
every action is one CLI invocation. Configurable per harness:
`EVAL_VERCEL_AI_SDK_MAX_STEPS`, `EVAL_ANTHROPIC_SDK_MAX_STEPS`,
`EVAL_OPENAI_AGENTS_SDK_MAX_TURNS`. Cursor manages its own loop (no SDK-level
turn cap is exposed); like claude_code it inherits harness-native limits.

## Verifier integration (unchanged)

All four adapters feed `gradeExternalTrajectory` (merged in
[#2138](https://github.com/browserbase/stagehand/pull/2138)) exactly as
claude_code/codex do: build a `Trajectory`, hydrate the rubric
(precomputed → cached → generated), `V3Evaluator.verify()` post-hoc
(judge: gemini-2.5-flash via `GEMINI_API_KEY`), persist the trajectory, fold
`outcomeSuccess`/`processScore` into the TaskResult. Failures in the verifier
path set `verifierError` and fall back to the agent's self-report — a graded
run is always distinguishable from an ungraded one.

The one structural difference: bare loops **record `NormalizedToolCall`s at
execution time** (they own their loop), so their trajectory adapter
(`harnesses/bareLoopAdapter.ts`) is nearly the identity function, instead of
reverse-engineering an event stream the way claudeCodeAdapter/codexAdapter/
cursorAdapter must.

## Browse provisioning + command gating (shared)

All four adapters reuse `prepareBrowseCliHarnessAdapter` — the same
provisioning contract codex delegates to: per-run temp cwd, per-run session
name, `browse` wrapper pinning `--local`/`--remote` + `--session`, built-CLI
artifact checks, `stop --force` cleanup. Command gating reuses
`isAllowedBrowseCommand`: **one `browse ...` command per tool call, no shell
metacharacters** ( `; & | \` $ < >` rejected). The bare loops expose exactly
one tool (`browse`); the model never gets a shell.

Known limitation (cursor_sdk): Cursor's SDK does not expose an allow-list to
hard-disable its native shell/file tools, so browse-only discipline there is
prompt + custom-tool based rather than a `canUseTool`-style hard gate. Its
native shell still runs inside the per-run temp cwd.

## TS-only note (deliberate simplification)

Real-world anthropic/openai bare loops are predominantly **Python** (that's
where the 84M/37.5M weekly downloads live). These adapters are TypeScript
because `packages/evals` is TypeScript. The loop shape — messages array, tool
dispatch, stop-reason check, step cap — is language-invariant, and the thing
under test is the browse CLI + skill text, which is language-agnostic (the
agent sees identical stdout either way). Recorded as a deliberate
simplification; a Python twin would only be worth building if we ever suspect
provider-SDK behavior differs across languages.

## Compose order vs. open PRs

Two open PRs touch neighboring files;
this branch is based on origin/main and composes with either merge order:

- [#2299](https://github.com/browserbase/stagehand/pull/2299) (browse v0.9.1
  contract in claudeCodeToolAdapter): we only *import* from that file
  (`prepareBrowseCliHarnessAdapter`, `isAllowedBrowseCommand`) — additive.
- [#2334](https://github.com/browserbase/stagehand/pull/2334) (harness
  installs the real packages/cli SKILL.md): changes which SKILL.md
  `installBrowserSkill`/`BROWSER_SKILL_SOURCE` points at; our `injected` mode
  reads the same constant's file, so it inherits whichever lands.
