# Temporal + Stagehand Integration

A best practices example showing how Temporal handles browser automation failures with automatic retries using atomic, idempotent activities.

## What it does

- Uses Stagehand to perform Google searches in a real browser
- Each individual task is encapsulated within a Temporal Activity following best practices for atomicity and idempotency
- If any individual task fails, Temporal will automatically retry it, resulting in reliable browser automation
- Clean, maintainable code following Temporal patterns

## Temporal Best Practices Demonstrated

### Atomic Activities

Each Temporal activity performs a single, well-defined task:

1. **initializeBrowser** - Creates and initializes browser session
2. **navigateToSearchPage** - Navigates to Google
3. **executeSearch** - Types query and submits search
4. **extractSearchResults** - Extracts and validates results
5. **cleanupBrowser** - Closes browser session
6. **formatResults** - Formats results for display

### Why Atomic Activities?

- **Efficient retries**: If extraction fails after search succeeds, only extraction is retried
- **Better performance**: No need to repeat successful steps
- **Clearer debugging**: Each activity's purpose is obvious
- **Flexible retry policies**: Different activities can have different retry strategies

### Idempotent Design

- Browser sessions are reused if already initialized
- Cleanup handles already-closed sessions gracefully
- Navigation always results in the same state
- Formatting produces consistent output

## Setup

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables in `.env`:

```
BROWSERBASE_API_KEY=your_api_key
BROWSERBASE_PROJECT_ID=your_project_id
OPENAI_API_KEY=your_openai_key # or ANTHROPIC_API_KEY depending on the model you choose
```

3. Start Temporal (if not already running):

```bash
temporal server start-dev
```

## Running the Example

1. Start the worker in one terminal:

```bash
npm run worker
```

2. Run a search in another terminal:

```bash
npm run demo                    # Default search
npm run demo "your search term" # Custom search
```

## How it Works

### Activities (`research-activities.ts`)

Each activity is designed to be:

- **Atomic**: Does one thing only
- **Idempotent**: Can be safely retried
- **Focused**: Clear single responsibility

### Workflow (`workflows.ts`)

- Orchestrates the atomic activities in sequence
- Uses tailored retry policies for each activity type
- Handles cleanup in a finally block
- Provides clear progress logging

### Worker (`research-worker.ts`)

- Processes workflow tasks
- Limits to 2 concurrent browser sessions
- Simple configuration focused on essentials

## Retry Behavior

Each activity has a custom retry policy based on its characteristics:

- **Initialize Browser**: 5 attempts, 2-10 second intervals
- **Navigate**: 8 attempts, 1-5 second intervals (fast retries)
- **Execute Search**: 10 attempts, 2-15 second intervals
- **Extract Results**: 10 attempts, 3-20 second intervals (most likely to fail)
- **Cleanup**: 3 attempts, 1-3 second intervals
- **Format**: 2 attempts, minimal retry (deterministic)

## Benefits

- **Simplicity**: Clean code without complex error handling
- **Efficiency**: Only failed steps are retried
- **Reliability**: Temporal ensures tasks complete or fail definitively
- **Visibility**: Monitor progress in Temporal Web UI at http://localhost:8233
- **Maintainability**: Each activity can be tested and updated independently
- **Flexibility**: Easy to add new steps or modify retry behavior
