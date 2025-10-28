# Stagehand Evals CLI

A powerful command-line interface for running Stagehand evaluation suites and benchmarks.

## Installation

```bash
# From the stagehand root directory
pnpm install
pnpm run build:cli
```

## Usage

The evals CLI provides a clean, intuitive interface for running evaluations:

```bash
pnpm evals <command> <target> [options]
```

## Commands

### `run` - Execute evaluations

Run custom evals or external benchmarks.

```bash
# Run all custom evals
pnpm evals run all

# Run specific category
pnpm evals run act
pnpm evals run extract
pnpm evals run observe

# Run specific eval by name
pnpm evals run extract/extract_text

# Run external benchmarks
pnpm evals run benchmark:gaia
```

### `list` - View available evals

List all available evaluations and benchmarks.

```bash
# List all categories and benchmarks
pnpm evals list

# Show detailed task list
pnpm evals list --detailed
```

### `config` - Manage defaults

Configure default settings for all eval runs.

```bash
# View current configuration
pnpm evals config

# Set default values
pnpm evals config set env browserbase
pnpm evals config set trials 5
pnpm evals config set concurrency 10

# Reset to defaults
pnpm evals config reset
pnpm evals config reset trials  # Reset specific key
```

### `help` - Show help

```bash
pnpm evals help
```

## Options

### Core Options

- `-e, --env` - Environment: `local` or `browserbase` (default: local)
- `-t, --trials` - Number of trials per eval (default: 3)
- `-c, --concurrency` - Max parallel sessions (default: 3)
- `-m, --model` - Model override (e.g., gpt-4o, claude-3.5)
- `-p, --provider` - Provider override (openai, anthropic, etc.)
- `--api` - Use Stagehand API instead of SDK

### Benchmark-Specific Options

- `-l, --limit` - Max tasks to run (default: 25)
- `-s, --sample` - Random sample before limit
- `-f, --filter` - Benchmark-specific filters (key=value)

## Examples

### Running Custom Evals

```bash
# Run with custom settings
pnpm evals run act -e browserbase -t 5 -c 10

# Run with specific model
pnpm evals run observe -m gpt-4o -p openai

# Run using API
pnpm evals run extract --api
```

### Running Benchmarks

```bash
# WebBench with filters
pnpm evals run b:webbench -l 10 -f difficulty=easy -f category=READ

# GAIA with sampling
pnpm evals run b:gaia -s 100 -l 25 -f level=1

# WebVoyager with limit
pnpm evals run b:webvoyager -l 50
```

## Available Benchmarks

### OnlineMind2Web (`b:onlineMind2Web`)

Real-world web interaction tasks for evaluating web agents.

### GAIA (`b:gaia`)

General AI Assistant benchmark for complex reasoning.

**Filters:**

- `level`: 1, 2, 3 (difficulty levels)

### WebVoyager (`b:webvoyager`)

Web navigation and task completion benchmark.

### WebBench (`b:webbench`)

Real-world web automation tasks across live websites.

**Filters:**

- `difficulty`: easy, hard
- `category`: READ, CREATE, UPDATE, DELETE, FILE_MANIPULATION
- `use_hitl`: true/false

### OSWorld (`b:osworld`)

Chrome browser automation tasks from the OSWorld benchmark.

**Filters:**

- `source`: Mind2Web, test_task_1, etc.
- `evaluation_type`: url_match, string_match, dom_state, custom

## Configuration

The CLI uses a configuration file at `evals/evals.config.json` which contains:

- **defaults**: Default values for CLI options
- **benchmarks**: Metadata for external benchmarks
- **tasks**: Registry of all evaluation tasks

You can modify defaults either through the `config` command or by editing the file directly.

## Environment Variables

While the CLI reduces the need for environment variables, some are still supported for CI/CD:

- `EVAL_ENV` - Override environment setting
- `EVAL_TRIAL_COUNT` - Override trial count
- `EVAL_MAX_CONCURRENCY` - Override concurrency
- `EVAL_PROVIDER` - Override LLM provider
- `USE_API` - Use Stagehand API

## Development

### Adding New Evals

1. Create your eval file in `evals/tasks/<category>/`
2. Add it to `evals.config.json` under the `tasks` array
3. Run with: `pnpm evals run <category>/<eval_name>`

## Troubleshooting

### Command not found

If `evals` command is not found, make sure you've:

1. Run `pnpm install` from the project root
2. Run `pnpm run build:cli` to compile the CLI

### Build errors

If you encounter build errors:

```bash
# Clean and rebuild
rm -rf dist/evals
pnpm run build:cli
```

### Permission errors

If you get permission errors:

```bash
chmod +x dist/evals/cli.js
```

## Contributing

When adding new features to the CLI:

1. Update the command in `evals/cli.ts`
2. Add new options to the help text
3. Update this README with examples
4. Test with various flag combinations
