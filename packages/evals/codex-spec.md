# Core Evals: Adapter-Abstracted Architecture

## What The Interview Implies

Core v1 is about:

- reliability
- latency
- adapter-to-adapter comparison
- regression detection
- AI ergonomics

Core tasks are code-first and mostly raw primitives plus small workflows.

The important adapters are:

- Understudy / V3
- Playwright
- raw CDP
- CLI commands

The task layer should target the lowest common denominator. That is the key constraint.

Environment and adapter stay separate axes, but environment is basically just a browser target provider because both sides are Chromium-over-CDP.

Correctness is explicit assertions in task code.

The result model has to include pass/fail, cold/warm timings, flake rate, cost/tokens, artifact size, normalized metrics, and raw adapter metrics.

CLI is not an NL agent interface in core. It is deterministic command verbs judged by the same verifier as everything else.

The run result needs adapter name, environment name, task name, normalized metrics, raw adapter metrics, and logs/traces.

V1 should prove the abstraction with understudy_v3 and playwright, focus only on core, and not let bench concerns drive the design yet.

---

## The Right Architecture

The system should become a 3-layer stack:

### 1. Browser Target

This is just how you get a Chromium endpoint.

Examples:

- local
- browserbase

Its job is to produce a session handle plus CDP connection info.

### 2. Tool Adapter

This is the deterministic tool layer under test.

Examples:

- understudy_v3
- playwright
- raw_cdp
- browse_cli

Its job is to implement the same small command surface against a target.

### 3. Agent Harness

This is bench-only.

Examples:

- Stagehand agent
- stagent-style skill harness
- MCP-driven agent
- future CLI agent harnesses

Its job is to solve tasks using one tool adapter.

That gives you the separation you want:

- **core** = compare tool adapters
- **bench** = compare full harness + tool + model stacks

So the matrices become:

- **Core:** target × adapter × task × trial_profile
- **Bench:** target × adapter × harness × model × task × trial_profile

---

## What Core Should Abstract

Core should not expose page, v3, or CLI-specific commands directly to tasks.

Core tasks should receive a minimal deterministic contract:

```typescript
interface CoreToolSession {
  goto(url: string): Promise<void>;
  reload(): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;

  click(selector: string): Promise<void>;
  clickCoordinates(x: number, y: number): Promise<void>;
  hover(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  press(key: string): Promise<void>;

  url(): Promise<string>;
  title(): Promise<string>;
  text(selector: string): Promise<string | null>;
  evaluate<T>(fn: () => T | Promise<T>): Promise<T>;
  waitFor(selector: string, opts?: { timeoutMs?: number }): Promise<void>;
  screenshot(): Promise<Buffer>;

  newTab(): Promise<void>;
  switchTab(index: number): Promise<void>;
  tabCount(): Promise<number>;
  setViewport(width: number, height: number): Promise<void>;
}
```

That is intentionally low-common-denominator.

If an operation is not shared by the first two adapters, it should not be in v1 core.

---

## What To Keep From The Current Spec

Keep these pieces from the existing work:

- filesystem task discovery
- defineTask-style authoring
- assertion helpers
- metrics helpers
- Braintrust spans
- CLI target resolution
- separate core/bench Braintrust projects

**Do not keep** for core:

- `buildCoreContext()` wrapping `initV3()` as the execution substrate

That part hardcodes V3 into the core layer.

---

## What To Change

Core tasks should stop being "V3 tasks that happen not to use an LLM."

Instead they should become "adapter-agnostic tool tasks."

So conceptually:

- **current core context:** `page + assert + metrics + logger`
- **new core context:** `tool + assert + metrics + artifacts + logger + adapterMeta`

And `tool` is backed by whichever adapter was selected for the run.

---

## AI Ergonomics

Core should track two metric families:

### 1. Execution metrics

- pass/fail
- startup time
- command time
- cleanup time
- warm vs cold timing
- flake rate

### 2. Representation metrics

- output byte size
- estimated token count
- maybe line count / node count / serialization size
- maybe parseability score later

This is important because "core" is not only about whether a click works. It is also about whether a tool layer exposes browser state in a form that is efficient for an agent to consume.

That suggests a future second family of core tasks:

- `snapshot_basic`
- `snapshot_large_dom`
- `observe_click_targets`
- `serialize_form_fields`

These are still tool-layer tasks, not bench.

---

## V1 Recommendation

V1 should be:

- two adapters: `understudy_v3`, `playwright`
- one target interface, with `local` and `browserbase` implementations
- a rewritten core task contract around low-level shared commands
- explicit assertion-based verification
- normalized metrics:
  - `startup_ms`
  - `command_ms`
  - `cleanup_ms`
  - `cold_total_ms`
  - `warm_total_ms`
  - `flake_rate`
  - `artifact_bytes`
  - `artifact_tokens_estimate`
- no bench migration
- no CLI adapter yet
- no raw CDP adapter yet unless it falls out very cheaply after Playwright

---

## What Bench Should Become Later

Bench should not bypass this layer.

Bench should eventually look like:

```
bench_task(
  harness = "stagehand_agent",
  adapter = "understudy_v3",
  target = "browserbase",
  model = "claude..."
)
```

or

```
bench_task(
  harness = "stagent_skill_runner",
  adapter = "playwright",
  target = "browserbase",
  model = "claude..."
)
```

So bench composes on top of core's tool adapters. It should not redefine the browser interface again.

---

## Strongest Recommendation

Do not evolve the current `framework/context.ts` further for core. That path is already V3-shaped. Keep the current spec's runner/discovery/reporting work, but build a new core execution substrate around:

- `TargetProvider`
- `ToolAdapter`
- `CoreTask`
