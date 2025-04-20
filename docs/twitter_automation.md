# Twitter 自动化工具

这个项目使用 Stagehand 框架和 AI 模型来自动化 Twitter（现在称为 X）的浏览和监控功能。

## 功能

- **自动登录**：支持用户名/密码登录，包括双因素认证（2FA）
- **浏览用户推文**：访问指定用户的个人资料页面并提取推文
- **定时监控**：定期检查指定用户的最新推文，并保存新发现的内容
- **数据存储**：将提取的推文保存为 JSON 文件，便于后续分析

## 安装

1. 确保已安装项目依赖：

```bash
npm install
```

2. 创建 `.env` 文件，设置必要的环境变量：

```
# Twitter 登录凭据
TWITTER_USERNAME=你的用户名
TWITTER_PASSWORD=你的密码

# 双因素认证（如果启用）
TWITTER_2FA_ENABLED=true
TWITTER_2FA_SECRET=你的2FA密钥

# AI 模型配置
# 选项 1: 使用 OpenAI（推荐用于结构化数据提取）
OPENAI_API_KEY=你的OpenAI_API密钥
OPENAI_MODEL=gpt-4o

# 选项 2: 使用 Google Gemini
GOOGLE_API_KEY=你的Google_API密钥
GEMINI_MODEL=gemini-1.5-pro
```

## 使用方法

### 浏览用户推文

运行以下命令浏览指定用户的推文：

```bash
npm run twitter-auto -- --target=用户名
```

例如，浏览 Elon Musk 的推文：

```bash
npm run twitter-auto -- --target=elonmusk
```

### 监控用户推文

运行以下命令开始监控指定用户的推文：

```bash
npm run twitter-monitor -- --target=用户名 --interval=监控间隔(分钟)
```

例如，每 5 分钟监控一次 Elon Musk 的推文：

```bash
npm run twitter-monitor -- --target=elonmusk --interval=5
```

如果不指定间隔，默认为 1 分钟。

## 数据存储

监控功能会将提取的推文保存在 `data` 目录下：

- `data/用户名_tweets_时间戳.json`：每次发现新推文时创建的快照
- `data/用户名_latest_tweets.json`：最新一批发现的推文

## 模型推荐

根据不同的任务需求，我们推荐使用以下 AI 模型：

### 网页交互和导航
- **推荐模型**: OpenAI 的 `gpt-4o` 或 `gpt-4-turbo`
- **原因**: 这些模型在处理复杂网页交互和理解页面结构方面表现更好

### 内容提取和分析
- **推荐模型**: OpenAI 的 `gpt-4o` 或 Anthropic 的 `claude-3-opus`
- **原因**: 这些模型在结构化数据提取和遵循 schema 方面表现更好

### 替代选择
如果无法使用上述模型，可以考虑：
- **Google 的 `gemini-1.5-pro`**: 性能接近 GPT-4，但在某些结构化任务上可能需要更多调整
- **Anthropic 的 `claude-3-sonnet`**: 性价比较高，在大多数任务上表现良好

## 注意事项

1. **浏览器模式**：脚本默认使用有头浏览器模式，这样可以观察自动化过程并在需要时进行手动干预。如果需要在后台运行，可以修改代码中的 `headless` 参数为 `true`。

2. **登录问题**：如果自动登录失败，脚本会等待用户手动完成登录流程。

3. **会话持久化**：目前每次运行脚本都需要重新登录。未来版本将添加会话持久化功能。

4. **使用限制**：请遵守 Twitter 的使用条款和 API 限制，避免过于频繁的请求。

## 故障排除

1. **登录失败**：
   - 检查 `.env` 文件中的凭据是否正确
   - 如果使用 2FA，确保 2FA 密钥正确
   - 尝试增加超时时间或手动完成登录

2. **提取失败**：
   - 检查网络连接
   - 尝试使用不同的 AI 模型
   - 查看控制台输出的详细错误信息

3. **监控停止**：
   - 检查是否有网络中断
   - 查看是否达到 API 调用限制
   - 重新启动监控脚本

## 未来计划

- 会话持久化，避免频繁登录
- 多用户同时监控
- 关键词过滤功能
- 通知系统（发现新推文时）
- 数据可视化界面
