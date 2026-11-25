# Stagehand Lean 4 Formal Proofs

Zero-Mathlib Lean 4 (`v4.36.0`) formal verification suite for core Stagehand safety
and structural invariants. Every theorem is machine-checked by Lean's kernel with
zero `sorry`, zero `admit`, and zero custom axioms (only standard Lean axioms:
`propext`, `Classical.choice`, `Quot.sound`, or no axioms).

## Quick Start

```bash
bash scripts/verify-lean-proofs.sh
```

To emit deterministic `DomainPolicy` JSON test vectors from the proved Lean reference
model for differential testing against TypeScript:

```bash
cd proofs && lake exe stagehand-oracle --vectors
```

## Modules and Proved Theorems

### 1. `StagehandProofs/DomainPolicy.lean`

Models `packages/extension/understudy/domainPolicy.ts` over **arbitrary finite rule
lists** (`List Rule`, unbounded rule count), using Stagehand's strict subdomain
wildcard semantics (`*.d` matches `h` iff `h` ends with `.d`, matching
`domainPolicy.ts:163` and `domainPolicy.test.ts:118,143`).

- `blocked_always_wins`: any matching blocked rule forces `.block .blockedDomains`,
  regardless of `allowed`.
- `allowlist_default_deny` / `allowlist_default_deny_reason`: non-empty `allowed`
  with no matching allow rule always blocks.
- `empty_host_blocked_under_allowlist` / `dot_host_blocked_under_allowlist`: an
  empty canonical host (including `"."` from `https://./`) is blocked under any
  non-empty allowlist of non-empty domain rules.
- `wildcard_boundary_sound` / `wildcard_no_suffix_spoofing` / `wildcard_excludes_apex`:
  `*.d` matches `h` iff `h` ends with `.d`; non-dot boundaries (e.g. `evil-d`) never
  match and apex `d` is strictly excluded.
- `monotone_blocklist_addition` / `monotone_blocklist_append`: adding blocked rules
  never turns a `block` decision into `continue`.
- `rule_order_independent`: policy decisions depend only on rule set membership,
  never list ordering or duplicate rules.
- `decideDnr_eq_decide`: exact equivalence between the reference evaluator and the
  3-tier DNR priority model (`toDomainPolicyDnrRules`).

### 2. `StagehandProofs/FrameTree.lean`

Models `packages/extension/understudy/frameRegistry.ts` (`FrameRegistry`) with root
tracking, parent/children maps, session ownership bijection, and guarded transition
alphabet (`attachChild`, `reparentNonDescendant`, `detachSubtree`, `adoptSession`,
`renameNodeId`).

- `init_wellFormed`: initial single-root registry satisfies `WellFormed`.
- `runEvents_preserves_wellFormed` / `init_runEvents_wellFormed`: inductive proof
  over **all finite event histories `List FrameEvent`** (unbounded depth & trace
  length) that `WellFormed` (root exists with no parent, parent-child symmetry,
  `ownerOf` ↔ `sessionFrames` bijection, and strict depth-witnessed acyclicity) is
  preserved.
- `wellFormed_no_cycles`: no node can be its own ancestor across any path length.
- `wellFormed_reaches_root`: every present frame is either `rootId` or a strict
  descendant of `rootId`.

### 3. `StagehandProofs/LocatorChain.lean`

Models multi-step locator chain resolution (`chainLocator.ts`,
`elementChainResolver.ts`, `frameChainResolver.ts`) with element queries, explicit
frame hops, positional slicing (`first`, `last`, `nth`), session/loader validation,
and bracketed `objectGroup` handle accounting.

- `resolveChain_session_isolation`: inductive proof over **arbitrary chain lengths
  `List ChainStep`** that every resolved handle's `sessionId` matches its owning
  frame's authoritative session.
- `resolveChain_zero_objectGroup_leak`: executing any chain under bracketed
  `withObjectGroup` with a fresh group ID leaves `activeGroups` unchanged across all
  outcomes (`ok`, `notFound`, `error`, `aborted`) and any number of touched sessions.
