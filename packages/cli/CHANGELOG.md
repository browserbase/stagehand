# @browserbasehq/browse-cli

## 0.5.0

### Minor Changes

- [#1945](https://github.com/browserbase/stagehand/pull/1945) [`2df4b01`](https://github.com/browserbase/stagehand/commit/2df4b01cbbbb459d4495dfef0a5cc46993426278) Thanks [@shrey150](https://github.com/shrey150)! - Default `browse env local` back to an isolated browser, add `--auto-connect` as the opt-in path for attaching to an existing debuggable Chrome, and keep explicit CDP attach via `browse env local <port|url>`.

## 0.4.2

### Patch Changes

- [#1907](https://github.com/browserbase/stagehand/pull/1907) [`3917df4`](https://github.com/browserbase/stagehand/commit/3917df4851673792ecc2644e2a50dac8996bbeb0) Thanks [@derekmeegan](https://github.com/derekmeegan)! - Add `browse get markdown [selector]` command to convert page HTML to markdown. Defaults to body content, supports optional selector for specific elements. Uses node-html-markdown for high-quality conversion with links, tables, and code blocks preserved.

## 0.4.1

### Patch Changes

- [#1911](https://github.com/browserbase/stagehand/pull/1911) [`56d7b9f`](https://github.com/browserbase/stagehand/commit/56d7b9f5cc6a2d492f6d243818dc3024ef5f61d8) Thanks [@derekmeegan](https://github.com/derekmeegan)! - Fix invalid metadata key by using underscore instead of hyphen for browse_cli session metadata

## 0.4.0

### Minor Changes

- [#1889](https://github.com/browserbase/stagehand/pull/1889) [`e81dde7`](https://github.com/browserbase/stagehand/commit/e81dde715786d70e65524c8b7ce10e00a909efd9) Thanks [@shrey150](https://github.com/shrey150)! - Add --connect flag to attach to an existing Browserbase session by ID

- [#1886](https://github.com/browserbase/stagehand/pull/1886) [`bd2a9cf`](https://github.com/browserbase/stagehand/commit/bd2a9cfcad6e7afa3168ae926243313a81260769) Thanks [@shrey150](https://github.com/shrey150)! - browse env local now auto-discovers existing Chrome instances with remote debugging enabled, attaching to them instead of always launching an isolated browser. Falls back to isolated launch when no debuggable Chrome is found. Added --isolated flag, positional CDP target argument, and --ws now accepts bare port numbers.

### Patch Changes

- [#1890](https://github.com/browserbase/stagehand/pull/1890) [`6c89565`](https://github.com/browserbase/stagehand/commit/6c89565cd17511c5bf80850a12a84887d8440644) Thanks [@shrey150](https://github.com/shrey150)! - Add browse-cli metadata to Browserbase sessions created through the CLI

- [#1887](https://github.com/browserbase/stagehand/pull/1887) [`6e3c14b`](https://github.com/browserbase/stagehand/commit/6e3c14bd8c98751f3149ab07b440632a9ce7b4bd) Thanks [@shrey150](https://github.com/shrey150)! - fix: clear cached browser state when CDP connection dies, preventing "awaitActivePage: no page available" errors when daemon outlives its browser

## 0.3.0

This version was published to npm with a broken `workspace:*` dependency and is not installable. The pending browse-cli changesets remain in the repo so the next installable release can include those changes normally.

## 0.2.0

### Minor Changes

- [#1816](https://github.com/browserbase/stagehand/pull/1816) [`687d54a`](https://github.com/browserbase/stagehand/commit/687d54addad5625f28d51c6994170c7b629871f2) Thanks [@shrey150](https://github.com/shrey150)! - Add `--context-id` and `--persist` flags to `browse open` for loading and persisting Browserbase Contexts across sessions

- [#1793](https://github.com/browserbase/stagehand/pull/1793) [`e38c13b`](https://github.com/browserbase/stagehand/commit/e38c13b7526b140b693152ef1ffda88a74e9c425) Thanks [@shrey150](https://github.com/shrey150)! - Initial release of browse CLI - browser automation for AI agents

### Patch Changes

- [#1806](https://github.com/browserbase/stagehand/pull/1806) [`f8c7738`](https://github.com/browserbase/stagehand/commit/f8c773898f4d97e8854cc67a0b18eb7d1cdd7b75) Thanks [@shrey150](https://github.com/shrey150)! - Fix `browse env` showing stale mode after `browse env remote`

- Updated dependencies [[`505e8c6`](https://github.com/browserbase/stagehand/commit/505e8c6736f3706328dbc8df670c49a018058388), [`2f43ffa`](https://github.com/browserbase/stagehand/commit/2f43ffac11778152d17e4c44405770cc32c3ec8c), [`63ee247`](https://github.com/browserbase/stagehand/commit/63ee247ac6bf2992046d4f6b2759f46b15643e36), [`7dc35f5`](https://github.com/browserbase/stagehand/commit/7dc35f5e25689e6518d68b25ef71536d2781c8aa), [`335cf47`](https://github.com/browserbase/stagehand/commit/335cf4730e73bce33e92331d04bda4b0fd42685d), [`6ba0a1d`](https://github.com/browserbase/stagehand/commit/6ba0a1db7fc2d5d5a2f8927b1417d8f1d15eda10), [`4ff3bb8`](https://github.com/browserbase/stagehand/commit/4ff3bb831a6ef6e2d57148e7afb68ea8d23e395d), [`c27054b`](https://github.com/browserbase/stagehand/commit/c27054bbd0508431ade91d655f89efc87bbf5867), [`2abf5b9`](https://github.com/browserbase/stagehand/commit/2abf5b90f1e2bb1442509ef3a686b6128c9cdcf6), [`7817fcc`](https://github.com/browserbase/stagehand/commit/7817fcc315eee4455ce04567cf56c9ec801caf0b), [`7390508`](https://github.com/browserbase/stagehand/commit/73905088c5ed5923d276da9cce2efd0a0a3a46eb), [`611f43a`](https://github.com/browserbase/stagehand/commit/611f43ac8d4c580216d55d2b217c14a9a9c11013), [`521a10e`](https://github.com/browserbase/stagehand/commit/521a10e3698fc5631e219947bc90dad0f8bddaa8), [`2402a3c`](https://github.com/browserbase/stagehand/commit/2402a3c4d50270391b3e6440f4385cdcf5e1eb64)]:
  - @browserbasehq/stagehand@3.2.0
