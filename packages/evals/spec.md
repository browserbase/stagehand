# Evals Progress Spec

## Current Status

The core adapter migration is now partially landed.

Completed:

- adapter-backed core contracts exist under `packages/evals/core/contracts/`
- first tool surface exists as `understudy_code`
- core context is adapter-backed
- `runCore` supports `EVAL_TOOL_SURFACE`
- the original core task set has been moved into `packages/evals/core/tasks/`
- the missing `packages/evals/framework/` source layer has been restored from the built framework so source imports resolve again
- discovery now resolves core tasks only from `packages/evals/core/tasks/`
- the legacy `packages/evals/tasks/core/` compatibility path has been removed

## Core Task Move

Core task source of truth is now:

`packages/evals/core/tasks/`

Current categories:

- `actions`
- `forms`
- `navigation`
- `page-info`
- `tabs`
- `viewport`

## Discoverability

Core task discovery is now single-sourced:

- framework discovery scans `core/tasks` for the `core` tier
- bench discovery still scans `tasks/bench`

That means:

- direct task name resolution still works
- category resolution still works
- source-of-truth task authoring is `core/tasks`

## Why This Interim Shape Exists

The eval package now treats `core/` as the canonical home for deterministic core work, instead of keeping a parallel `tasks/core` tree alive.

## Landed Core Adapter Work

- `CoreTool`, `CoreSession`, `CorePageHandle`, target kinds, and representation contracts exist
- `understudy_code` wraps the current Understudy/V3 surface
- compatibility methods are intentionally present in the page handle so the existing deterministic core tasks continue to run during migration
- source-level discovery coverage now includes tests for `core/tasks` resolution, rejection of legacy `tasks/core`, and partial-name resolution like `open`

## Remaining Work

- implement `playwright_code`
- implement representation verifiers beyond basic coverage / token-size checks
- retarget core tasks away from V3-shaped compatibility helpers toward the cleaner portable contract
- decide whether to keep `page-info` naming or fold it into `inspection`

## Near-Term Plan

1. Keep `core/tasks` as the only place new core tasks are authored.
2. Keep all new discovery and runner work pointed at `core/`.
3. Retire remaining docs or tooling that still describe `tasks/core`.
