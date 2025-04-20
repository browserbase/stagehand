# Twitter自动化脚本

这个脚本使用Stagehand框架自动登录Twitter并浏览指定用户的推文。通过集成Google的Gemini模型，脚本能够智能地处理登录流程、导航和内容提取，即使在Twitter界面发生变化时也能适应。

> 注意：本脚本仅供学习和研究使用，请遵守Twitter的服务条款和使用政策。

## 功能

- 自动登录Twitter账号
- 导航到指定用户的Twitter页面
- 提取用户个人资料信息
- 提取用户最新推文
- 滚动加载更多推文
- 以友好的格式显示提取的信息

## 前提条件

1. 安装Node.js和npm
2. 克隆Stagehand仓库并安装依赖：
   ```bash
   git clone https://github.com/browserbase/stagehand.git
   cd stagehand
   npm install
   npx playwright install
   ```
3. 设置环境变量：

   ```bash
   cp .env.example .env
   ```

   然后编辑.env文件，添加以下配置：

   ```
   # Gemini模型配置
   GOOGLE_API_KEY="你的Google API密钥"
   GEMINI_MODEL="gemini-2.5-flash-preview-04-17"
   ```

   Twitter账号配置现在已移至`config/accounts.json`文件中。首先复制示例文件：

   ```bash
   cp examples/config/accounts.json.example config/accounts.json
   ```

   然后编辑`config/accounts.json`文件，按照以下格式配置您的账号信息：

   > 注意：`accounts.json`文件包含敏感信息，已添加到`.gitignore`中，不会被提交到Git仓库。

   ```json
   [
     {
       "username": "your_twitter_username1",
       "password": "your_password1",
       "email": "your_email1@example.com",
       "phone": "+1234567890",
       "twoFAEnabled": true,
       "twoFASecret": "YOUR_2FA_SECRET_KEY",
       "verificationEmail": "your_verification_email@example.com",
       "verificationPhone": "+1234567890",
       "proxy": {
         "server": "http://proxy1.example.com:8080",
         "username": "proxy_user1",
         "password": "proxy_pass1"
       }
     }
   ]
   ```

   可用的Gemini模型包括：

   - gemini-1.5-flash
   - gemini-1.5-pro
   - gemini-1.5-flash-8b
   - gemini-2.0-flash-lite
   - gemini-2.0-flash
   - gemini-2.5-flash-preview-04-17
   - gemini-2.5-pro-preview-03-25

## 使用方法

运行以下命令启动Twitter自动化脚本：

```bash
npm run twitter-auto -- --target=目标用户名
```

参数说明：

- `--target`: 你想要浏览的Twitter用户名（不包含@符号），默认为"elonmusk"

例如：

```bash
npm run twitter-auto -- --target=twitter
```

注意：登录凭证和2FA认证信息现在从.env文件中读取，而不是作为命令行参数传递，这提高了安全性。

## 注意事项

### 基本注意事项

1. 请确保你有权限访问指定的Twitter账号
2. 该脚本仅用于学习和研究目的，请遵守Twitter的使用条款
3. 默认情况下，浏览器会可见地运行。如果你想在后台运行，请修改脚本中的`headless`选项为`true`
4. 如果Twitter的登录流程发生变化，脚本可能需要更新

### 安全和隐私

1. **凭证安全**：请不要在代码中硬编码你的登录凭证。始终使用命令行参数或环境变量传递敏感信息。
2. **数据处理**：脚本提取的数据仅在本地处理和显示，不会上传到外部服务器（除了与Gemini API的交互）。
3. **限速控制**：脚本包含了适当的延迟，以避免过快的请求触发Twitter的限制措施。
4. **会话管理**：脚本在完成后会正确关闭浏览器会话，以避免泄漏会话数据。

### 模型使用注意事项

1. **API密钥安全**：请妥善保管你的Google API密钥，不要将其分享给他人。
2. **模型选择**：不同的Gemini模型有不同的性能和成本特点。请根据你的需求选择适合的模型。
3. **费用控制**：使用Gemini API可能会产生费用。请注意监控你的API使用情况，避免意外支出。

## 技术实现

脚本使用了以下技术和方法：

1. **Stagehand框架**：利用Stagehand提供的浏览器自动化功能
2. **Google的Gemini模型**：使用环境变量中指定的Gemini模型处理网页交互和内容提取
3. **页面操作方法**：
   - `page.act()`: 执行点击、输入等操作
   - `page.extract()`: 提取网页内容
   - `page.setSystemPrompt()`: 设置系统提示，指导模型如何处理交互

## 自定义和高级使用

### 基本自定义

你可以修改`examples/twitter_automation.ts`文件来自定义脚本的行为，例如：

- 更改提取的推文数量
- 添加更多的提取字段
- 实现其他Twitter功能，如点赞、转发等

### 高级使用场景

#### 0. 登录测试与Cookie管理

你可以使用专门的登录测试脚本来测试登录流程并管理Cookie：

```bash
npm run twitter-login-test
```

这个命令会运行`examples/twitter_login_test.ts`脚本，它会：

1. 尝试使用已保存的Cookie文件登录
2. 如果Cookie不存在或已失效，执行完整的登录流程
3. 登录成功后保存Cookie到项目根目录的`twitter-cookies.json`文件
4. 下次运行时优先使用保存的Cookie，节省登录时间

设置说明和环境变量配置请参考`examples/twitter_setup.md`文件。

#### 1. 定期监控特定用户的推文

你可以结合cron任务定期运行脚本，监控特定用户的推文更新：

```bash
# 每小时运行一次脚本，并将结果保存到日志文件
0 * * * * cd /path/to/stagehand && npm run twitter-auto -- --target=elonmusk > /path/to/logs/twitter_monitor_$(date +\%Y\%m\%d\%H\%M\%S).log 2>&1
```

