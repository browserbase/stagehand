<p align="center">
  <a href="https://stagehand.dev">
    <img alt="Stagehand" src="./docs/media/stagehand-logo.png" width="308">
  </a>
</p>

<p align="center">
  <em>A lightweight framework for building AI-powered web agents.</em>
</p>

<p align="center">
  <a href="https://github.com/browserbase/stagehand/actions/workflows/ci.yml"><img alt="Build Status" src="https://github.com/browserbase/stagehand/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://www.npmjs.com/package/@browserbasehq/stagehand"><img alt="NPM" src="https://img.shields.io/npm/v/@browserbasehq/stagehand.svg" /></a>
  <a href="https://github.com/browserbase/stagehand/blob/main/license"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue" /></a>
  <a href="https://join.slack.com/t/stagehand-dev/shared_invite/zt-2tdncfgkk-fF8y5U0uJzR2y2_M9c9OJA"><img alt="Slack Community" src="https://img.shields.io/badge/slack-Join%20our%20community-FEC89A.svg?logo=slack" /></a>
</p>

# 🤘 Stagehand

- [Intro](#intro)
- [Getting Started](#getting-started)
- [API Reference](#api-reference)
  - [Stagehand()](#stagehand)
  - [act()](#act)
  - [extract()](#extract)
  - [observe()](#observe)
  - [page and context](#page-and-context)
  - [log()](#log)
- [How It Works](#how-it-works)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Intro

Stagehand is the AI-powered successor to [Playwright](https://github.com/microsoft/playwright), offering three simple APIs (`act`, `extract`, and `observe`) that provide the building blocks for natural language driven web automation.

The goal of Stagehand is to provide a lightweight, configurable framework, without overly complex abstractions, as well as modular support for different models and model providers. It's not going to order you a pizza, but it will help you reliably automate the web.

Each Stagehand function takes in an atomic instruction, such as `act("click the login button")` or `extract("find the red shoes")`, generates the appropriate Playwright code to accomplish that instruction, and executes it.

Instructions should be atomic to increase reliability, and step planning should be handled by the higher level agent. You can use `observe()` to get a suggested list of actions that can be taken on the current page, and then use those to ground your step planning prompts.

Stagehand is [open source](#license) and maintained by [Browserbase](https://browserbase.com) team. We believe that by enabling more developers to build reliable web automations, we'll expand the market of developers who benefit from our headless browser infrastructure. This is the framework that we wished we had while tinkering on our own applications, and we're excited to share it with you.

## Getting Started

### 1. Install the Stagehand package

```bash
npm install @browserbasehq/stagehand
```

### 2. Configure your model provider

You'll need to provide your API Key for the model provider you'd like to use. The default model provider is OpenAI, but you can also use Anthropic or others. More information on supported models can be found in the [API Reference](#api-reference).

Ensure that an OpenAI API Key or Anthropic API key is accessible in your local environment.

```
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-...
```

### 3. Create a Stagehand Instance

If you plan to run the browser locally, you'll also need to install Playwright's browser dependencies.

```bash
npm exec playwright install
```

Then you can create a Stagehand instance like so:

```javascript
import { Stagehand } from "@browserbasehq/stagehand";

const stagehand = new Stagehand({
  env: "LOCAL",
});
```

If you plan to run the browser remotely, you'll need to set a Browserbase API Key and Project ID.

```bash
export BROWSERBASE_API_KEY=...
export BROWSERBASE_PROJECT_ID=...
```

```javascript
import { Stagehand } from "@browserbasehq/stagehand";

const stagehand = new Stagehand({
  env: "BROWSERBASE",
});
```

### 4. Run your first automation

```javascript
await stagehand.init();
await stagehand.page.goto("https://github.com/browserbase/stagehand");
await stagehand.act({ action: "click on the contributors" });
const contributor = await stagehand.extract({
  instruction: "extract the top contributor",
  schema: z.object({
    username: z.string(),
    url: z.string(),
  }),
});
console.log(`Our favorite contributor is ${contributor.username}`);
```

This simple snippet will open a browser, navigate to the Stagehand repo, and log the top contributor.

## API Reference

### `Stagehand()`

This constructor is used to create an instance of Stagehand.

- **Arguments:**

  - `env`: `'LOCAL'` or `'BROWSERBASE'`.
  - `verbose`: an `integer` that enables several levels of logging during automation:
    - `0`: limited to no logging
    - `1`: SDK-level logging
    - `2`: LLM-client level logging (most granular)
  - `debugDom`: a `boolean` that draws bounding boxes around elements presented to the LLM during automation.

- **Returns:**

  - An instance of the `Stagehand` class configured with the specified options.

- **Example:**
  ```javascript
  const stagehand = new Stagehand();
  ```

### Methods

#### `init()`

`init()` asynchronously initializes the Stagehand instance. It should be called before any other methods.

- **Arguments:**

  - `modelName`: (optional) an `AvailableModel` string to specify the model to use. This will be used for all other methods unless overridden. Defaults to `"gpt-4o"`.

- **Returns:**

  - A `Promise` that resolves to an object containing:
    - `debugUrl`: a `string` representing the URL for live debugging. This is only available when using a Browserbase browser.
    - `sessionUrl`: a `string` representing the session URL. This is only available when using a Browserbase browser.

- **Example:**
  ```javascript
  await stagehand.init({ modelName: "gpt-4o" });
  ```

#### `act()`

`act()` allows Stagehand to interact with a web page. Provide an `action` like `"search for 'x'"`, or `"select the cheapest flight presented"` (small atomic goals perform the best).

- **Arguments:**

  - `action`: a `string` describing the action to perform, e.g., `"search for 'x'"`.
  - `modelName`: (optional) an `AvailableModel` string to specify the model to use.
  - `useVision`: (optional) a `boolean` or `"fallback"` to determine if vision-based processing should be used.

- **Returns:**

  - A `Promise` that resolves to an object containing:
    - `success`: a `boolean` indicating if the action was completed successfully.
    - `message`: a `string` providing details about the action's execution.
    - `action`: a `string` describing the action performed.

- **Example:**
  ```javascript
  await stagehand.act({ action: "click on add to cart" });
  ```

#### `extract()`

`extract()` grabs structured text from the current page using [zod](https://github.com/colinhacks/zod). Given instructions and `schema`, you will receive structured data. Unlike some extraction libraries, stagehand can extract any information on a page, not just the main article contents.

- **Arguments:**

  - `instruction`: a `string` providing instructions for extraction.
  - `schema`: a `z.AnyZodObject` defining the structure of the data to extract.
  - `modelName`: (optional) an `AvailableModel` string to specify the model to use.

- **Returns:**

  - A `Promise` that resolves to the structured data as defined by the provided `schema`.

- **Example:**
  ```javascript
  const price = await stagehand.extract({
    instruction: "extract the price of the item",
    schema: z.object({
      price: z.number(),
    }),
  });
  ```

#### `observe()`

`observe()` is used to get a list of actions that can be taken on the current page. It's useful for adding context to your planning step, or if you unsure of what page you're on.

If you are looking for a specific element, you can also pass in an instruction to observe via: `observe({ instruction: "{your instruction}"})`.

- **Arguments:**

  - `instruction`: a `string` providing instructions for the observation.

- **Returns:**

  - A `Promise` that resolves to an array of `string`s representing the actions that can be taken on the current page.

- **Example:**
  ```javascript
  const actions = await stagehand.observe();
  ```

#### `page` and `context`

`page` and `context` are instances of Playwright's `Page` and `BrowserContext` respectively. Use these methods to interact with the Playwright instance that Stagehand is using. Most commonly, you'll use `page.goto()` to navigate to a URL.

- **Example:**
  ```javascript
  await stagehand.page.goto("https://github.com/browserbase/stagehand");
  ```

### `log()`

`log()` is used to print a message to the browser console. These messages will be persisted in the Browserbase session logs, and can be used to debug sessions after they've completed.

Make sure the log level is above the verbose level you set when initializing the Stagehand instance.

- **Example:**
  ```javascript
  stagehand.log("Hello, world!");
  ```

### Model Support

Stagehand leverages a generic LLM client architecture to support various language models from different providers. This design allows for flexibility, enabling the integration of new models with minimal changes to the core system. Different models work better for different tasks, so you can choose the model that best suits your needs.

#### Currently Supported Models

Stagehand currently supports the following models from OpenAI and Anthropic:

- **OpenAI Models:**

  - `gpt-4o`
  - `gpt-4o-mini`
  - `o1-preview`
  - `o1-mini`
  - `gpt-4o-2024-08-06`

- **Anthropic Models:**
  - `claude-3-5-sonnet-latest`
  - `claude-3-5-sonnet-20240620`
  - `claude-3-5-sonnet-20241022`

These models can be specified when initializing the `Stagehand` instance or when calling methods like `act()` and `extract()`.

#### Adding a New Model

To add a new model to Stagehand, follow these steps:

1. **Define the Model**: Add the new model name to the `AvailableModel` type in the `LLMProvider.ts` file. This ensures that the model is recognized by the system.

2. **Map the Model to a Provider**: Update the `modelToProviderMap` in the `LLMProvider` class to associate the new model with its corresponding provider. This mapping is crucial for determining which client to use.

3. **Implement the Client**: If the new model requires a new client, implement a class that adheres to the `LLMClient` interface. This class should define all necessary methods, such as `createChatCompletion`.

4. **Update the `getClient` Method**: Modify the `getClient` method in the `LLMProvider` class to return an instance of the new client when the new model is requested.

## How It Works

The SDK has two major phases:

1. Processing the DOM (including chunking - _see below_).
2. Taking LLM powered actions based on the current state of the DOM.

### DOM processing

Stagehand uses a combination of techniques to prepare the DOM.
Stagehand only uses text input as of this version, but the release of `gpt-4o` incorporating vision is attractive.

\*_[update before release_]\*

The DOM Processing steps look as follows:

1. Via Playwright, inject a script into the DOM accessible by the SDK that can run processing.
2. Crawl the DOM and create a list of candidate elements.
   - Candidate elements are either leaf elements (DOM elements that contain actual user facing substance), or are interactive elements.
   - Interactive elements are determined by a combination of roles and HTML tags.
3. Candidate elements that are not active, visible, or at the top of the DOM are discarded.
   - The LLM should only receive elements it can faithfully act on on behalf of the agent/user.
4. For each candidate element, an xPath is generated. this guarantees that if this element is picked by the LLM, we'll be able to reliably target it.
5. Return both the list of candidate elements, as well as the map of elements to xPath selectors across the browser back to the SDK, to be analyzed by the LLM.

#### Chunking

While LLMs will continue to get bigger context windows and improve latency, giving any reasoning system less stuff to think about should make it more accurate. As a result, DOM processing is done in chunks in order to keep the context small per inference call. In order to chunk, the SDK considers a candidate element that starts in a section of the viewport to be a part of that chunk. In the future, padding will be added to ensure that an individual chunk does not lack relevant context. See this diagram for how it looks:

![](./docs/media/chunks.png)

### LLM analysis

Now we have a list of candidate elements and a way to select them. We can present those elements with additional context to the LLM for extraction or action. While untested at on a large scale, presenting a "numbered list of elements" guides the model to not treat the context as a full DOM, but as a list of related but independent elements to operate on.

In the case of action, we ask the LLM to write a playwright method in order to do the correct thing. In our limited testing, playwright syntax is much more effective than relying on built in javascript APIs, possibly due to tokenization.

Lastly, we use the LLM to write future instructions to itself to help manage it's progress and goals when operating across chunks.

## Roadmap

At a high level, we're focused on improving reliability, speed, and cost in that order of priority.

You can see the roadmap [here](./ROADMAP.md). Looking to contribute? Read on!

## Contributing

> [!NOTE]  
> We highly value contributions to Stagehand! For support or code review, please join our [Slack community](https://join.slack.com/t/stagehand-dev/shared_invite/zt-2tdncfgkk-fF8y5U0uJzR2y2_M9c9OJA).

First, clone the repo

```bash
git clone git@github.com:browserbase/stagehand.git
```

Then install dependencies

```bash
pnpm install
```

Ensure you have the `.env` file as documented above in the Getting Started section.

Then, run the example script `pnpm example`.

### Development tips

A good development loop is:

1. Try things in the example file
2. Use that to make changes to the SDK
3. Write evals that help validate your changes
4. Make sure you don't break existing evals!
5. Open a PR and get it reviewed by the team.

### Running evals

You'll need a Braintrust API key to run evals

```.env
BRAINTRUST_API_KEY=""
```

After that, you can run the eval using `pnpm evals`

### Adding new evals

Running all evals can take some time. We have a convenience script `example.ts` where you can develop your new single eval before adding it to the set of all evals.

You can run `pnpm example` to execute and iterate on the eval you are currently developing.

### Building the SDK

Stagehand uses [tsup](https://github.com/egoist/tsup) to build the SDK and vanilla `esbuild` to build scripts that run in the DOM.

1. run `pnpm build`
2. run `npm pack` to get a tarball for distribution

## Acknowledgements

This project heavily relies on [Playwright](https://playwright.dev/) as a resilient backbone to automate the web. It also would not be possible without the awesome techniques and discoveries made by [tarsier](https://github.com/reworkd/tarsier), and [fuji-web](https://github.com/fuji-web).

[Jeremy Press](https://x.com/jeremypress) wrote the original MVP of Stagehand and continues to be a major ally to the project.

## License

Licensed under the MIT License.

Copyright 2024 Browserbase, Inc.
