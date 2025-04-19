/**
 * Twitter自动化脚本 - 自动登录Twitter并浏览用户推文
 *
 * 使用方法:
 * 1. 确保已设置GOOGLE_API_KEY环境变量
 * 2. 运行: npm run twitter-auto -- --username=你的用户名 --password=你的密码 --target=目标用户名
 */

import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import { z } from "zod";
import chalk from "chalk";
import { GoogleClient } from "@/lib/llm/GoogleClient";

// 从命令行参数中获取登录凭据和目标用户
function getArgs() {
  const args = process.argv.slice(2);
  const username = args.find(arg => arg.startsWith('--username='))?.split('=')[1];
  const password = args.find(arg => arg.startsWith('--password='))?.split('=')[1];
  const target = args.find(arg => arg.startsWith('--target='))?.split('=')[1] || 'elonmusk'; // 默认浏览Elon Musk的推文

  if (!username || !password) {
    console.error('请提供Twitter登录凭据。使用方式: npm run twitter-auto -- --username=你的用户名 --password=你的密码 --target=目标用户名');
    process.exit(1);
  }

  return { username, password, target };
}

async function twitterAutomation() {
  const { username, password, target } = getArgs();

  console.log(chalk.blue('🚀 初始化Twitter自动化...'));

  // 初始化Stagehand
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    verbose: 1,
    enableCaching: false,
    // 使用Google的Gemini模型
    llmClient: new GoogleClient({
      logger: console.log,
      modelName: process.env.GEMINI_MODEL || "gemini-1.5-pro", // 从环境变量中读取模型名称，如果未设置则使用默认值
      clientOptions: {
        apiKey: process.env.GOOGLE_API_KEY,
      },
    }),
    localBrowserLaunchOptions: {
      headless: false, // 设置为true可以在后台运行
    }
  });

  try {
    console.log(chalk.blue('🌐 启动浏览器...'));
    await stagehand.init();
    const page = stagehand.page;

    // 创建一个agent来处理复杂的交互
    // 注意：由于我们使用的是Gemini模型，我们将使用基本的act和extract方法
    // 而不是使用agent，因为Gemini目前不支持computer-use模型

    // 设置系统提示，指导模型如何处理Twitter交互
    await page.setSystemPrompt(`你是一个帮助用户浏览Twitter的助手。
      请按照用户的指示执行操作，不要询问后续问题。
      当浏览推文时，请提取推文的内容、发布时间和互动数据（点赞、转发、评论数）。`);

    // 1. 导航到Twitter登录页面
    console.log(chalk.blue('🔍 导航到Twitter登录页面...'));
    await page.goto("https://twitter.com/login");

    // 2. 登录Twitter
    console.log(chalk.blue('🔑 正在登录Twitter...'));

    // 使用act方法进行登录
    await page.act(`输入用户名 "${username}"`);
    await page.act(`点击"下一步"按钮`);
    await page.act(`输入密码 "${password}"`);
    await page.act(`点击"登录"按钮`);

    // 等待登录完成
    console.log(chalk.blue('⏳ 等待登录完成...'));
    await page.waitForTimeout(5000);

    // 检查是否成功登录
    const currentUrl = await page.url();
    if (currentUrl.includes("twitter.com/home")) {
      console.log(chalk.green('✅ 登录成功!'));
    } else {
      // 如果登录页面有变化，使用更复杂的指令来处理登录
      console.log(chalk.yellow('⚠️ 标准登录流程可能已更改，尝试使用更复杂的指令完成登录...'));
      await page.act(`分析当前页面，并使用用户名 "${username}" 和密码 "${password}" 完成Twitter登录流程。注意观察所有表单元素和按钮，并按照正确的顺序填写和提交。`);
    }

    // 3. 导航到目标用户的Twitter页面
    console.log(chalk.blue(`🔍 导航到用户 @${target} 的Twitter页面...`));
    await page.goto(`https://twitter.com/${target}`);

    // 4. 提取用户信息
    console.log(chalk.blue('📊 提取用户信息...'));
    const userInfo = await page.extract({
      instruction: `提取用户 @${target} 的个人资料信息`,
      schema: z.object({
        displayName: z.string().describe("用户显示名称"),
        username: z.string().describe("用户的@用户名"),
        bio: z.string().describe("用户简介").optional(),
        followersCount: z.string().describe("粉丝数").optional(),
        followingCount: z.string().describe("关注数").optional(),
      }),
    });

    console.log(chalk.green('用户信息:'));
    console.log(chalk.cyan(`📝 名称: ${userInfo.displayName} (@${userInfo.username})`));
    if (userInfo.bio) console.log(chalk.cyan(`📝 简介: ${userInfo.bio}`));
    if (userInfo.followersCount) console.log(chalk.cyan(`👥 粉丝: ${userInfo.followersCount}`));
    if (userInfo.followingCount) console.log(chalk.cyan(`👥 关注: ${userInfo.followingCount}`));

    // 5. 提取最新推文
    console.log(chalk.blue('📜 提取最新推文...'));
    const tweets = await page.extract({
      instruction: `提取用户 @${target} 的最新5条推文`,
      schema: z.object({
        tweets: z.array(
          z.object({
            content: z.string().describe("推文内容"),
            timestamp: z.string().describe("发布时间").optional(),
            likes: z.string().describe("点赞数").optional(),
            retweets: z.string().describe("转发数").optional(),
            replies: z.string().describe("回复数").optional(),
          })
        ).describe("推文列表"),
      }),
    });

    // 6. 显示提取的推文
    console.log(chalk.green(`\n📱 ${userInfo.displayName} 的最新推文:`));
    tweets.tweets.forEach((tweet, index) => {
      console.log(chalk.yellow(`\n推文 #${index + 1}:`));
      console.log(chalk.white(`${tweet.content}`));

      const stats = [];
      if (tweet.timestamp) stats.push(`🕒 ${tweet.timestamp}`);
      if (tweet.likes) stats.push(`❤️ ${tweet.likes}`);
      if (tweet.retweets) stats.push(`🔄 ${tweet.retweets}`);
      if (tweet.replies) stats.push(`💬 ${tweet.replies}`);

      if (stats.length > 0) {
        console.log(chalk.gray(stats.join(' | ')));
      }
    });

    // 7. 滚动加载更多推文
    console.log(chalk.blue('\n📜 滚动加载更多推文...'));

    // 滚动页面以加载更多推文
    await page.act(`向下滚动页面以加载更多推文`);
    await page.waitForTimeout(3000); // 等待新推文加载

    // 提取新加载的推文
    const moreTweets = await page.extract({
      instruction: `提取新加载的推文，这些推文应该与之前提取的不同`,
      schema: z.object({
        tweets: z.array(
          z.object({
            content: z.string().describe("推文内容"),
            timestamp: z.string().describe("发布时间").optional(),
            likes: z.string().describe("点赞数").optional(),
            retweets: z.string().describe("转发数").optional(),
            replies: z.string().describe("回复数").optional(),
          })
        ).describe("推文列表"),
      }),
    });

    // 显示新提取的推文
    console.log(chalk.green(`\n📱 新加载的推文:`));
    moreTweets.tweets.forEach((tweet, index) => {
      console.log(chalk.yellow(`\n推文 #${index + 1}:`));
      console.log(chalk.white(`${tweet.content}`));

      const stats = [];
      if (tweet.timestamp) stats.push(`🕒 ${tweet.timestamp}`);
      if (tweet.likes) stats.push(`\u2764️ ${tweet.likes}`);
      if (tweet.retweets) stats.push(`🔁 ${tweet.retweets}`);
      if (tweet.replies) stats.push(`💬 ${tweet.replies}`);

      if (stats.length > 0) {
        console.log(chalk.gray(stats.join(' | ')));
      }
    });

    // 8. 完成任务
    console.log(chalk.green('\n✅ 自动化任务完成!'));

  } catch (error) {
    console.error(chalk.red('❌ 发生错误:'), error);
  } finally {
    // 关闭浏览器
    console.log(chalk.blue('🔒 关闭浏览器...'));
    await stagehand.close();
  }
}

// 执行自动化脚本
(async () => {
  await twitterAutomation();
})();
