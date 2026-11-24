# Stagehand Formal Protocol Specifications (Quint / TLA+)

This directory contains executable [Quint](https://github.com/informalsystems/quint) specifications for Stagehand's core cancellation, CDP frame-lifecycle, and action-driver protocols, verified with Quint's typechecker, Rust randomized simulator, and ITF trace replay.

## Specifications

| Spec                                                     | Scope & Relation to Code                                                                                                                                                                                                                                                                                                                                             | Checked Invariants                                                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`rpc_cancellation.qnt`](./rpc_cancellation.qnt)         | Models the Extension -> SDK reverse-RPC cancellation path (`packages/extension/clients/browserbaseClient.ts`, `packages/extension/clients/rpcClient.ts`, `packages/sdk-ts/src/browserbaseRpc.ts`, `packages/extension/understudy/progress.ts`), including deferred abort on dispatch races, `releaseClient()`/`acceptClient()`, late responses, and WebSocket close. | `noOrphanedPendingAfterClose`, `exactOnceSettlement`, `cancelDeliveredOnDeadline`, `noDeadlock`, `allInvariants`                          |
| [`cdp_frame_lifecycle.qnt`](./cdp_frame_lifecycle.qnt)   | Models Chrome CDP frame topology (`packages/extension/understudy/frameRegistry.ts`), execution contexts (`packages/extension/understudy/executionContextRegistry.ts`), and session-pinned `objectGroup` handles including late post-release replies (`packages/extension/understudy/elementChainResolver.ts`).                                                       | `treeIsAcyclic`, `parentChildSymmetric`, `sessionMapBijective`, `noCrossSessionHandleMix`, `noLeakedHandlesWhenIdle`, `allInvariants`     |
| [`act_driver_lifecycle.qnt`](./act_driver_lifecycle.qnt) | **Target safety contract** for a unified decision/`act()` driver coordinating DOM settle, cache lookup/replay, WebMCP vs. LLM DOM routing, bounded pre-commit recovery, verification, cache-write gating, and `Progress` cancellation. Does not mirror legacy `actService.ts` line-for-line (see divergences below).                                                 | `singleSideEffect`, `neverBothToolAndDomClick`, `noCacheOnRecovery`, `cancellationPreventsDispatch`, `terminatesCleanly`, `allInvariants` |

## Prerequisites

Quint can be invoked via `pnpm dlx @informalsystems/quint` (tested with Quint `0.34.0`):

```bash
pnpm dlx @informalsystems/quint --version
```

## Typechecking

```bash
pnpm dlx @informalsystems/quint typecheck specs/rpc_cancellation.qnt
pnpm dlx @informalsystems/quint typecheck specs/cdp_frame_lifecycle.qnt
pnpm dlx @informalsystems/quint typecheck specs/act_driver_lifecycle.qnt
```

## Randomized Simulation (Invariant Checking)

```bash
pnpm dlx @informalsystems/quint run --max-samples=2000 --max-steps=30 \
  --invariant=allInvariants specs/rpc_cancellation.qnt

pnpm dlx @informalsystems/quint run --max-samples=2000 --max-steps=30 \
  --invariant=allInvariants specs/cdp_frame_lifecycle.qnt

pnpm dlx @informalsystems/quint run --max-samples=2000 --max-steps=20 \
  --invariant=allInvariants specs/act_driver_lifecycle.qnt
```

Target any individual invariant with `--invariant=<name>`, and reproduce a run deterministically with `--seed=<hex>`.

## Symbolic Model Checking with Apalache

All three specs use fixed finite domains and bounded graph traversals for Apalache compatibility:

```bash
pnpm dlx @informalsystems/quint verify --max-steps=12 \
  --invariant=allInvariants specs/rpc_cancellation.qnt

pnpm dlx @informalsystems/quint verify --max-steps=10 \
  --invariant=allInvariants specs/cdp_frame_lifecycle.qnt

pnpm dlx @informalsystems/quint verify --max-steps=12 \
  --invariant=allInvariants specs/act_driver_lifecycle.qnt
```

## Trace Replay Against Real TypeScript Code

`specs/cdp_frame_lifecycle.qnt` records each transition in `lastAction` so exported [ITF (Informal Trace Format)](https://apalache-mc.org/docs/adr/015adr-trace.html) traces can be replayed against `FrameRegistry` (`packages/extension/understudy/frameRegistry.ts`).

### 1. Generate ITF traces

```bash
mkdir -p specs/traces
i=0
for seed in 0x1a2b3c4d 0x5e6f7a8b 0x9c0d1e2f 0x3b4c5d6e 0x7f8091a2; do
  i=$((i + 1))
  pnpm dlx @informalsystems/quint run \
    --seed="$seed" \
    --max-samples=1 \
    --max-steps=40 \
    --invariant=allInvariants \
    --out-itf="specs/traces/cdp_frame_lifecycle_${i}.itf.json" \
    --verbosity=1 \
    specs/cdp_frame_lifecycle.qnt
done
```

### 2. Replay traces with Vitest

```bash
pnpm vitest run packages/extension/understudy/frameRegistry.trace.test.ts
```

For every state in each trace, `frameRegistry.trace.test.ts` translates `state.lastAction` into the corresponding `FrameRegistry` call, checks `treeIsAcyclic`, `parentChildSymmetric`, and `sessionMapBijective` on the live maps, and asserts step-by-step state refinement against the Quint snapshot.

## Known Spec-vs-Implementation Divergences

1. **`FrameRegistry.onFrameNavigated` cross-session root swap (`packages/extension/understudy/frameRegistry.ts:114-130`)**: `setOwnerSessionIdInternal(frame.id, sessionId)` and `info.lastSeen = frame` execute before `renameNodeId(this.rootFrameId, frame.id)`. `renameNodeId` then overwrites `frames.get(frame.id)` with the old root's `FrameInfo`, clobbering `lastSeen` and (when `sessionId !== oldRoot.ownerSessionId`) leaving `frame.id` in both `framesBySession` bags — violating `sessionMapBijective`.
2. **`FrameRegistry.onFrameAttached` re-parenting (`packages/extension/understudy/frameRegistry.ts:96-105`)**: Updating `info.parentId` does not unlink `frameId` from the previous parent's `children` set (unlike `seedFromFrameTree`), violating `parentChildSymmetric`.
3. **`FrameRegistry.onFrameAttached` root swap onto existing child ID (`packages/extension/understudy/frameRegistry.ts:87-93`)**: `renameNodeId(this.rootFrameId, frameId)` does not guard against `frameId` already being a child of `rootFrameId`, producing a self-loop (`parentId === frameId` and `children.has(frameId)`) — violating `treeIsAcyclic`.
4. **Unified `act()` driver target contract (`specs/act_driver_lifecycle.qnt`) vs. current `actService.ts` / `cacheService.ts`**: `act_driver_lifecycle.qnt` specifies the target safety contract where recovery/self-heal/cache-replay fallback latches `cacheEligible = false` (`noCacheOnRecovery`) and WebMCP vs. LLM DOM routing is unified behind a single-side-effect boundary. In the current codebase, `actService.ts` writes `cacheValue` whenever `result.data.success && result.data.actions.length > 0` even after `selfHealAction`, and WebMCP tool dispatch currently lives on `Page` (`packages/extension/understudy/page.ts`).
