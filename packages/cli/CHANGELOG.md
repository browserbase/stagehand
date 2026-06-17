# browse

## 0.8.5

### Patch Changes

- [#2258](https://github.com/browserbase/stagehand/pull/2258) [`2441cd4`](https://github.com/browserbase/stagehand/commit/2441cd4197da67896dca1e4a856673032fd66c74) Thanks [@shrey150](https://github.com/shrey150)! - Stop headed local sessions from stealing OS focus on every command.

  In headed managed-local mode the browse daemon re-resolved the active page on every subcommand and called `setActivePage()` unconditionally, which ends in a CDP `Target.activateTarget`. On macOS that raises the whole Chrome app to the OS foreground, stealing keyboard focus from the editor/terminal on each `browse navigate/snapshot/get/…` — making the CLI nearly unusable alongside a coding agent and impossible to parallelize. The active tab is now re-activated only when it actually changes; explicit `tab new` / `tab select` still foreground intentionally.

- [#2249](https://github.com/browserbase/stagehand/pull/2249) [`4ee8d99`](https://github.com/browserbase/stagehand/commit/4ee8d9948c143e114b33b8b63b90c75daec1545d) Thanks [@shrey150](https://github.com/shrey150)! - Add did-you-mean suggestions and telemetry for unknown commands.

  - Unknown commands (e.g. `browse sessions`, `browse search`, `browse auth status` — old Commander-era syntax — plus plain typos like `browse opne`) now print an actionable suggestion on stderr: an explicit alias table maps old syntax to the current command tree, with a Levenshtein nearest-match fallback for typos. The clause is omitted when there is no decent match.
  - A new `cli.command_not_found` telemetry event makes this failure class measurable. Privacy: only the sanitized attempted command id and the computed suggestion are sent — never raw argv, which can contain URLs, selectors, or secrets.
  - oclif's standard "command not found" error and exit code 2 are preserved; no new runtime dependency (deliberately avoids `@oclif/plugin-not-found`, which prompts interactively and is agent-hostile).

- [#2248](https://github.com/browserbase/stagehand/pull/2248) [`cffcc91`](https://github.com/browserbase/stagehand/commit/cffcc91add8edc1f9b9f0846b36ecb8ea51605d0) Thanks [@shrey150](https://github.com/shrey150)! - Make driver (browser session) failures actionable, classified, and self-correcting.

  - An invalid `BROWSERBASE_API_KEY` no longer surfaces a bare `401 Unauthorized`: remote init failures are classified (401 invalid key, 403 permissions/plan, other) into actionable messages that point at the key settings page, `--local`, and `browse doctor`.
  - A missing local Chrome now explains how to install Chrome, attach with `--cdp`, or switch to remote, instead of leaking chrome-launcher internals.
  - Cached init failures back off exponentially (5s doubling, capped at 5 minutes) and append a "failing repeatedly" hint after 3 consecutive failures, so retry-looping agents get a clear self-correction signal instead of instant identical errors forever.
  - The daemon protocol now carries optional `code`/`httpStatus` on error responses (backward compatible), and the client records them as telemetry result codes — `open` failures stop being 94% `unexpected`. New codes include `remote_auth_401`, `remote_auth_403`, `remote_session_create_failed`, `no_chrome_found`, `stale_ref`, `no_active_page`, `daemon_lock_timeout`, `daemon_unresponsive`, `daemon_socket_timeout`, and `daemon_spawn_failed`.

- [#2201](https://github.com/browserbase/stagehand/pull/2201) [`9971a7b`](https://github.com/browserbase/stagehand/commit/9971a7b3d8ecca255b4548cfb9128657c053cca7) Thanks [@shrey150](https://github.com/shrey150)! - Add Chrome launch arg flags for managed local browser sessions: `--chrome-arg <flag>` (repeatable) appends launch args on top of Chrome's defaults, `--ignore-default-chrome-arg <flag>` (repeatable) drops specific default args, and `--no-default-chrome-args` launches without any of Chrome's defaults.

- [#2251](https://github.com/browserbase/stagehand/pull/2251) [`3ecf09e`](https://github.com/browserbase/stagehand/commit/3ecf09eabb7f3cd107bf64378664416597e912c8) Thanks [@shrey150](https://github.com/shrey150)! - Emit a `skill_id` property on `cli.command_completed` telemetry.

  The validated, catalog-public skill id (e.g. `yelp.com/extract-reviews`, or `bundled/browse` for `skills install`) is attached to the completion event for `browse skills add`/`install`, covering both successful installs and every downstream failure path (`skill_not_found`, `skill_install_failed`, ...). Only the parsed, regex-validated id is ever attached — never the raw argument.

## 0.8.4

### Patch Changes

- [#2213](https://github.com/browserbase/stagehand/pull/2213) [`7449046`](https://github.com/browserbase/stagehand/commit/7449046647c30800404c333dd604bacccba0aa7c) Thanks [@shrey150](https://github.com/shrey150)! - fix(cli): request the full template catalog via scope=all so `browse templates list` returns all templates, not just playground-runnable ones

- [#2210](https://github.com/browserbase/stagehand/pull/2210) [`a9552fd`](https://github.com/browserbase/stagehand/commit/a9552fde629a2b13bc32dedc002e401af90b866c) Thanks [@shrey150](https://github.com/shrey150)! - Make `browse skills add` failures diagnosable and fail cleanly on unknown skills.

  - Unknown (non-generated) skill ids now fail fast with an actionable "not found in the catalog" message pointing at `browse skills find`/`browse skills list`, instead of silently git-cloning the entire browse.sh repo and exiting with an opaque error.
  - The `npx skills add` child's output is now buffered (tail) while still streaming live to the terminal, so a nonzero exit surfaces the real reason instead of a bare exit code.
  - Failures now record distinct telemetry result codes (`skill_not_found`, `invalid_skill_id`, `npx_missing`, `skill_install_failed`) so the failure modes are measurable.
  - `browse skills add` with no argument now prints actionable guidance (the `<domain>/<task>` form plus `browse skills find`) instead of oclif's bare "Missing 1 required arg".

## 0.8.3

### Patch Changes

- [#2192](https://github.com/browserbase/stagehand/pull/2192) [`e7d3b55`](https://github.com/browserbase/stagehand/commit/e7d3b55f69f2a1fd75e92dea8f831f96fa6180d3) Thanks [@shrey150](https://github.com/shrey150)! - Lead-with-local onboarding: the missing-API-key error on cloud commands now tells users that local browser automation needs no key and points them to `browse open <url> --local`. The remote-mode driver error is clearer about when a key is required versus when local mode works without one.

## 0.8.2

### Patch Changes

- e29aeac: Update README demo GIF link

## 0.8.1

### Patch Changes

- 67d0ce8: Restore CLI telemetry agent attribution.
- c9a4236: Restore CLI completion telemetry result and HTTP metadata.

## 0.8.0

### Minor Changes

- 013f345: Add Browserbase Fetch API output formats to `browse cloud fetch`, defaulting to markdown with support for raw and schema-based JSON output.

## 0.7.3

### Patch Changes

- 87c0535: Publish the updated npm README.

## 0.7.2

### Patch Changes

- c0ed7ff: Allow `browse skills list` and `browse skills find` to display any skill method value returned by the Browse.sh catalog.

## 0.7.1

### Patch Changes

- 4d4f7f4: Make skills and templates list-style output human-readable in terminals while preserving JSON output for scripts.

## 0.7.0

### Minor Changes

- 147540b: Add `browse skills list` and `browse skills find` for Browse.sh catalog discovery.

### Patch Changes

- f156c32: Add human-readable table output for cloud session, project, and search lists while preserving JSON for scripts.

## 0.6.1

### Patch Changes

- cc5f649: Make browse driver sessions recover when no active page is selected and reuse matching daemon targets for broad local or remote mode flags.

## 0.6.0

### Minor Changes

- b3425a3: Add Browserbase cloud API commands under the new `browse cloud` oclif taxonomy.
- b3425a3: Port the browse driver command surface onto native oclif commands.
- b3425a3: Add the initial native browse driver daemon foundation with top-level open, status, and stop commands.
- b3425a3: Add native `browse functions` commands for initializing, developing, publishing, and invoking Browserbase Functions.
- b3425a3: Add `browse skills add` for site-specific skill installation.
- b3425a3: Add `browse skills install` for installing the bundled Browse CLI skill.
- b3425a3: Add Browserbase template listing, search, and clone commands.
- b3425a3: Add best-effort PostHog telemetry for oclif command lifecycle events.
- b3425a3: Introduce the minimal oclif-based `browse` CLI scaffold.
- b3425a3: Add a lightweight npm registry update notice for the browse CLI.

### Patch Changes

- b3425a3: Add alpha release automation for publishing browse canaries from the oclif and main trunks.
- b3425a3: Add a read-only `browse doctor` command for browser driver session diagnostics.
- b3425a3: Create a fresh browser page when `browse open` finds an initialized session with no pages.
- b3425a3: Generate and package the oclif manifest to reduce browse CLI startup latency.
- b3425a3: Harden local Functions dev CORS and owner-only driver runtime artifacts.
- b3425a3: Use --verified for Browserbase Verified sessions while accepting --advanced-stealth as a hidden compatibility alias.

## 0.5.7

### Patch Changes

- e0c7b2b: Improve CLI telemetry classification for browse wrapper failures and generic API HTTP errors.

## 0.5.6

### Patch Changes

- 038517f: Capture structured telemetry result codes and HTTP status details for CLI fetch and search failures.

## 0.5.5

### Patch Changes

- 644d4ce: Tag telemetry events with the detected agent harness (Claude Code, Codex, Cursor, etc.) so we can understand how the CLI is invoked across environments.

## 0.5.4

### Patch Changes

- 4b9e2aa: Add a Browserbase settings hint to missing API key errors so users know where to find their API key.
- 35cc5b0: Clarify browse and skills installation flows with explicit `--install` flags while keeping `--yes` as a compatibility alias.
- 440f753: Add CLI auto-update checks with npm registry lookup, a shared global `--yes` prompt context, and update/install prompt handling improvements for `browse` and `skills`.

## 0.5.3

### Patch Changes

- 5012468: Add privacy-safe lifecycle telemetry for command invocation and completion events.

## 0.5.2

### Patch Changes

- 22df06e: Fix `bb templates clone` to scaffold full `create-browser-app` boilerplate instead of cloning only the raw template files.

## 0.5.1

### Patch Changes

- 2f0ac7a: Add `bb templates` command for listing and cloning starter templates

## 0.5.0

### Minor Changes

- e63ad9f: Add first-class flags to `bb sessions create` for commonly used session parameters (--proxies, --advanced-stealth, --solve-captchas, --region, --keep-alive, --timeout, --block-ads, --context-id, --persist, --record-session, --log-session, --viewport, --extension-id). Flags merge with --body JSON when both are provided, with flags taking precedence.

## 0.4.0

### Minor Changes

- 69a88fe: Make CLI more agent-friendly: add `--yes`/`-y` flag to `browse` and `skills` to skip interactive prompts, add usage examples to `--help` for every subcommand, add `--stdin` flag for piped JSON input on `sessions create/update` and `contexts create`, and fix readline hanging in non-interactive environments.

## 0.3.2

### Patch Changes

- e8822fe: Improve README with comprehensive command reference, usage examples, and configuration docs

## 0.3.1

### Patch Changes

- 82ec911: Add ASCII art banner and hidden `bb b` easter egg command

## 0.3.0

### Minor Changes

- 497145b: Add `bb search` command for the Browserbase Search API

## 0.2.1

### Patch Changes

- 1728c46: Read CLI version from package.json instead of hardcoding it, so `bb -V` stays in sync with changesets

## 0.2.0

### Minor Changes

- 09f4bf6: Add `bb skills` command to install Browserbase agent skills via `npx skills add browserbase/skills`.

### Patch Changes

- cd489c9: Improve CLI subcommand descriptions for clarity.
- 5953230: Add release automation for publishing `@browserbasehq/cli` to npm.
