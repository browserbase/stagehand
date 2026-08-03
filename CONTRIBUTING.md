# Contributing to Stagehand

Thanks for helping improve Stagehand. We value contributions that improve **reliability, extensibility, speed, and cost** (in that order).

For questions or pairing, join the [Discord community](https://stagehand.dev/discord).

## Before you start

- **Bug fixes and small improvements** are the best first PRs.
- For larger features, message [Miguel Gonzalez](https://x.com/miguel_gonzf) or [Paul Klein](https://x.com/pk_iv) on Discord first so the work aligns with roadmap priorities.
- Prefer opening an issue (or commenting on an existing one) before a large PR.

## Development setup

Prerequisites: **Node.js `^20.19.0` or `>=22.12.0`** (see `package.json` `engines`) and **pnpm**.

```bash
pnpm install
pnpm run build
pnpm run example   # blank script at packages/core/examples/example.ts (via @browserbasehq/stagehand)
```

Useful scripts (from the monorepo root):

| Script | Purpose |
| --- | --- |
| `pnpm run build` | Turbo build across packages |
| `pnpm run lint` / `pnpm run format` | Lint and Prettier |
| `pnpm run test:core` | Core unit tests |
| `pnpm run test:e2e` | End-to-end tests |
| `pnpm run test:evals` | Eval suite |

Target local Chromium vs Browserbase with env vars used by the scripts, for example:

```bash
pnpm run test:core:local
pnpm run test:e2e:local
```

Copy `.env.example` when you need LLM / Browserbase credentials for examples and evals.

## Pull requests

1. Fork the repo and create a focused branch.
2. Keep the diff scoped to one concern (fix, docs, or a small feature).
3. Add or update tests when behavior changes.
4. Run relevant checks locally (`build`, `lint`, and the test suite you touched).
5. Fill out the PR template and link related issues.

External contributor PRs may go through an approval handoff (see `.github/workflows/external-contributor-pr*.yml`) before full CI runs from forks.

## Code style

- TypeScript throughout; follow existing patterns in `packages/`.
- Prefer clear, small commits.
- Do not commit secrets; use `.env` locally only.

## Reporting bugs

Use the [bug report](.github/ISSUE_TEMPLATE/bug_report.md) template with:

- Stagehand version / package
- Browser target (local vs Browserbase)
- Minimal reproduction steps
- Expected vs actual behavior

## License

By contributing, you agree that your contributions are licensed under the same [MIT License](LICENSE) as Stagehand.

Refs: issue [#163](https://github.com/browserbase/stagehand/issues/163)
