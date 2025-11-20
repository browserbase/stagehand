# Stagehand Python SDK (stubs)
## Quick start

```bash
cd packages/python-sdk
uv sync           # create the virtual environment and install tooling
uv run python examples/basic.py
```

## Project structure

```
packages/python-sdk/
├── stagehand/           # public package that mirrors the TS SDK surface
│   ├── __init__.py
│   └── client.py
├── examples/
│   └── basic.py
├── pyproject.toml
├── uv.lock
└── package.json         # hooks into the turborepo workspace scripts
```