#### 2. 数据分析集成

你可以修改脚本，将提取的推文数据保存为JSON格式，然后集成到数据分析流程中：

```typescript
// 在脚本结尾添加以下代码
import * as fs from "fs";

// 将提取的推文数据保存为JSON文件
const tweetData = {
  userInfo,
  tweets: tweets.tweets,
  moreTweets: moreTweets.tweets,
  timestamp: new Date().toISOString(),
};

fs.writeFileSync(
  `./data/${target}_tweets_${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  JSON.stringify(tweetData, null, 2),
);
```

#### 3. 多用户批量处理

你可以创建一个包含多个目标用户的文件，然后批量处理：

```typescript
// batch_twitter.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as dotenv from "dotenv";

// 加载环境变量
dotenv.config();

// 从文件中读取目标用户列表
const targets = fs
  .readFileSync("./targets.txt", "utf-8")
  .split("\n")
  .filter(Boolean);

// 检查环境变量是否已设置
if (!process.env.TWITTER_USERNAME || !process.env.TWITTER_PASSWORD) {
  console.error("请在.env文件中设置Twitter登录凭据。");
  process.exit(1);
}

// 逐个处理目标用户
for (const target of targets) {
  console.log(`处理用户: ${target}`);
  try {
    // 现在只需要传递目标用户参数，登录凭据从.env文件中读取
    execSync(`npm run twitter-auto -- --target=${target}`, {
      stdio: "inherit",
    });
    // 添加延迟，避免触发Twitter的限制
    console.log("等待 30 秒后处理下一个用户...");
    execSync("sleep 30");
  } catch (error) {
    console.error(`处理用户 ${target} 时出错:`, error);
  }
}
```

## 性能优化

要提高脚本的性能和可靠性，可以考虑以下优化措施：

1. **浏览器缓存**：启用浏览器缓存可以加快页面加载速度。在`localBrowserLaunchOptions`中添加适当的缓存配置。

2. **并发限制**：如果你批量处理多个用户，考虑使用并发限制来避免触发Twitter的限制。

3. **选择轻量级模型**：对于简单的任务，可以使用轻量级的Gemini模型（如`gemini-1.5-flash`）来提高响应速度并降低成本。

4. **选择性提取**：只提取你真正需要的数据，减少与Gemini API的交互量。

5. **错误重试机制**：添加错误重试机制，增强脚本的异常处理能力。

## 常见问题解答（FAQ）

### Q1: 脚本能否处理双因素认证（2FA）？

**A:** 是的，当前版本的脚本支持自动处理基于 TOTP 的双因素认证。你需要在 `config/accounts.json` 文件中为每个账号设置 `twoFAEnabled: true` 并提供 TOTP 密钥 `twoFASecret`。脚本会自动生成验证码并完成登录流程。如果你使用其他类型的 2FA（如短信验证），脚本会等待你手动完成验证。

### Q2: 脚本是否支持代理服务器？

**A:** 是的，脚本支持两种代理配置方式：

1. **全局代理配置**：在`localBrowserLaunchOptions`中配置代理服务器：

```typescript
localBrowserLaunchOptions: {
  headless: false,
  proxy: {
    server: 'http://myproxy.com:3128',
    username: 'proxy_user',  // 可选
    password: 'proxy_pass'   // 可选
  }
}
```

2. **按账号配置代理**：在`accounts.json`中为每个账号配置不同的代理IP（可选）：

```json
[
  {
    "username": "your_twitter_username1",
    "password": "your_password1",
    "proxy": {
      "server": "http://proxy1.example.com:8080",
      "username": "proxy_user1",
      "password": "proxy_pass1"
    }
  },
  {
    "username": "your_twitter_username2",
    "password": "your_password2"
    // 这个账号不使用代理，直接连接
  },
  {
    "username": "your_twitter_username3",
    "password": "your_password3",
    "proxy": {
      "server": "http://proxy3.example.com:8080"
      // 代理可以只配置server，不需要用户名和密码
    }
  }
]
```

这样每个账号在回复推文时会使用各自的代理IP（如果配置了），避免被平台限制。如果账号没有配置代理，则使用直接连接。


### Q3: 如何处理Twitter的验证码挑战？

**A:** 如果Twitter要求验证码，脚本可能无法自动处理。在这种情况下，建议将`headless`设置为`false`，手动完成验证码挑战，然后脚本将继续执行。

### Q4: 脚本是否支持多语言推文？

**A:** 是的，Gemini模型支持多种语言的内容处理。脚本可以提取各种语言的推文，并保持原始格式。

### Q5: 如何存储提取的推文内容？

**A:** 请参考“高级使用场景”部分的“数据分析集成”示例，它展示了如何将提取的推文保存为JSON文件。

## 故障排除

如果脚本运行失败，请尝试以下方法：

1. **登录凭据问题**：确保你的Twitter账号凭据正确。如果账号启用了双因素认证，可能需要手动干预。

2. **API密钥问题**：检查你的Google API密钥是否有效，并确保已启用了Gemini API访问权限。

3. **依赖包问题**：运行 `npm install` 更新所有依赖包，然后重新构建项目。

4. **界面变化**：如果Twitter的界面发生了变化，可能需要更新脚本中的选择器或指令。尝试使用更通用的指令。

5. **调试模式**：将`verbose`级别设置为2，启用详细的日志输出以帮助识别问题：

```typescript
verbose: 2, // 启用详细日志
```

6. **网络问题**：确保你的网络连接稳定，并且可以访问Twitter和Google API。如果需要，考虑使用VPN或代理服务器。
