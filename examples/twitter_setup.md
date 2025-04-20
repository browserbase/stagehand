# Twitter自动化登录测试设置指南

本文档将指导您如何设置和运行Twitter自动化登录测试。

## 环境变量设置

在项目根目录创建一个`.env`文件，包含以下内容：

```
# Twitter登录凭据
TWITTER_USERNAME=你的Twitter用户名
TWITTER_PASSWORD=你的Twitter密码

# 双因素认证设置（如果启用了2FA）
TWITTER_2FA_ENABLED=false
TWITTER_2FA_SECRET=你的2FA密钥

# 验证信息（可能在登录过程中需要用于验证身份）
TWITTER_VERIFICATION_EMAIL=你的邮箱
TWITTER_VERIFICATION_PHONE=你的手机号

# AI模型配置
# Google Gemini模型（用于提取、结构化数据）
GOOGLE_API_KEY=你的Google_API密钥
GEMINI_MODEL=gemini-1.5-pro
```

## 配置说明

1. **基本凭据**：

   - `TWITTER_USERNAME`: 您的Twitter/X账号用户名
   - `TWITTER_PASSWORD`: 您的Twitter/X账号密码

2. **双因素认证（如果启用）**：

   - `TWITTER_2FA_ENABLED`: 设为`true`如果您的账号开启了双因素认证
   - `TWITTER_2FA_SECRET`: 您的2FA密钥（通常是设置2FA时生成的密钥）

3. **账号验证**：

   - `TWITTER_VERIFICATION_EMAIL`: 与您的Twitter账号关联的邮箱
   - `TWITTER_VERIFICATION_PHONE`: 与您的Twitter账号关联的手机号（格式：+国家代码xxx...）

4. **AI配置**：
   - `GOOGLE_API_KEY`: 您的Google API密钥，用于Gemini模型
   - `GEMINI_MODEL`: 使用的Gemini模型版本

## 运行测试

设置完环境变量后，您可以通过以下命令运行Twitter登录测试：

```bash
npm run twitter-login-test
```

或者直接使用：

```bash
npx tsx examples/twitter_login_test.ts
```

## Cookie保存位置

成功登录后，脚本会在项目根目录生成一个`twitter-cookies.json`文件。下次运行时，如果这个文件存在，脚本会尝试使用Cookie直接登录，跳过账号密码输入。

## 注意事项

1. **安全性**：`.env`文件包含敏感信息，确保不要将其提交到版本控制系统中。
2. **Cookie有效期**：Twitter的Cookie通常有一定的有效期，如果Cookie过期，脚本会自动回退到完整的登录流程。
3. **手动干预**：如果自动登录过程中出现问题，脚本会提示您手动干预，完成剩余的登录步骤。
4. **多种验证**：脚本支持处理邮箱验证、手机号验证和2FA验证。根据您的账号安全设置，可能需要配置不同的环境变量。
