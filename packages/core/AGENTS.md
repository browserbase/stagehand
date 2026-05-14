# Stagehand Package

This package ships version-matched documentation for coding agents.

Before changing code that uses Stagehand, inspect the relevant local docs:

```bash
rg "Stagehand" node_modules/@browserbasehq/stagehand/dist/docs
rg "stagehand\\.act|stagehand\\.extract|stagehand\\.observe|stagehand\\.agent" node_modules/@browserbasehq/stagehand/dist/docs
```

Start with `dist/docs/index.md`, then read the specific reference or guide for the API you are using.
