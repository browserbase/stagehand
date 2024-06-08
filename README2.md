# Stagehand

Stagehand is a web automation SDK that leverages LLMs and browser techniques to achieve a low friction, cost effective, and resilient way to automate the browser.

## How to use Stagehand

Currently in order to run Stagehand you'll need to create a tarball via the build step. This will be provided by the Browserbase team, or can be generated following the steps below.

here's an example using npm to install a local tarball:

```bash
npm install {PATH_TO_PACKAGE}/{stagehand}-{VERSION}.tgz
```

next, you'll need a `.env` file with the following providers

```
OPENAI_API_KEY=""
BROWSERBASE_API_KEY=""
```

If you are developing stagehand, you'll also need a Braintrust key to run evals

```
BRAINTRUST_API_KEY=""%
```

install dependencies, and you're ready to go! Here's a full example of initializing and running an automation.

```typescript
import { Stagehand } from "../lib";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: true,
    debugDom: true,
  });
  await stagehand.init();
  await stagehand.page.goto("https://www.nytimes.com/games/wordle/index.html");
  await stagehand.act({ action: "start the game" });
  await stagehand.act({ action: "close tutorial popup" });
}
```

## Development

## How it works

## Credits
