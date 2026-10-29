# stagehand-middleware

The facade's `run`, `snapshot` and `screenshot` tools for TypeScript, over an existing
Stagehand instance. Agent code runs Playwright-style against Stagehand's page, and the
tools, their descriptions and input schemas, and the agent instructions come from one
canonical contract.

The Python [`stagehand-middleware`](https://pypi.org/project/stagehand-middleware/)
package ships the same facade bundle at the same version.

## Install

```sh
npm install stagehand-middleware @browserbasehq/stagehand
```

## Usage

```ts
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import { FACADE_TOOLS, StagehandFacadeTools, facadeAgentInstructions } from "stagehand-middleware";

const browser = await localBrowser.launch();
const stagehand = await Stagehand.create({ browser });
const tools = new StagehandFacadeTools(stagehand, {
  artifactRoot: "artifacts", // where screenshots saved with a `path` are written
  quietWait: true, // opt in to quiet `page.waitForTimeout`
});

const title = await tools.run(`await page.goto("https://example.com"); return await page.title();`);
const tree = await tools.snapshot();
const shot = await tools.screenshot({ type: "png" });

// Register FACADE_TOOLS (names, descriptions, input schemas) with your agent framework
// and use facadeAgentInstructions(...) as its system prompt guidance.
await stagehand.close();
await browser.close();
```

Code passed to `run` is model-authored: it runs inside the Stagehand browser extension,
not in your process.
