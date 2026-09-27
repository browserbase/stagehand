# Stagehand v4 demo kit

Location in the Stagehand repository: `packages/examples/v4-demo-kit`.

This kit gives the sales team five small ways to show Stagehand v4. Each demo uses the public
`@browserbasehq/stagehand` 4.0.2 package.

## Choose the demo

| Customer situation                                                                 | Demo                             | Value to show                                                                                                                                          |
| ---------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The customer asks how an agent selects browser tools during a task.                | `npm run demo:agent -- "<task>"` | A real agent loop receives three Stagehand tools and chooses the next tool from the task and page state.                                               |
| The customer has an agent or agent harness.                                        | `npm run demo:tools`             | The agent gets one persistent browser and three small tools: `run`, `snapshot`, and `screenshot`. The `run` tool accepts Playwright-shaped JavaScript. |
| The customer writes workflows but wants fewer brittle selectors.                   | `npm run demo:hybrid`            | One script can use exact browser commands and self-healing `act`, `observe`, and `extract` calls.                                                      |
| The customer wants the agent to write a full program, review it, and run it again. | `npm run demo:script`            | A task is a normal module with one exported `run` function. The same file can run in development, CI, or a server.                                     |
| The customer wants a stable automation behind an API.                              | `npm run serve`                  | A registered script runs behind a bearer-protected HTTP endpoint. Each request gets a new browser session.                                             |

## Set up

Use Node.js 22.18 or later.

```bash
cd packages/examples/v4-demo-kit
npm install
cp .env.example .env
```

Load the values from `.env` in your shell. Do not commit `.env`.

If `BROWSERBASE_API_KEY` is set, the demos use Browserbase. Browserbase Model Gateway supplies the
model for `act`, `observe`, and `extract`. If the key is not set, the demos use local Chrome. For AI
calls with local Chrome, also set `STAGEHAND_MODEL_NAME` and `STAGEHAND_MODEL_API_KEY`.

Run `npm run demo` to see the menu.

## Demo 1: a real agent harness

Set `OPENAI_API_KEY`, then run a task:

```bash
npm run demo:agent -- "Open Hacker News and return the first three newest story titles"
```

The terminal prints each decision. The model can choose `snapshot`, `run`, or `screenshot`. Tool
results return to the model, and the model chooses the next step. All calls share one browser.

Try different safe tasks during a customer call:

```bash
npm run demo:agent -- "Open example.com, explain what the page is for, and give me its link"
npm run demo:agent -- "Open stagehand.dev and find the names of the main product sections"
```

The agent model is `gpt-5.4-mini` by default. Set `AGENT_MODEL` to change it. The agent key stays in
the host process. Generated browser code runs through the Stagehand batch runtime in the browser.

## Demo 2: tools on demand

```bash
npm run demo:tools
```

This demo prints the tool contract. It then uses one `run` call to navigate, read a title, and read a
heading. It reads a snapshot and clicks its `Learn more` ID with an action call. It uses the same
browser for the screenshot call.

The reusable adapter is `src/tools.mjs`. Import `createDemoTools()` into an agent harness and map its
three definitions to the harness tool format. Generated code is trusted code in this demo. Run it in
an approved sandbox before you accept code from an untrusted user.

## Demo 3: mixed control

```bash
npm run demo:hybrid
```

The script uses an exact `goto`, asks `observe` to find a control, passes the returned action to
`act`, and uses `extract` for a typed result. This is useful when the customer wants exact control
for stable steps and AI help for page parts that change.

## Demo 4: a reusable generated program

```bash
npm run demo:script
```

The sample script is `scripts/research-hacker-news.mjs`. To add a task, copy that file and export:

```js
export const needsModel = true;

export async function run({ browser, context, page, stagehand }) {
  // Put the complete browser task here.
  return { result: "structured output" };
}
```

Run it with:

```bash
npm run run:script -- scripts/my-task.mjs
```

This is the best demo when the customer wants a coding agent to create a complete program, review
the file, change it, and run the same file again.

## Demo 5: protected HTTP execution

Set `DEMO_BEARER_TOKEN`, then start the server:

```bash
npm run serve
```

Call the registered script:

```bash
curl -X POST http://127.0.0.1:8787/run \
  -H "Authorization: Bearer $DEMO_BEARER_TOKEN"
```

The server binds to `127.0.0.1`. Do not expose it to the public internet without normal production
authentication, quotas, time limits, output limits, audit data, and an approved code sandbox.

## A simple talk track

1. "Stagehand is the hands. Your agent stays the brain."
2. "Use tools when the agent must decide the next browser step during the run."
3. "Use a complete script when you want a file that people can review, test, change, and deploy."
4. "Mix exact page commands with AI methods. You do not need to choose only one control style."
5. "Use a protected endpoint or Browser Function when the workflow becomes stable."

## Team sharing

Share this directory in the team repository. Each teammate runs `npm install` and uses their own
Browserbase key. Never put keys in source files, task text, screenshots, or shared archives.

Before a customer demo, run:

```bash
npm run check
npm run demo:tools
```

The AI demos depend on a live model and a live website. Run them once before the call.
