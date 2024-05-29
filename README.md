# stagehand

stagehand is a web automation SDK that leverages LLMs and industry to achieve a low friection, cost effective, and resilient way to automate the browser.
We are currently in the process of adding more acronyms and buzzwords

## Setup

The prototype version of the sdk relies on Browserbase, Open AI, and Playwright. Here's how to get started:

1. install dependencies

```sh
cd stagehand
npm install
```

2. setup environment variables by copy `.env.example` as `.env`, and adding Browserbase and Open AI keys
3. Run the example spec

```sh
npx playwright test
```

To run without Browserbase, set the `local` environment variable to 1

## How it works

Since this is a WIP, we'll go into details on how the SDK works.

1. Playwright
   This version of the SDK is written as a custom [playwright fixture](https://playwright.dev/docs/test-fixtures#creating-a-fixture). While this works great for people using Browserbase with Playwright, this should either become one of the options, or this logic should be written generically so that developers can use the SDK without writing Playwright code
2. LLM layer
   The SDK exposes two functions, observe and act, that interact with LLMs to abstract what is normally tedius automation code.

- observe: observe takes a screenshot of the current page, and asks a vision model to locate the element that the user is looking for based on their command. Then ask a text model for a Playwright locator given that description
- act: Given a playwright locator and a goal, ask a text model for the Playwright command and arguements to make it happen
  - This allows the SDK to work without unsafe evals, as we're running Playwright functionality directly

3. Caching
   Due to the cost of inference, it's infeasible to run the full versions of `observe` and `act` every time an automation runs. This is addressed with a simple JSON cache:

- Each instuction is hashed based on it's string descriptor, and the resulting LLM response is saved alongside the test that used it
- Before running inference, we check the cache to see if this step exists to use instead of calling out to the LLM
- If a test fails, we clear the cache with any instruction that matches that test key, and let Playwright's retry logic try things again with a fresh slate

## Future improvements

There are both basic SDK things, as well as more ambitious improvements to make to polish the SDK and make it production read

- Basic tasks

  - Cleanup logs and move some to debug mode, add a debug flag
  - Decide on whether to create clients for popular automation libraries (Selenium, Cypress, etc.) or make the API library agnostic
    - The SDK will still use Playwright under the hood to run observe and act functionality
  - Create a build step and make it publishable to NPM
  - Run the SDK in the Playground?

- Improvements
  - Build a caching layer on Browserbase to use instead of JSON files
    - JSON files are cumbersome in production for a few reasons
      - Environments might not have writeable file systems, or may clear on every run
      - Writing to a file can create concurrency issues based on the automation behavior
    - A caching layer on Browserbase will make things super seamless, and create a strong reason to use the platform if the SDK is compelling
  - Determine if vision is necessary for high accuracy
    - I annecdotally found that the vision step was really helpful in making the SDK accurate, but this assumption should be challenged
  - Improve the prompts
    - These prompts were built haphazardly, so there is probably a lot of room for improvement in accuracy and efficiency
    - One thing I noticed was that GPT4 is much better at writing Playwright locator syntax than something like vanilla query selectors. While query selectors have been around for longer, they rely on much more nuanced specificity at the token layer (for example, escaping each "[" with "\\"), while Playwright locators use a much more gentle syntax
      - Again, this is an observation that should be challenged
  - Improve chunking logic
    - To avoid overwhelming the LLM and cut down on costs, we naively chunk the DOM into 4 chunks to find the specific element to select. This can be improved by creating x chunks based on the overall size of the DOM, and adding overlap so that no key element is ever missed by the split
      - Another advantage of this improvement is that small DOMs don't need any chunking
  - Eval and testing
    - Evals are by far the best way to prevent regressions and build confidence around prompts.
    - One edge case that in particular that should be eval'ed is finding elements that are in different chunks in the DOM based on chunking logic
