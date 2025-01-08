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

Stagehand is the easiest way to build browser automations. It is fully compatible with [Playwright](https://playwright.dev/), offering three simple AI APIs (`act`, `extract`, and `observe`) on top of the base Playwright `Page` class that provide the building blocks for web automation via natural language. It also makes Playwright more accessible to non-technical users and less vulnerable to minor changes in the UI/DOM.

Anything that can be done in a browser can be done with Stagehand. Consider:

1. Go to Hacker News and extract the top stories of the day
1. Log into Amazon, search for AirPods, and buy the most relevant product
1. Go to ESPN, search for Steph Curry, and get stats for his last 10 games

Stagehand makes it easier to write durable, performant browser automation code. When used with [Browserbase](https://browserbase.com/), it offers unparalleled debugging tools like session replay and step-by-step debugging.

> [!NOTE] 
> `Stagehand` is currently available as an early release, and we're actively seeking feedback from the community. Please join our [Slack community](https://join.slack.com/t/stagehand-dev/shared_invite/zt-2tdncfgkk-fF8y5U0uJzR2y2_M9c9OJA) to stay updated on the latest developments and provide feedback.

## Documentation

Visit [docs.stagehand.dev](https://docs.stagehand.dev) to view the full documentation.

## Getting Started

### Quickstart

To create a new Stagehand project configured to our default settings, run:

```bash
npx create-browser-app --example quickstart
```

Read our [Quickstart Guide](https://docs.stagehand.dev/get_started/quickstart) in the docs for more information.

You can also add Stagehand to an existing Typescript project by running:

```bash
npm install @browserbasehq/stagehand zod
npx playwright install # if running locally
```

### Build and Run from Source

```bash
git clone https://github.com/browserbase/stagehand.git
cd stagehand
npm install
npx playwright install
npm run example # run the blank script at ./examples/example.ts
```

Stagehand is best when you have an API key for an LLM provider and Browserbase credentials. To add these to your project, run:

```bash
cp .env.example .env
nano .env # Edit the .env file to add API keys
```

## Contributing

> [!NOTE]  
> We highly value contributions to Stagehand! For questions or support, please join our [Slack community](https://join.slack.com/t/stagehand-dev/shared_invite/zt-2tdncfgkk-fF8y5U0uJzR2y2_M9c9OJA).

At a high level, we're focused on improving reliability, speed, and cost in that order of priority. If you're interested in contributing, we strongly recommend reaching out to [Anirudh Kamath](https://x.com/kamathematic) or [Paul Klein](https://x.com/pk_iv) in our [Slack community](https://join.slack.com/t/stagehand-dev/shared_invite/zt-2tdncfgkk-fF8y5U0uJzR2y2_M9c9OJA) before starting to ensure that your contribution aligns with our goals.

For more information, please see our [Contributing Guide](https://docs.stagehand.dev/contributions/contributing).

## Acknowledgements

This project heavily relies on [Playwright](https://playwright.dev/) as a resilient backbone to automate the web. It also would not be possible without the awesome techniques and discoveries made by [tarsier](https://github.com/reworkd/tarsier), and [fuji-web](https://github.com/normal-computing/fuji-web).

We'd like to thank the following people for their contributions to Stagehand:
- [Jeremy Press](https://x.com/jeremypress) wrote the original MVP of Stagehand and continues to be an ally to the project.
- [Navid Pour](https://github.com/navidpour) is heavily responsible for the current architecture of Stagehand and the `act` API.
- [Sean McGuire](https://github.com/seanmcguire12) is a major contributor to the project and has been a great help with improving the `extract` API and getting evals to a high level.
- [Filip Michalsky](https://github.com/filip-michalsky) has been doing a lot of work on building out integrations like [Langchain](https://js.langchain.com/docs/integrations/tools/stagehand/) and [Claude MCP](https://github.com/browserbase/mcp-server-browserbase), generally improving the repository, and unblocking users.
- [Sameel Arif](https://github.com/sameelarif) is a major contributor to the project, especially around improving the developer experience.

## License

Licensed under the MIT License.

Copyright 2025 Browserbase, Inc.