- `slice_bounds_sound` / `sliceIndex_lt_length` / `sliceIndex_deterministic`:
  `first`, `last`, and `nth` never return out-of-bounds indices, never fabricate
  elements outside the input list, and are deterministic.

### 4. `StagehandProofs/CacheSafety.lean`

Models the unified `act()` / `withCache` execution state machine (`cacheService.ts`,
`actService.ts`) with routes (`cacheReplay`, `webMCP`, `domAct`), `plannedSteps`,
`inFlight`, `stopSignal`, `recovered`, and `cacheEligible`.

- `at_most_one_committed_route` / `no_competing_route_commits`: once a route
  dispatches a side effect, no competing route can commit in any finite continuation.
- `no_cache_write_on_recovery_or_failure`: failed, aborted, stopped, recovered, or
  cache-ineligible runs can never write to cache.
- `abort_prevents_new_dispatch`: after `stopSignal` is set, `domDispatched` never
  increases and no new route commits.
- `dispatched_within_plan`: `domDispatched ≤ plannedSteps` across all finite traces.

### 5. `StagehandProofs/AxiomAudit.lean` & `Main.lean`

- `AxiomAudit.lean` invokes `#print axioms` on all main theorems above.
- `Main.lean` builds the `stagehand-oracle` executable for deterministic model
  self-checks and JSON vector export (`--vectors`).

## Scope & Discrepancies Surfaced Against `main`

These Lean models are abstract reference specifications grounded in the TypeScript
files above; they are not mechanically extracted from TypeScript. Grounding the
models surfaced concrete discrepancies in `origin/main`:

1. **`domainPolicy.ts:174` (allowlist fail-open on empty canonical host):**
   `new URL("https://./").hostname` is `"."`, which `canonicalizeHostname` strips to
   `""`. `getDomainPolicyDecision` then executes `if (!hostname) return { action: "continue" }`,
   allowing `https://./` through a non-empty `allowedDomains` policy while
   `toDomainPolicyDnrRules` blocks it via priority-1 `^https?://`.
2. **`frameRegistry.ts:96-105` (missing unlink and cycle guard in `onFrameAttached`):**
   Reparenting an existing frame overwrites `info.parentId` without deleting `frameId`
   from the previous parent's `children` set (breaking parent-child symmetry), and
   performs no ancestor check (allowing cycles that cause infinite recursion in
   `listAllFrames`, `asProtocolFrameTree`, and `onFrameDetached`).
3. **`frameRegistry.ts:115-128` & `326-360` (`onFrameNavigated` root swap clobbers state):**
   `onFrameNavigated` calls `ensureNode(frame.id)` and `setOwnerSessionIdInternal(frame.id, sessionId)`
   before `renameNodeId(this.rootFrameId, frame.id)`. `renameNodeId` then overwrites
   `this.frames.get(frame.id)` with the old root's `FrameInfo`, clobbering `lastSeen`
   and leaving a stale entry in `framesBySession[sessionId]` when sessions differ.
4. **`frameRegistry.ts:178-182` (`onFrameDetached` on root):**
   Detaching `rootFrameId` deletes the entire tree, leaving `this.frames` empty while
   `this.rootFrameId` remains dangling.
5. **`cacheService.ts:265-318` & `actService.ts:265-276` (partial cache replay fallback):**
   If a multi-action `replayCachedActions` executes action 1 (mutating the DOM) and
   fails on action 2, `withCache` catches the failure, falls back to full LLM
   execution (violating single committed route), and writes the post-mutation result
   under the stale pre-mutation `baseRequest.cdpTree`.
6. **`actService.ts:188-245` & `388-468` (two-step & self-heal cache writes):**
   When `twoStep` is true and step 1 fails, `runActPipeline` still runs step 2
   inference and execution; and when `selfHealAction` recovers a failed action,
   `cacheValue` is still populated and written to cache.
