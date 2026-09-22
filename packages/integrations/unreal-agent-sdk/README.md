# Unreal Agent eval integration

This package adapts the upstream Unreal Agent Go runner to Stagehand evals. The
supported tool is `stagehand_facade`. Unreal Agent does not expose an MCP client,
so its Bash tool calls a temporary local command client for the facade's `run`,
`snapshot`, and `screenshot` operations. The client forwards each call to the
eval runner's existing browser session.

## Build the runner

Build upstream commit `b7c9bf1c5c2fa4127255c07727a7c8413e23944a` with Go 1.27
or newer. Run these commands from the Stagehand repository root. `vendor-repos/`
is ignored, so each checkout needs its own build.

```bash
git clone https://github.com/unreallabsai/unreal-agent.git vendor-repos/unreal-agent
git -C vendor-repos/unreal-agent checkout b7c9bf1c5c2fa4127255c07727a7c8413e23944a
(cd vendor-repos/unreal-agent && go build -o unreal-agent-runner ./cmd/unreal-agent-runner)
export EVAL_UNREAL_AGENT_PATH="$PWD/vendor-repos/unreal-agent/unreal-agent-runner"
```

`EVAL_UNREAL_AGENT_PATH` can point to a runner built elsewhere. Without it, the
adapter looks for `unreal-agent-runner` on `PATH`.

## Run an eval

Use the `openai-codex` provider to authenticate with an existing Codex login:

```bash
pnpm --dir packages/evals eval run b:webvoyager --harness unreal_agent --tool stagehand_facade --env local --model openai-codex/gpt-6-luna --limit 1 --preview
pnpm --dir packages/evals eval run b:webvoyager --harness unreal_agent --tool stagehand_facade --env local --model openai-codex/gpt-6-luna --limit 1 --trials 1 --concurrency 1
```

For the OpenAI API provider, set `OPENAI_API_KEY` and use
`--model openai/gpt-6-luna`. The adapter also accepts `openrouter/<model>`,
`fireworks/<model>`, and `ollama/<model>` with their upstream provider setup.

The browser trajectory and final answer are saved even when the eval verifier
cannot authenticate. A graded result requires credentials for the configured
verifier model; otherwise the run is marked ungraded.
