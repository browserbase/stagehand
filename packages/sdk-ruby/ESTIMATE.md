# Ruby SDK for Stagehand v4 — effort estimate (AP-2857)

**TL;DR: ~10–13 engineering-weeks beyond this spike (~12.5–16 total, one engineer) to ship
a production Ruby SDK at parity with Python/Go.** The hard, uncertain layers are proven by
the walking skeleton in this package; the bulk of the remaining work is mechanical surface
area, parity tooling, docs, and release engineering.

## Why this is not a thin SDK

v3's Ruby gem was Stainless-generated against a hosted REST API. **That API does not exist
in v4.** A v4 SDK is a full in-process browser driver: it launches/attaches Chrome, tunnels
JSON-RPC 2.0 over a CDP WebSocket to the Stagehand extension service worker, and ships the
built extension inside the package. Nothing can be generated from an OpenAPI spec; only the
wire models are generated (from `packages/protocol/stagehand.v4.json`), matching how the
Python and Go SDKs are built.

## What the spike proved (de-risked)

| Risk | Outcome |
|---|---|
| No JSON-Schema→Ruby codegen exists | Custom stdlib-only generator, 274 LOC, covers all 234 defs + method registries, `--check` drift mode wired into `just generate`/`just check` |
| Wire casing | Free — the schema is already snake_case; opaque containers pass through verbatim (fixture round-trip tested) |
| Sync Ruby ↔ bidirectional RPC | Background-reader-thread model (Go-style) works; `websocket-driver` + own TCP/SSL socket, no reactor framework needed |
| Chrome without Playwright | Hand-rolled launcher ported from Python's `browser.py` works headless + headed on macOS |
| Extension packaging | Ruby zip is **byte-identical** to the Python SDK's deterministic archive (same SHA-256) |
| No Browserbase Ruby SDK exists | Hand-rolled 4-endpoint REST client (~130 LOC) suffices, mirroring Go |
| End-to-end | `goto → observe → act → extract` verified live on a local Chrome (transport) and on a Browserbase session (full AI loop incl. extension upload + Model Gateway + session release) |

Spike size: ~2,400 hand-written LOC + ~2,000 generated + ~800 tests. Python comparison:
~4,900 hand-written + ~3,600 generated — a fair proxy for the finished Ruby size.

## Work breakdown to production parity

| # | Item | Weeks |
|---|---|---|
| A | Walking skeleton (this spike) | 2.5–3 *(sunk)* |
| B | Full method surface (~62 remaining: context 14, page ~26, locator 17, response 6, clipboard, webmcp, file upload, callback_batch passthrough) — mechanical wrapper + tests per method, batched by namespace | 3–4 |
| C | Client-side LLM (`llm.generate` inbound handler, message/tool unions, custom-LLM example) | 1 |
| D | Validation hardening: strict unions, input ergonomics, RBS signatures, thread-safety soak | 1–1.5 |
| E | 11-example set + `example-parity` compliance | 0.5–1 |
| F | Parity tooling: ast-grep Ruby lane (`@ast-grep/lang-ruby` availability is the biggest unknown; prism-based fallback +0.5–1 wk) + extend `rules/ast-grep/*` | 1–1.5 |
| G | Docs: Ruby tabs across `docs/v4/reference/*` + guides + `sdk-reference.test.ts` | 1 |
| H | Release + CI: turbo task, changesets version proxy, `sync-ruby-version.ts`, extension embedding in the gem, RubyGems trusted publishing + alpha lane, CI matrix (Ruby 3.2–3.4 × macOS/Linux), **Windows launcher** | 1.5–2 |
| I | Beta hardening buffer (real-world sites, large payloads, memory/soak) | 1–1.5 |
| | **Total beyond spike** | **10–13.5** |
| | **Total including spike** | **~12.5–16.5** |

## Ongoing cost

- **Per protocol change:** ~0.5–1 day (regenerate models via `--check`-enforced codegen,
  add the wrapper method, tests, docs tab). The parity test suite makes drift loud.
- **Ruby version treadmill / dependency churn:** ~1 week/year (`websocket-driver` is the
  only runtime dependency).

## Risks

1. **ast-grep Ruby support** — parity enforcement is the repo's quality backbone; if no
   Ruby language pack exists, a prism-based custom checker is needed (priced above).
2. **Thread-model bugs** — the sync API + reader threads is the subtlest code; needs the
   soak time budgeted in D/I.
3. **We own the Browserbase REST client** — no official Ruby gem to lean on; API changes
   land on us (4 endpoints today).
4. **Windows** — Chrome launch/process management is untested there; budgeted in H.

## Recommendation

Ship in two phases: **(1)** B+C+D+E as a `0.x` beta gem (~6 weeks after the spike) to get
real-user signal before paying the parity/docs/release tax; **(2)** F+G+H+I to reach
first-class status alongside TypeScript/Python/Go. One engineer, with a protocol-side
reviewer for the parity-tooling week.
