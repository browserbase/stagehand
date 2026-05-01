---
name: browser
description: Automate browser interactions using the Browserbase browse CLI. Use when a task requires navigating websites, reading page state, clicking elements, filling forms, or validating browser results with the browse command.
---

# Browser Automation

Automate browser interactions using the browse CLI with Claude.

## Setup

Do not install packages during evals. The eval harness provides `browse` on `PATH` and pins it to the active benchmark session.

## Environment Selection

The eval harness pins `browse` to one isolated session and preselects the intended environment.

- Local mode uses local Chrome.
- Remote mode uses Browserbase when credentials are configured.
- Do not switch environments unless the task or harness explicitly requires it.

## Page State

Prefer `browse snapshot` over screenshots. It returns a structured accessibility tree with element refs that can be used for interactions.

Only use screenshots when visual layout or image content is necessary.

Useful state checks:

```bash
browse status
browse get url
browse get title
browse snapshot
```

## Interaction Workflow

Typical flow:

1. Navigate to the starting URL with `browse open <url>`.
2. Run `browse snapshot` to inspect structure and element refs.
3. Interact with refs from the snapshot, selectors, or keyboard actions.
4. Run `browse snapshot` or another state check to verify the result.
5. Repeat until the benchmark instruction is complete.

Common interaction patterns:

```bash
browse click <ref>
browse type <text>
browse press <key>
browse fill <selector> <value>
browse wait timeout <ms>
```

## Best Practices

- Always navigate before interacting.
- Use refs from `browse snapshot` when possible.
- Verify each important action before moving on.
- Keep actions focused on the benchmark instruction.
- Do not edit repository files.
- Do not use browser/network tools outside the provided `browse` command.

## Completion

When finished, report the benchmark result in the exact `EVAL_RESULT` format requested by the harness prompt.
