// PLACEHOLDER — replaced locally by `scripts/build-v4-shim.ts`.
//
// The real module is an esbuild bundle of the TS-only v4 SDK from the sibling
// stagehand-v4 repo. We commit this stub (instead of the multi-MB bundle) so
// the normal evals build works without that repo present; the v4 surfaces only
// become usable after you build the shim:
//
//   pnpm --filter @browserbasehq/stagehand-evals run build:v4
//
// (build:v4 = build the shim, then rebuild the CLI so it picks up the bundle.)
//
// Do NOT commit the built bundle that overwrites this file locally — restore
// this stub before committing if `git diff` shows it as a huge change.
export class StagehandClient {
  constructor() {
    throw new Error(
      "stagehand-v4 shim is not built. Run `pnpm --filter " +
        "@browserbasehq/stagehand-evals run build:v4` (requires the stagehand-v4 " +
        "checkout at ../stagehand-v4, or set $STAGEHAND_V4_DIR) before using the " +
        "v4 eval surfaces.",
    );
  }
}
