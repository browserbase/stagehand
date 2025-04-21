# Stagehand Twitter 自动化工具

[English Documentation](./README.md)

这个项目使用 Stagehand 框架来自动化 Twitter/X 的登录和监控操作。Stagehand 是一个强大的自动化框架，它扩展了 Playwright，添加了 `act`、`extract` 和 `observe` 等功能，使得网页自动化变得更加简单。

## 功能特点

- **自动登录**: 支持用户名/密码登录，包括处理双因素认证(2FA)和账号验证
- **Cookie 管理**: 保存和重用Cookie以避免频繁登录
- **多账号轮询**: 自动在多个Twitter账号之间轮换进行监控操作
- **推文监控**: 定期检查指定用户的最新推文（每分钟一次）
- **自动回复**: 使用自定义内容自动回复推文
- **错误恢复**: 智能处理登录失败和网络问题

## 项目结构

```
examples/
  ├── twitter_simple_monitor.ts # 简易Twitter监控脚本
  └── twitter_utils.ts        # 共享工具函数
```

## 最近的代码重构

最近对代码进行了重构，主要改进包括：

1. **架构简化**: 移除了不必要的复杂性和数据库依赖
2. **多账号支持**: 增加了对多个Twitter账号的支持，实现自动轮换
3. **改进了多用户监控**: 增强了对多个Twitter用户的监控能力
4. **错误处理优化**: 改进了错误恢复策略，使操作更加稳健
5. **代码组织优化**: 更好的模块化设计，提高了清晰度和可维护性

## 使用方法

### 环境设置

创建一个 `.env` 文件，包含所需的环境变量：

```
# AI模型配置（用于数据提取）
GOOGLE_API_KEY=你的Google_API密钥
```

### 运行Twitter监控

**推荐方式：** 使用 npm 脚本。这能确保在运行前项目已正确构建：

```bash
npm run twitter-simple-monitor
```

**替代方式（需要先手动构建）：** 如果你倾向于直接使用 `tsx` 运行，请确保你已经先构建了项目 (`npm run build`):

```bash
npm run build
npx tsx examples/twitter_simple_monitor.ts
```

该脚本专注于核心功能：

- 多账号轮询监控
- 监控多个目标用户
- 检查最新推文并回复
- 固定1分钟间隔的监控周期

## 故障排除

### 代码样式问题

如果在运行脚本时遇到Prettier代码格式警告：

```
[warn] examples/twitter_simple_monitor.ts
[warn] examples/twitter_utils.ts
[warn] Code style issues found in 2 files. Run Prettier with --write to fix.
```

使用以下命令修复格式问题并运行脚本：

```bash
# 修复特定文件的格式问题并运行脚本
npx prettier --write examples/twitter_simple_monitor.ts examples/twitter_utils.ts && npm run twitter-simple-monitor

# 或修复项目中所有文件
npx prettier --write . && npm run twitter-simple-monitor
```

### 配置文件

监控脚本需要以下配置文件：

1. `examples/config/accounts.json` - Twitter账号凭据
2. `examples/config/targets.json` - 要监控的Twitter用户列表
3. `examples/config/replies.json` - 回复内容模板

配置示例：

#### targets.json

```json
[{ "username": "elonmusk" }, { "username": "ycombinator" }]
```

#### accounts.json

```json
[
  {
    "username": "你的Twitter用户名",
    "password": "你的密码",
    "twoFAEnabled": false,
    "twoFASecret": "",
    "cookiesPath": "./data/cookies_account1.json",
    "verificationEmail": "你的邮箱@example.com",
    "verificationPhone": "+1234567890"
  }
]
```

#### replies.json

```json
[{ "text": "精彩的推文！" }, { "text": "有趣的观点！" }]
```

## 注意事项

- 此脚本仅用于教育和学习目的
- 请遵守Twitter/X的使用条款和API规定
- 设置合理的监控间隔，避免过于频繁的请求
- 保持配置文件安全，因为它们包含敏感信息

## 为什么选择 Stagehand？

大多数现有的浏览器自动化工具要么需要您在 Selenium、Playwright 或 Puppeteer 等框架中编写底层代码，要么使用在生产环境中可能不可预测的高级代理。通过让开发人员选择在代码与自然语言之间编写内容，Stagehand 成为生产环境中浏览器自动化的自然选择。

1. **选择何时使用代码与自然语言**：在导航不熟悉的页面时使用 AI，在确切知道要做什么时使用代码（[Playwright](https://playwright.dev/)）。

2. **预览和缓存操作**：Stagehand 允许您在运行 AI 操作前预览它们，并且还可以轻松缓存可重复的操作以节省时间和令牌。

3. **一行代码集成计算机使用模型**：Stagehand 允许您通过一行代码将 OpenAI 和 Anthropic 的最先进计算机使用模型集成到浏览器中。

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
