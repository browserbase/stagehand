# OTEL Implementation Contract

Isolated worktree for a **stacked OTEL implementation** on top of the evals
tracing layer. This document is the source of truth for the three-PR stack:
what each new module exports, what the transport switch means, and what stays
byte-identical to today.

Baseline branch: `miguelgonzalez/evals-langsmith-gating` off `origin/main`
(`b07de5391`). Package: `packages/evals` (`@browserbasehq/stagehand-evals`).

---

## Transport switch

```
EVAL_TRACE_TRANSPORT = 'native' (default) | 'otel'
```

- **`native` (default)** — today's behavior, **byte-identical**. Tracing flows
  through `wrapAISDK(Braintrust)` + `framework/braintrust.ts` `tracedSpan`.
  No OTEL provider is constructed; the OTEL layer is a no-op. Any diff observed
  on Braintrust between HEAD and this branch in native mode is a regression.
- **`otel`** — spans are emitted through an OTEL `NodeTracerProvider` whose
  span processors come from the enabled backends (e.g. LangSmith). Braintrust
  emission via `wrapAISDK` is preserved so existing dashboards keep working.

Default MUST be `native`. Reading anything other than the literal `'otel'`
resolves to `native`.

---

## `framework/langsmith.ts` (new)

Gating + config only. No provider construction here (that is `otel.ts`).

Exports:

- `hasLangSmithApiKey(): boolean` — `Boolean(process.env.LANGSMITH_API_KEY)`.
  Mirrors the `hasBraintrustApiKey()` shape in `braintrust.ts`.
- `langSmithTracingEnabled: boolean` — **key present AND**
  `process.env.LANGSMITH_TRACING === 'true'`. Both conditions required.
- `loadLangSmith()` — lazy dynamic `import(...)` of the LangSmith SDK, memoized
  by a module-level promise (same pattern as `loadBraintrust()`).
- `assertLangSmithReady()` — throws a clear error if LangSmith is requested
  (transport `otel` + backend selected) but not properly configured
  (missing key / `LANGSMITH_TRACING !== 'true'`). Call it at wiring time so
  misconfiguration fails loud rather than silently dropping spans.

---

## `framework/otel.ts` (new)

OTEL provider lifecycle. Backend-agnostic; backends contribute span processors.

Exports:

- `buildTracerProvider()` → `NodeTracerProvider` with `spanProcessors` gathered
  from every enabled backend (LangSmith today; extensible later).
  - In `native` transport: returns **null / no-op** — no provider is built.
  - In `otel` transport: builds the provider and registers processors for each
    enabled/ready backend.
- `getTracer()` — returns a `Tracer` from the active provider; in native mode a
  no-op tracer so callers never branch on transport.
- `shutdownTracing()` — `forceFlush()` then `shutdown()` on the provider.
  **Safe to call when the provider is null** (native mode): no-op, no throw.
  Must be invoked on eval-run teardown so buffered spans are flushed.

---

## `framework/braintrust.ts` — `tracedSpan` (modified, signature frozen)

- **EXACT signature preserved**: `tracedSpan<T>(fn: TracedFn<T>, options: TracedSpanOptions): Promise<T>`
  where `TracedFn<T> = (span: SpanLike) => Promise<T>`,
  `SpanLike = Pick<Span, "log">`, and `TracedSpanOptions = StartSpanArgs & { name: string }`.
- **`NOOP_SPAN` preserved** — `{ log: () => {} }`, still returned when no
  tracing backend is active (no Braintrust key, native no-op path).
- **native mode**: unchanged — `hasBraintrustApiKey()` gate, else
  `braintrust.traced(fn, options)`. Byte-identical to today.
- **otel mode**: opens an **OTEL span** via `getTracer()` and passes the caller
  a `SpanLike` **adapter** whose `.log(args)` maps onto OTEL:
  - scalar/metadata fields → `span.setAttribute(key, value)`
  - discrete/structured events (output, scores) → `span.addEvent(name, attrs)`
  The adapter satisfies the same `SpanLike` (`Pick<Span,"log">`) surface, so
  **no call site changes** — every existing `span.log({ output, scores,
  metrics, metadata })` keeps compiling and working.

---

## Verifier

- The **verifier keeps emitting spans** exactly as it does today (these show up
  on Braintrust now). Under `otel` transport those same spans additionally flow
  through the OTEL provider via the `tracedSpan` adapter. Call sites in
  `framework/verifierAdapter.ts` (`tracedSpan(...)` + `span.log(...)`) are
  **not** rewritten — they ride the adapter transparently.

## `framework/trajectoryRecorder.ts`

- **UNTOUCHED.** Out of scope for this stack. No edits, no import changes.

---

## The 3-PR stack

Deps land in the **first PR that uses them** (no orphan dependency PRs).

1. **PR1 — gating + config**
   - `framework/langsmith.ts` (`hasLangSmithApiKey`, `langSmithTracingEnabled`,
     `loadLangSmith`, `assertLangSmithReady`).
   - `EVAL_TRACE_TRANSPORT` resolution helper (default `native`).
   - LangSmith SDK dependency added here (first use).
2. **PR2 — otel.ts + deps**
   - `framework/otel.ts` (`buildTracerProvider`, `getTracer`, `shutdownTracing`).
   - `@opentelemetry/*` (SDK-node / NodeTracerProvider) dependencies added here
     (first use).
3. **PR3 — wiring**
   - `tracedSpan` otel-mode adapter (`.log()` → `setAttribute`/`addEvent`).
   - Wire `buildTracerProvider` / `shutdownTracing` into the runner lifecycle;
     `assertLangSmithReady()` at startup when otel transport selected.

---

## Invariants (must hold at every PR)

- `pnpm --filter @browserbasehq/stagehand-evals run typecheck` stays GREEN.
- `native` transport is byte-identical on Braintrust vs. `origin/main`.
- `tracedSpan` signature + `NOOP_SPAN` unchanged.
- `trajectoryRecorder.ts` unchanged.
- `shutdownTracing()` is null-safe.
