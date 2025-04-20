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
  The production-ready framework for AI browser automations.<br>
  <a href="https://docs.stagehand.dev">Read the Docs</a>
</p>

<p align="center">
  <a href="https://github.com/browserbase/stagehand/tree/main?tab=MIT-1-ov-file#MIT-1-ov-file">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://stagehand.dev/api/assets/license?mode=dark" />
      <img alt="MIT License" src="https://stagehand.dev/api/assets/license?mode=light" />
    </picture>
  </a>
  <a href="https://stagehand.dev/slack">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://stagehand.dev/api/assets/slack?mode=dark" />
      <img alt="Slack Community" src="https://stagehand.dev/api/assets/slack?mode=light" />
    </picture>
  </a>
</p>

<p align="center">
	<a href="https://trendshift.io/repositories/12122" target="_blank"><img src="https://trendshift.io/api/badge/repositories/12122" alt="browserbase%2Fstagehand | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

# Stagehand Twitter 自动化工具

这个项目使用 Stagehand 框架来自动化 Twitter/X 的登录和监控操作。Stagehand 是一个强大的自动化框架，它扩展了 Playwright，添加了 `act`、`extract` 和 `observe` 等功能，使得网页自动化变得更加简单。

## 功能特点

- **自动登录**: 支持用户名/密码登录，包括处理双因素认证(2FA)和账号验证
- **Cookie 管理**: 保存和重用 Cookie 以避免频繁登录
- **推文监控**: 定期检查指定用户的新推文
- **数据提取**: 结构化提取推文内容、时间戳和互动数据
- **错误恢复**: 对登录失败和网络问题的智能处理

## 项目结构

```
examples/
  ├── twitter_login_test.ts   # Twitter登录测试脚本
  ├── twitter_monitor.ts      # Twitter推文监控脚本
  ├── twitter_setup.md        # 环境变量配置说明
  └── twitter_utils.ts        # 共享工具函数
```

## 最近的代码重构

最近对代码进行了重构，主要改进包括：

1. **代码重复消除**: 将重复的功能（如登录、验证处理）提取到 `twitter_utils.ts` 中
2. **类型安全改进**: 添加明确的类型注解，修复类型错误
3. **错误处理优化**: 改进了错误恢复策略，使脚本在遇到问题时更加健壮
4. **代码组织优化**: 更好的模块化设计，使功能更加清晰和可维护

## 使用方法

### 环境设置

创建一个 `.env` 文件，包含所需的环境变量（详见 `examples/twitter_setup.md`）:

```
# Twitter登录凭据
TWITTER_USERNAME=你的Twitter用户名
TWITTER_PASSWORD=你的Twitter密码

# 双因素认证设置（如果启用了2FA）
TWITTER_2FA_ENABLED=true或false
TWITTER_2FA_SECRET=你的2FA密钥

# 验证信息
TWITTER_VERIFICATION_EMAIL=你的邮箱
TWITTER_VERIFICATION_PHONE=你的手机号

# AI模型配置（用于数据提取）
GOOGLE_API_KEY=你的Google_API密钥
GEMINI_MODEL=gemini-1.5-pro
```

### 运行登录测试

```bash
npx tsx examples/twitter_login_test.ts
```

### 运行推文监控

```bash
npx tsx examples/twitter_monitor.ts --target=elonmusk --interval=5
```

参数说明:
- `--target`: 要监控的Twitter用户名（默认: elonmusk）
- `--interval`: 检查新推文的时间间隔，单位为分钟（默认: 1）

## 注意事项

- 此脚本仅用于教育和学习目的
- 请遵守Twitter/X的使用条款和API规定
- 设置合理的监控间隔，避免过于频繁的请求
- `.env` 文件中包含敏感信息，确保不要将其提交到版本控制系统中

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
