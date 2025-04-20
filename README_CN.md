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
  用于AI浏览器自动化的生产级框架<br>
  <a href="https://docs.stagehand.dev">阅读文档</a>
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

[English Documentation](./README.md)

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

## 为什么选择 Stagehand？

大多数现有的浏览器自动化工具要么需要您在 Selenium、Playwright 或 Puppeteer 等框架中编写底层代码，要么使用在生产环境中可能不可预测的高级代理。通过让开发人员选择在代码与自然语言之间编写内容，Stagehand 成为生产环境中浏览器自动化的自然选择。

1. **选择何时使用代码与自然语言**：在导航不熟悉的页面时使用 AI，在确切知道要做什么时使用代码（[Playwright](https://playwright.dev/)）。

2. **预览和缓存操作**：Stagehand 允许您在运行 AI 操作前预览它们，并且还可以轻松缓存可重复的操作以节省时间和令牌。

3. **一行代码集成计算机使用模型**：Stagehand 允许您通过一行代码将 OpenAI 和 Anthropic 的最先进计算机使用模型集成到浏览器中。

## 示例

以下是如何使用 Stagehand 构建示例浏览器自动化：

<div align="center">
  <div style="max-width:300px;">
    <img src="/media/github_demo.gif" alt="查看 Stagehand 实际操作">
  </div>
</div>

```typescript
// 在 page 对象上使用 Playwright 函数
const page = stagehand.page;
await page.goto("https://github.com/browserbase");

// 使用 act() 执行单个操作
await page.act("点击 stagehand 仓库");

// 使用计算机使用代理进行更大的操作
const agent = stagehand.agent({
    provider: "openai",
    model: "computer-use-preview",
});
await agent.execute("前往最新的 PR");

// 使用 extract() 从页面读取数据
const { author, title } = await page.extract({
  instruction: "提取 PR 的作者和标题",
  schema: z.object({
    author: z.string().describe("PR 作者的用户名"),
    title: z.string().describe("PR 的标题"),
  }),
});
```

## 文档

访问 [docs.stagehand.dev](https://docs.stagehand.dev) 查看完整文档。

## 入门

通过一行代码开始使用 Stagehand，或查看我们的[快速入门指南](https://docs.stagehand.dev/get_started/quickstart)获取更多信息：

```bash
npx create-browser-app
```

<div align="center">
    <a href="https://www.loom.com/share/f5107f86d8c94fa0a8b4b1e89740f7a7">
      <p>观看 Anirudh 演示如何使用 create-browser-app 创建 Stagehand 项目！</p>
    </a>
    <a href="https://www.loom.com/share/f5107f86d8c94fa0a8b4b1e89740f7a7">
      <img style="max-width:300px;" src="https://cdn.loom.com/sessions/thumbnails/f5107f86d8c94fa0a8b4b1e89740f7a7-ec3f428b6775ceeb-full-play.gif">
    </a>
  </div>

### 从源代码构建和运行

```bash
git clone https://github.com/browserbase/stagehand.git
cd stagehand
npm install
npx playwright install
npm run build
npm run example # 运行 ./examples/example.ts 中的空白脚本
```

当您拥有 LLM 提供商的 API 密钥和 Browserbase 凭据时，Stagehand 效果最佳。要将这些添加到您的项目中，请运行：

```bash
cp .env.example .env
nano .env # 编辑 .env 文件以添加 API 密钥
```

## 贡献

> [!NOTE]  
> 我们非常重视对 Stagehand 的贡献！如有问题或需要支持，请加入我们的 [Slack 社区](https://stagehand.dev/slack)。

在高层次上，我们专注于按照可靠性、速度和成本的优先顺序进行改进。如果您有兴趣贡献，我们强烈建议您在开始之前联系我们 [Slack 社区](https://stagehand.dev/slack) 中的 [Anirudh Kamath](https://x.com/kamathematic) 或 [Paul Klein](https://x.com/pk_iv)，以确保您的贡献与我们的目标一致。

有关更多信息，请参阅我们的[贡献指南](https://docs.stagehand.dev/contributions/contributing)。

## 致谢

本项目严重依赖 [Playwright](https://playwright.dev/) 作为自动化网页的弹性骨干。如果没有 [tarsier](https://github.com/reworkd/tarsier)、[gemini-zod](https://github.com/jbeoris/gemini-zod) 和 [fuji-web](https://github.com/normal-computing/fuji-web) 所做的出色技术和发现，这也是不可能的。

我们要感谢以下人员对 Stagehand 的重大贡献：
- [Paul Klein](https://github.com/pkiv)
- [Anirudh Kamath](https://github.com/kamath)
- [Sean McGuire](https://github.com/seanmcguire12)
- [Miguel Gonzalez](https://github.com/miguelg719)
- [Sameel Arif](https://github.com/sameelarif)
- [Filip Michalsky](https://github.com/filip-michalsky)
- [Jeremy Press](https://x.com/jeremypress)
- [Navid Pour](https://github.com/navidpour)

## 许可证

根据 MIT 许可证授权。

版权所有 2025 Browserbase, Inc.
