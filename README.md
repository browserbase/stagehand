# Stagehand

Stagehand is an AI Web Browser SDK enabling you to interact with any web page using high-level instructions.

![](./images/wordle.png)

_In this example, Stagehand combines DOM preprocessing with chunking, Playwright, and LLMs to complete Wordle. Want to try yourself? Clone this repo and run `export OPENAI_API_KEY="YOUR_KEY" && pnpm install && pnpm example`_

## Getting started

### 0. Prerequisites

Stagehand is currently compatible with Node.js, Bun, and Deno.

Stagehand requires OpenAI or Anthropic as a model.

Ensure that an OpenAI API Key or Anthropic API key is accessible in your local environment. For example, with a `.env` file as follows:

```
OPENAI_API_KEY=""
```

<Note>

> [!NOTE]
> Get your OpenAI API Key from the [OpenAI Platform](https://platform.openai.com/api-keys).
> Get your Anthropic API Key from the [Anthropic Platform](https://console.anthropic.com/settings/keys).

<br />

### 1. Install the dependencies

Get started by installing the `@browserbasehq/stagehand` package:

```bash
npm install @browserbasehq/stagehand
```

<br />

### 2. Configure a Browser

Stagehand can be used with a local or remote Browser.

**Use a local browser (_recommended for development_)**

To use a local Browser, install Playwright on your local machine:

```bash
pnpm exec playwright install
```

and configure `Stagehand()` as follows:

```typescript
const stagehand = new Stagehand({
  env: "LOCAL",
});
```

> [!NOTE]
> You may need to follow additional Playwright instructions to install chromium if you have not done so previously.

<br />

**Use a remote browser (_recommended for deployment_)**

To use a remote Browser, create an account on Browserbase to get an API Key and update your `.env` file as follows:

```
BROWSERBASE_API_KEY=""
```

Then, configure a `Stagehand()` instance as follows:

```typescript
const stagehand = new Stagehand({
  env: "BROWSERBASE",
});
```

<br />

### 3. Run your first Stagehand script

You are now all set!
Start your first Stagehand script with the example featured below, attempting to solve the wordle of the day.

## Example

The code below uses Stagehand to complete the wordle of the day.

_You can run this example by forking and configuring the repository, and running `pnpm example`._

```typescript
import { Stagehand } from "../lib";
import { z } from "zod";

// 1. we init a Stagehand instance with a local Browser
const stagehand = new Stagehand({ env: "LOCAL" });

// 2. link the Browser instance with Stagehand
await stagehand.init();

// Access the current Playwright Page object with `stagehand.page`
//
// 3. we navigate to the Wordle game web page
await stagehand.page.goto("https://www.nytimes.com/games/wordle/index.html");

// The `observe()` method is supercharged `Page.locator()`, attempting
//  to locate an element using your instructions
//
// 4. Let's check if we can play
const playButton = await stagehand.observe("Find the play button");

if (!playButton) {
  console.log("Seems like you already played wordle today!");
  return;
}

// The `act()` method allows you to interact with the web page
//
// 5. we start the game
await stagehand.act({ action: "start the game" });
await stagehand.act({ action: "close tutorial popup" });

// 6. we loop over the 5 available guesses to complete the game
let guesses: { guess: string | null; description: string | null }[] = [];
for (let i = 0; i < 6; i++) {
  const prompt = `I'm trying to win Wordle. Here are my guesses so far.\nPREVIOUS GUESSES:\n${guesses.map((g, index) => `${index}. ${g.guess}. ${g.description}`).join("\n")}\nWhat five letter english word should I guess given the previous guesses? Do not repeat any previous guesses! Return only the new 5 letter word guess you're making.`;
  const response = await stagehand.ask(prompt);
  // Use the `ask()` method to directly prompt the model (OpenAI)
  const response = await stagehand.ask(prompt);
  if (!response) {
    throw new Error("no response when asking for a guess");
  }

  await stagehand.page.locator("body").pressSequentially(response);
  await stagehand.page.keyboard.press("Enter");

  // The `extract()` method allows to provide high level instructions
  //  to retrieve structured data (with a schema built with zod)
  const guess = await stagehand.extract({
    instruction: "extract the five letter guess at the bottom",
    schema: z.object({
      guess: z.string().describe("the raw guess").nullable(),
      description: z
        .string()
        .describe("what letters are correct and in the right place, and what letters are correct but in the wrong place, and what letters are incorrect")
        .nullable(),
    }),
  });
  guesses.push({ guess: guess.guess, description: guess.description });

  const correct = await stagehand.ask("Based on this description of the guess, is the guess correct? Every letter must be correct and in the right place. Start your response with word TRUE or FALSE.\nGuess description: " + guess.description);

  if (correct.trimStart().split(" ").pop() === "TRUE") {
    break;
  }
}
```

See the API Reference below for more detail on the `act()`, `observe()`, and `extract()` methods.

## API Reference

### `Stagehand()`

- `env`: `'LOCAL'` or '`BROWSERBASE'`.
- `verbose`: a `boolean` that enables more logging during automation
- `debugDom`: a `boolean` that draws bounding boxes around elements presented to the LLM during automation.

### Methods

#### `act()`

`act()` allows Stagehand to interact with a web page. Provide an `action` like `"search for 'x'"`, or `"select the cheapest flight presented"` (small atomic goals perform the best).

#### `extract()`

`extract()` grabs structured text from the current page using [zod](https://github.com/colinhacks/zod).
Given instructions and `schema`, you will receive structured data. Unlike some extraction libraries, stagehand can extract any information on a page, not just the main article contents.

#### `observe()`

`observe()` is helpful to assert a state about the current page without knowing exactly where it is or how to select it. All you need to provide is an `observation` like `"Find the calendar on the page"`, and the method will succeed with an element or throw an error if one cannot be found.

> [!CAUTION]
> observe currently does not support chunking, so at this time you can only observe the first section of the website. This should be fixed
> or the method should be removed if no longer useful

#### `ask()`

`ask()` is a generic LLM call in case you don't want to bring your own agent infrastructure. You can ask any question and provide context from previous abstractions or actions and get an LLM powered response.

For example:

```typescript
const prompt = `I'm trying to win wordle. what english word should I guess given the following state? Don't repeat guesses
          guesses: \n ${guesses.map((g, index) => `${index + 1}: ${g.guess} ${g.description}`).join("\n")}
        `;
const response = await stagehand.ask(prompt);
```

You can use `ask()` to build a simple Wordle bot without additional libraries or abstractions.

## How it works

The SDK has two major phases:

1. Processing the DOM (including chunking - _see below_).
2. Taking LLM powered actions based on the current state of the DOM.

### DOM processing

Stagehand uses a combination of techniques to prepare the DOM.
Stagehand only uses text input as of this version, but the release of `gpt-4o` incorporating vision is attractive.

The DOM Processing steps look as follows:

1. Via Playwright, inject a script into the DOM accessible by the SDK that can run processing.
2. Crawl the DOM and create a list of candidate elements.
   - Candidate elements are either leaf elements (DOM elements that contain actual user facing substance), or are interactive elements.
   - Interactive elements are determined by a combination of roles and HTML tags.
3. Candidate elements that are not active, visible, or at the top of the DOM are discarded.
   - The LLM should only receive elements it can faithfully act on on behalf of the agent/user.
4. For each candidate element, an xPath is generated. this guarentees that if this element is picked by the LLM, we'll be able to reliably target it.
5. Return both the list of candidate elements, as well as the map of elements to xPath selectors across the browser back to the SDK, to be analyzed by the LLM.

#### Chunking

While LLMs will continue to get bigger context windows and improve latency, giving any reasoning system less stuff to think about should make it more accurate. As a result, DOM processing is done in chunks in order to keep the context small per inference call. In order to chunk, the SDK considers a candidate element that starts in a section of the viewport to be a part of that chunk. In the future, padding will be added to ensure that an individual chunk does not lack relevant context. See this diagram for how it looks:

![](./images/chunks.png)

### LLM analysis

Now we have a list of candidate elements and a way to select them. We can present those elements with additional context to the LLM for extraction or action. While untested at on a large scale, presenting a "numbered list of elements" guides the model to not treat the context as a full DOM, but as a list of related but independent elements to operate on.

In the case of action, we ask the LLM to write a playwright method in order to do the correct thing. In our limited testing, playwright syntax is much more effective than relying on built in javascript APIs, possibly due to tokenization.

Lastly, we use the LLM to write future instructions to itself to help manage it's progress and goals when operating across chunks.

## Development

First, clone the repo

```bash
git clone git@github.com:browserbase/stagehand.git
```

Then install dependencies

```bash
pnpm install
```

add the .env file as documented above in the getting started section

### Run the example

`pnpm example`

### Run evals

You'll also need a Braintrust key to run evals

```.env
BRAINTRUST_API_KEY=""%
```

Then, run:

`pnpm evals`

### Develop new evals

Running all evals can take some time. We have a convenience script `playground.ts` where you can develop your new single eval before adding it to the set of all evals.

You can run:

`pnpm playground`

To execute and iterate on the eval you are currently developing.

### Development tips

A good development loop is:

1. try things in the example file
2. use that to make changes to the SDK
3. write evals that help validate your changes

### Building the SDK

Stagehand uses [tsup](https://github.com/egoist/tsup) to build the SDK and vanilla `esbuild` to build scripts that run in the DOM.

1. run `pnpm build`
2. run `npm pack` to get a tarball for distribution

## Credits

This project heavily relies on [Playwright](https://playwright.dev/) as a resilient backbone to automate the web. It also would not be possible without the awesome techniques and discoveries made by [tarsier](https://github.com/reworkd/tarsier), and [fuji-web](https://github.com/normal-computing/fuji-web).
