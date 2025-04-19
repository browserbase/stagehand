# Twitter自动化脚本

这个脚本使用Stagehand框架自动登录Twitter并浏览指定用户的推文。

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
   然后编辑.env文件，添加你的Google API密钥和所需使用的Gemini模型：
   ```
   # Gemini模型配置
   GOOGLE_API_KEY="你的Google API密钥"
   GEMINI_MODEL="gemini-2.5-flash-preview-04-17"
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
npm run twitter-auto -- --username=你的Twitter用户名 --password=你的Twitter密码 --target=目标用户名
```

参数说明：
- `--username`: 你的Twitter登录用户名或邮箱
- `--password`: 你的Twitter登录密码
- `--target`: 你想要浏览的Twitter用户名（不包含@符号），默认为"elonmusk"

例如：
```bash
npm run twitter-auto -- --username=myemail@example.com --password=mypassword --target=twitter
```

## 注意事项

1. 请确保你有权限访问指定的Twitter账号
2. 该脚本仅用于学习和研究目的，请遵守Twitter的使用条款
3. 默认情况下，浏览器会可见地运行。如果你想在后台运行，请修改脚本中的`headless`选项为`true`
4. 如果Twitter的登录流程发生变化，脚本可能需要更新

## 技术实现

脚本使用了以下技术和方法：

1. **Stagehand框架**：利用Stagehand提供的浏览器自动化功能
2. **Google的Gemini模型**：使用环境变量中指定的Gemini模型处理网页交互和内容提取
3. **页面操作方法**：
   - `page.act()`: 执行点击、输入等操作
   - `page.extract()`: 提取网页内容
   - `page.setSystemPrompt()`: 设置系统提示，指导模型如何处理交互

## 自定义

你可以修改`examples/twitter_automation.ts`文件来自定义脚本的行为，例如：
- 更改提取的推文数量
- 添加更多的提取字段
- 实现其他Twitter功能，如点赞、转发等

## 故障排除

如果脚本运行失败，请尝试以下方法：
1. 确保你的Twitter账号凭据正确
2. 检查你的Google API密钥是否有效
3. 更新Stagehand和依赖包到最新版本
4. 如果Twitter的界面发生了变化，可能需要更新脚本中的选择器或指令
