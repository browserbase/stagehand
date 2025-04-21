# Twitter监控与自动回复系统开发指南

## 功能概述

本系统基于Stagehand框架开发，主要功能包括：

1. 自动监控多个Twitter用户的最新推文
2. 使用多个Twitter账号自动回复新推文
3. 支持文本、图片和视频回复
4. 防止重复回复同一推文
5. 定时执行监控任务，可自定义检查间隔
6. 自动处理Twitter登录，包括两因素验证(2FA)
7. 数据持久化存储，包括已回复记录和监控日志

## 系统架构

系统主要由以下几个模块组成：

1. **配置管理**：加载并管理目标用户、账号和回复内容的配置
2. **登录处理**：处理Twitter账号登录，包含cookie管理和两因素验证
3. **推文监控**：定时检查目标用户的最新推文
4. **推文回复**：使用配置的账号回复新发现的推文
5. **数据存储**：使用SQLite数据库存储已回复记录和监控日志

## 开发环境准备

### 安装依赖

```bash
npm install
```

### 环境变量配置

创建`.env`文件并配置以下环境变量：

```
# Twitter账号信息（默认账号，也可通过config/accounts.json配置多账号）
TWITTER_USERNAME=your_username
TWITTER_PASSWORD=your_password
TWITTER_EMAIL=your_email
TWITTER_PHONE=your_phone_number

# 两因素认证(2FA)配置
TWITTER_2FA_ENABLED=true/false
TWITTER_2FA_SECRET=your_2fa_secret

# 验证信息
TWITTER_VERIFICATION_EMAIL=your_verification_email
TWITTER_VERIFICATION_PHONE=your_verification_phone

# AI模型配置（用于数据提取）
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_API_KEY=your_google_api_key
```

## 配置文件说明

系统使用三个主要配置文件，位于`config/`目录下：

### 1. targets.json - 监控目标配置

```json
[
  {
    "username": "target_username",
    "checkInterval": 5 // 检查间隔（分钟）
  }
]
```

### 2. accounts.json - 回复账号配置

```json
[
  {
    "username": "your_username",
    "password": "your_password",
    "email": "your_email",
    "phone": "your_phone",
    "twoFAEnabled": true,
    "twoFASecret": "your_2fa_secret",
    "verificationEmail": "your_verification_email",
    "verificationPhone": "your_verification_phone"
  }
]
```

### 3. replies.json - 回复内容配置

```json
[
  {
    "text": "回复文本内容",
    "image": "图片路径（可选）",
    "video": "视频路径（可选）",
    "accountUsername": "指定使用的账号（可选）"
  }
]
```

## 主要功能开发指南

### 1. 监控多用户

`monitorMultipleUsers`函数是系统的主入口，负责初始化系统、加载配置、创建定时任务等：

```typescript
async function monitorMultipleUsers() {
  // 初始化数据库
  const db = initDatabase();

  // 加载配置
  const targets = loadTargets();
  const accounts = loadAccounts();
  const replyContents = loadReplyContent();

  // 为每个目标创建定时任务
  targets.forEach((target, index) => {
    setTimeout(() => checkTargetTweets(target), index * 10000);
  });
}
```

### 2. 检查用户推文

`checkUserTweets`函数负责检查特定用户的新推文并尝试回复：

```typescript
async function checkUserTweets(db, target, accounts, replyContents) {
  // 初始化Stagehand
  const stagehand = new Stagehand({...});
  await stagehand.init();

  // 提取最新推文
  const extractedData = await page.extract({
    instruction: `提取用户 @${target.username} 的最新推文`,
    schema: z.object({...})
  });

  // 处理新推文
  const newTweets = extractedData.tweets
    .filter(...)
    .filter(tweet => !hasReplied(db, tweet.id));

  // 回复新推文
  for (const tweet of newTweets) {
    const availableAccount = getAvailableAccount(accounts);
    const replyContent = replyContents[Math.floor(Math.random() * replyContents.length)];

    await replyToTweet(db, tweet, availableAccount, replyContent);
  }
}
```

### 3. 回复推文

`replyToTweet`函数负责使用指定账号回复特定推文：

```typescript
async function replyToTweet(db, tweet, account, replyContent) {
  // 更新账号状态
  updateAccountStatus(account, true);

  // 初始化Stagehand
  const stagehand = new Stagehand({...});
  await stagehand.init();

  // 尝试使用cookie登录
  let loginSuccess = await tryLoginWithCookies(stagehand.page, account);

  // 如cookie失效，尝试完整登录
  if (!loginSuccess) {
    loginSuccess = await fullLoginProcess(stagehand.page, account);
  }

  // 导航到推文页面并回复
  await stagehand.page.goto(tweet.url);
  await stagehand.page.act("点击回复框");
  await stagehand.page.act(`输入回复内容: ${replyContent.text}`);

  // 上传媒体（如果有）
  if (replyContent.image) {
    await uploadMedia(stagehand.page, replyContent.image);
  }

  // 发布回复
  await stagehand.page.act("点击发布按钮");

  // 记录回复
  markReplied(db, {...});

  // 关闭浏览器
  await stagehand.close();

  // 更新账号状态
  updateAccountStatus(account, false, true);

  return true;
}
```

## 系统扩展建议

1. **回复策略优化**：

   - 实现智能回复选择，根据推文内容选择合适的回复
   - 加入回复频率控制，避免过度回复被平台限制

2. **错误处理优化**：

   - 增加重试机制，处理临时性网络问题
   - 添加账号轮换策略，当某账号频繁失败时自动切换

3. **数据分析功能**：

   - 添加回复效果统计分析
   - 实现监控数据可视化展示

4. **系统监控**：
   - 添加邮件或其他通知方式，在系统异常时通知
   - 实现远程控制接口，方便调整运行参数

## 运行系统

```bash
# 运行多用户监控系统
npm run twitter:multi-monitor

# 仅测试登录功能
npm run twitter:login-test
```

## 注意事项

1. 所有敏感信息（如账号密码、API密钥等）建议通过环境变量或加密配置文件管理
2. 合理设置检查间隔，避免被Twitter限制访问
3. 定期检查并更新cookie文件，提高登录成功率
4. 遵循Twitter平台规则，避免过度频繁的自动化操作
5. 定期备份数据库，避免数据丢失
