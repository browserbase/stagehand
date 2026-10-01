# browse plugin

This directory holds the **browse** plugin and its per-marketplace metadata, so `browse` can be distributed through every major agent plugin marketplace. The plugin exposes the bundled `browse` skill (`../skills/browse/SKILL.md`); all browser and cloud actions run through the `browse` binary the skill calls.

> `browse` is a CLI-plus-skill plugin — it does **not** run an MCP server.

## Layout

The catalog mirrors the [Stripe link-cli](https://github.com/stripe/link-cli) plugin structure. Catalog manifests live at the package root; the plugin itself lives in `plugins/browse/`:

```
packages/cli/
├── .claude-plugin/marketplace.json     # Claude Code marketplace catalog → ./plugins/browse
├── .cursor-plugin/marketplace.json     # Cursor marketplace catalog
├── .codex-plugin/plugin.json           # Codex / OpenAI manifest (rich "interface" block)
├── .grok-plugin/plugin.json            # Grok (best-effort; no published spec yet)
├── .agents/plugins/marketplace.json    # Generic agents catalog ("policy" block)
├── assets/browse.svg                   # Shared icon
├── skills/browse/SKILL.md              # Shared skill (single source of truth)
└── plugins/browse/
    ├── .claude-plugin/plugin.json      # Per-marketplace plugin manifests
    ├── .codex-plugin/plugin.json
    ├── .cursor-plugin/plugin.json
    ├── .grok-plugin/plugin.json
    ├── skills  -> ../../skills         # symlink to the shared skill
    └── assets  -> ../../assets         # symlink to the shared assets
```

The skill and assets are **symlinked** into `plugins/browse/` so every marketplace ships the same files without duplication — the approach recommended by the [Claude Code plugin docs](https://code.claude.com/docs/en/plugins-reference#plugin-caching-and-file-resolution).

## Marketplaces

| Marketplace | Catalog manifest | Plugin manifest |
|-------------|------------------|-----------------|
| Claude Code | `.claude-plugin/marketplace.json` | `plugins/browse/.claude-plugin/plugin.json` |
| Cursor | `.cursor-plugin/marketplace.json` | `plugins/browse/.cursor-plugin/plugin.json` |
| Codex / OpenAI | `.codex-plugin/plugin.json` | `plugins/browse/.codex-plugin/plugin.json` |
| Generic agents | `.agents/plugins/marketplace.json` | — |
| Grok _(best-effort)_ | `.grok-plugin/plugin.json` | `plugins/browse/.grok-plugin/plugin.json` |

> **Grok:** xAI has no published plugin-marketplace spec yet. The `.grok-plugin` manifests mirror the Codex/OpenAI schema as a forward-compatible placeholder and carry a `_comment` saying so. Revisit when an official format ships.

## Install

**Claude Code** — add the catalog and install:

```bash
/plugin marketplace add ./path/to/packages/cli
/plugin install browse@browse-cli
```

**Any agent** — install the bundled skill directly (installs globally for every supported agent):

```bash
browse skills install
# or
npx skills add browse
```

## Versioning

All manifests and the skill are pinned to the `browse` CLI version in `packages/cli/package.json`. After a version bump, sync them:

```bash
pnpm --filter browse sync-plugin-version
```

This reads the version from `package.json` and updates `skills/browse/SKILL.md` plus each `plugins/browse/.*-plugin/plugin.json`.

## Validate

```bash
claude plugin validate .                 # marketplace manifest
claude plugin validate ./plugins/browse  # plugin manifest + skill frontmatter
```
