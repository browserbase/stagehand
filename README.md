# Stagehand Twitter Automation Tool

[中文文档](./README_CN.md)

This project uses the Stagehand framework to automate Twitter/X login and monitoring operations. Stagehand is a powerful automation framework that extends Playwright, adding features like `act`, `extract`, and `observe`, making web automation much simpler.

## Features

- **Automated Login**: Supports username/password login, including handling two-factor authentication (2FA) and account verification
- **Cookie Management**: Saves and reuses cookies to avoid frequent logins
- **Multi-Account Rotation**: Automatically rotates through multiple Twitter accounts for monitoring
- **Tweet Monitoring**: Regularly checks for new tweets from specified users (every minute)
- **Auto Reply**: Automatically replies to tweets with customizable content
- **Error Recovery**: Intelligent handling of login failures and network issues

## Project Structure

```
examples/
  ├── twitter_simple_monitor.ts # Simple Twitter monitoring script
  └── twitter_utils.ts        # Shared utility functions
```

## Recent Code Refactoring

The code has recently been refactored, with major improvements including:

1. **Simplified Architecture**: Removed unnecessary complexity and database dependencies
2. **Multi-Account Support**: Added support for multiple Twitter accounts with automatic rotation
3. **Improved Multi-User Monitoring**: Enhanced monitoring of multiple Twitter users
4. **Error Handling Optimization**: Improved error recovery strategies for more robust operation
5. **Code Organization Optimization**: Better modular design for clarity and maintainability

## Usage

### Environment Setup

Create a `.env` file containing the required environment variables:

```
# AI model configuration (for data extraction)
GOOGLE_API_KEY=your_google_api_key
```

### Run Twitter Monitoring

**Recommended:** Use the npm script. This ensures the project is built correctly before running:

```bash
npm run twitter-simple-monitor
```

**Alternative (requires manual build first):** If you prefer to run directly with `tsx`, make sure you've built the project first (`npm run build`):

```bash
npm run build
npx tsx examples/twitter_simple_monitor.ts
```

This script focuses on core functionality:
- Multi-account rotation for monitoring
- Monitoring multiple target users
- Checking latest tweets and replying
- Fixed 1-minute interval between cycles

## Troubleshooting

### Code Style Issues

If you encounter Prettier code style warnings when running the script:

```
[warn] examples/twitter_simple_monitor.ts
[warn] examples/twitter_utils.ts
[warn] Code style issues found in 2 files. Run Prettier with --write to fix.
```

Fix the formatting issues and run the script in one command:

```bash
# Fix formatting issues and run the script
npx prettier --write examples/twitter_simple_monitor.ts examples/twitter_utils.ts && npm run twitter-simple-monitor

# Or fix all files in the project
npx prettier --write . && npm run twitter-simple-monitor
```

### Configuration Files

The monitoring script requires the following configuration files:

1. `examples/config/accounts.json` - Twitter account credentials
2. `examples/config/targets.json` - List of Twitter users to monitor
3. `examples/config/replies.json` - Reply content templates

Example configurations:

#### targets.json
```json
[
  { "username": "elonmusk" },
  { "username": "ycombinator" }
]
```

#### accounts.json
```json
[
  {
    "username": "your_twitter_username",
    "password": "your_password",
    "twoFAEnabled": false,
    "twoFASecret": "",
    "cookiesPath": "./data/cookies_account1.json",
    "verificationEmail": "your_email@example.com",
    "verificationPhone": "+1234567890"
  }
]
```

#### replies.json
```json
[
  { "text": "Great tweet!" },
  { "text": "Interesting point!" }
]
```

## Notes

- This script is for educational and learning purposes only
- Please comply with Twitter/X's terms of use and API regulations
- Set reasonable monitoring intervals to avoid too frequent requests
- Keep your configuration files secure as they contain sensitive information

## Why Stagehand?

Most existing browser automation tools either require you to write low-level code in a framework like Selenium, Playwright, or Puppeteer, or use high-level agents that can be unpredictable in production. By letting developers choose what to write in code vs. natural language, Stagehand is the natural choice for browser automations in production.

