# Changesets

Add a changeset when a pull request changes a published SDK:

```sh
just changeset
```

Select only one or both of these packages:

- `@browserbasehq/stagehand` for the TypeScript SDK
- `@browserbasehq/stagehand-python` for the Python SDK

The Python package is private to npm because it is a version proxy for the public `stagehand`
distribution on PyPI. `just version` applies pending changesets, writes both SDKs' release notes
to the root `CHANGELOG.md`, synchronizes the Python version into `pyproject.toml`, and refreshes
`uv.lock`.

Do not create changesets for the private docs, protocol, or server packages.
