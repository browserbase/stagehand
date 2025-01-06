<div id="toc" align="center">
  <ul style="list-style: none">
    <a href="https://stagehand.dev">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://stagehand.dev/logo-dark.svg" />
        <img alt="Stagehand" src="https://stagehand.dev/logo-light.svg" />
      </picture>
    </a>
  </ul>
</div>

<p align="center">
  An AI web browsing framework focused on simplicity and extensibility.<br>
  <a href="https://docs.stagehand.dev">Read the Docs</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@browserbasehq/stagehand">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://stagehand.dev/api/assets/npm?mode=dark" />
      <img alt="NPM" src="https://stagehand.dev/api/assets/npm?mode=light" />
    </picture>
  </a>
  <a href="https://github.com/browserbase/stagehand/tree/main?tab=MIT-1-ov-file#MIT-1-ov-file">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://stagehand.dev/api/assets/license?mode=dark" />
      <img alt="MIT License" src="https://stagehand.dev/api/assets/license?mode=light" />
    </picture>
  </a>
  <a href="https://join.slack.com/t/stagehand-dev/shared_invite/zt-2tdncfgkk-fF8y5U0uJzR2y2_M9c9OJA">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://stagehand.dev/api/assets/slack?mode=dark" />
      <img alt="Slack Community" src="https://stagehand.dev/api/assets/slack?mode=light" />
    </picture>
  </a>
</p>

---

> [!NOTE] 
> `Stagehand` is currently available as an early release, and we're actively seeking feedback from the community. Please join our [Slack community](https://join.slack.com/t/stagehand-dev/shared_invite/zt-2tdncfgkk-fF8y5U0uJzR2y2_M9c9OJA) to stay updated on the latest developments and provide feedback.

Stagehand is the easiest way to build browser automations. It is completely interoperable with [Playwright](https://playwright.dev/) and has seamless integration with [Browserbase](https://browserbase.com/).

It offers three simple AI APIs (`act`, `extract`, and `observe`) on top of the base Playwright `Page` class that provide the building blocks for web automation via natural language.

Anything that can be done in a browser can be done with Stagehand. Think about stuff like:

1. Log into Amazon, search for AirPods, and buy the most relevant product
1. Go to Hacker News and extract the top stories of the day
1. Go to Doordash, find the cheapest pad thai, and order it to your house

These automations can be built with Playwright, but it can be very cumbersome to write the code, and it will be very vulnerable to minor changes in the UI.

Stagehand, especially when combined with Browserbase’s stealth mode, makes it easier to write durable code and bypass bot detection and captchas.

## Documentation

Visit [docs.stagehand.dev](https://docs.stagehand.dev) to view the full documentation.

## Getting Started

### Quickstart

You can run `npx create-browser-app` to create a new Stagehand project configured to our default settings.

Read our [Quickstart Guide](https://docs.stagehand.dev/get_started/quickstart) in the docs for more information.

### Build and Run from Source

```bash
git clone https://github.com/browserbase/stagehand.git
cd stagehand
npm install
npx playwright install
npm run example # run the blank script at ./examples/example.ts
```

### Environment Variables

Stagehand is best when you have an API key for an LLM provider and Browserbase credentials. To add these to your project, run:

```bash
cp .env.example .env
nano .env # Edit the .env file to add API keys
```

![](./docs/media/stagehand-playwright.png)

## Roadmap

At a high level, we're focused on improving reliability, speed, and cost in that order of priority.

## Contributing

> [!NOTE]  
> We highly value contributions to Stagehand! For support or code review, please join our [Slack community](https://join.slack.com/t/stagehand-dev/shared_invite/zt-2tdncfgkk-fF8y5U0uJzR2y2_M9c9OJA).

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

After that, you can run all evals at once using `npm run evals`

You can also run individual evals using `npm run evals -- your_eval_name`.

### Adding new evals

Running all evals can take some time. We have a convenience script `example.ts` where you can develop your new single eval before adding it to the set of all evals.

You can run `npm run example` to execute and iterate on the eval you are currently developing.

#### Adding a New Model

To add a new model to Stagehand, follow these steps:

1. **Define the Model**: Add the new model name to the `AvailableModel` type in the `LLMProvider.ts` file. This ensures that the model is recognized by the system.

2. **Map the Model to a Provider**: Update the `modelToProviderMap` in the `LLMProvider` class to associate the new model with its corresponding provider. This mapping is crucial for determining which client to use.

3. **Implement the Client**: If the new model requires a new client, implement a class that adheres to the `LLMClient` interface. This class should define all necessary methods, such as `createChatCompletion`.

4. **Update the `getClient` Method**: Modify the `getClient` method in the `LLMProvider` class to return an instance of the new client when the new model is requested.

### Building the SDK

Stagehand uses [tsup](https://github.com/egoist/tsup) to build the SDK and vanilla [esbuild](https://esbuild.github.io/d) to build the scripts that run in the DOM.

1. run `npm run build`
2. run `npm pack` to get a tarball for distribution

## Acknowledgements

This project heavily relies on [Playwright](https://playwright.dev/) as a resilient backbone to automate the web. It also would not be possible without the awesome techniques and discoveries made by [tarsier](https://github.com/reworkd/tarsier), and [fuji-web](https://github.com/normal-computing/fuji-web).

[Jeremy Press](https://x.com/jeremypress) wrote the original MVP of Stagehand and continues to be a major ally to the project.

## License

Licensed under the MIT License.

Copyright 2025 Browserbase, Inc.