1. **Choose when to write code vs. natural language**: use AI when you want to navigate unfamiliar pages, and use code ([Playwright](https://playwright.dev/)) when you know exactly what you want to do.

2. **Preview and cache actions**: Stagehand lets you preview AI actions before running them, and also helps you easily cache repeatable actions to save time and tokens.

3. **Computer use models with one line of code**: Stagehand lets you integrate SOTA computer use models from OpenAI and Anthropic into the browser with one line of code.

## Example

Here's how to build a sample browser automation with Stagehand:

<div align="center">
  <div style="max-width:300px;">
    <img src="/media/github_demo.gif" alt="See Stagehand in Action">
  </div>
</div>

```typescript
// Use Playwright functions on the page object
const page = stagehand.page;
await page.goto("https://github.com/browserbase");

// Use act() to execute individual actions
await page.act("click on the stagehand repo");

// Use Computer Use agents for larger actions
const agent = stagehand.agent({
    provider: "openai",
    model: "computer-use-preview",
});
await agent.execute("Get to the latest PR");

// Use extract() to read data from the page
const { author, title } = await page.extract({
  instruction: "extract the author and title of the PR",
  schema: z.object({
    author: z.string().describe("The username of the PR author"),
    title: z.string().describe("The title of the PR"),
  }),
});
```

## Documentation

Visit [docs.stagehand.dev](https://docs.stagehand.dev) to view the full documentation.

## Getting Started

Start with Stagehand with one line of code, or check out our [Quickstart Guide](https://docs.stagehand.dev/get_started/quickstart) for more information:

```bash
npx create-browser-app
```

<div align="center">
    <a href="https://www.loom.com/share/f5107f86d8c94fa0a8b4b1e89740f7a7">
      <p>Watch Anirudh demo create-browser-app to create a Stagehand project!</p>
    </a>
    <a href="https://www.loom.com/share/f5107f86d8c94fa0a8b4b1e89740f7a7">
      <img style="max-width:300px;" src="https://cdn.loom.com/sessions/thumbnails/f5107f86d8c94fa0a8b4b1e89740f7a7-ec3f428b6775ceeb-full-play.gif">
    </a>
  </div>

### Build and Run from Source

```bash
git clone https://github.com/browserbase/stagehand.git
cd stagehand
npm install
npx playwright install
npm run build
npm run example # run the blank script at ./examples/example.ts
```

Stagehand is best when you have an API key for an LLM provider and Browserbase credentials. To add these to your project, run:

```bash
cp .env.example .env
nano .env # Edit the .env file to add API keys
```

## Contributing

> [!NOTE]
> We highly value contributions to Stagehand! For questions or support, please join our [Slack community](https://stagehand.dev/slack).

At a high level, we're focused on improving reliability, speed, and cost in that order of priority. If you're interested in contributing, we strongly recommend reaching out to [Anirudh Kamath](https://x.com/kamathematic) or [Paul Klein](https://x.com/pk_iv) in our [Slack community](https://stagehand.dev/slack) before starting to ensure that your contribution aligns with our goals.

For more information, please see our [Contributing Guide](https://docs.stagehand.dev/contributions/contributing).

## Acknowledgements

This project heavily relies on [Playwright](https://playwright.dev/) as a resilient backbone to automate the web. It also would not be possible without the awesome techniques and discoveries made by [tarsier](https://github.com/reworkd/tarsier), [gemini-zod](https://github.com/jbeoris/gemini-zod), and [fuji-web](https://github.com/normal-computing/fuji-web).

We'd like to thank the following people for their major contributions to Stagehand:
- [Paul Klein](https://github.com/pkiv)
- [Anirudh Kamath](https://github.com/kamath)
- [Sean McGuire](https://github.com/seanmcguire12)
- [Miguel Gonzalez](https://github.com/miguelg719)
- [Sameel Arif](https://github.com/sameelarif)
- [Filip Michalsky](https://github.com/filip-michalsky)
- [Jeremy Press](https://x.com/jeremypress)
- [Navid Pour](https://github.com/navidpour)

## License

Licensed under the MIT License.

Copyright 2025 Browserbase, Inc.
