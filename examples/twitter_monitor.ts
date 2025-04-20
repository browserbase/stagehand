/**
 * Twitter监控脚本 - 定时监控指定用户的最新推文
 *
 * 使用方法:
 * 1. 确保已在.env文件中设置所有必要的环境变量
 * 2. 运行: npm run twitter-monitor -- --target=目标用户名 --interval=监控间隔(分钟)
 */

import { Page } from "playwright";
import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import { z } from "zod";
import chalk from "chalk";
import { GoogleClient } from "@/lib/llm/GoogleClient";
import * as dotenv from "dotenv";
import type { Page as StagehandPage } from "@/types/page";
import * as TwitterUtils from "./twitter_utils";
import path from "path";
import fs from "fs";

// 加载环境变量
dotenv.config();

// 定义推文类型
interface Tweet {
  id?: string;
  content: string;
  timestamp?: string;
  likes?: string;
  retweets?: string;
  replies?: string;
}

// 定义监控状态
interface MonitorState {
  lastCheckedAt: Date;
  knownTweetIds: Set<string>;
  latestTweets: Tweet[];
}

// 从环境变量和命令行参数中获取登录凭据和目标用户
function getArgs() {
  const args = process.argv.slice(2);

  // 从命令行参数或默认值获取目标用户
  const target =
    args.find((arg) => arg.startsWith("--target="))?.split("=")[1] ||
    "elonmusk"; // 默认监控Elon Musk的推文

  // 从命令行参数获取监控间隔（分钟）
  const intervalStr = args
    .find((arg) => arg.startsWith("--interval="))
    ?.split("=")[1];
  const interval = intervalStr ? parseInt(intervalStr) : 1; // 默认每1分钟检查一次

  // 获取Twitter凭据
  const {
    username,
    password,
    twoFAEnabled,
    twoFASecret,
    verificationEmail,
    verificationPhone,
  } = TwitterUtils.getTwitterCredentials();

  return {
    username,
    password,
    target,
    interval,
    twoFAEnabled,
    twoFASecret,
    verificationEmail,
    verificationPhone,
  };
}

// 保存推文到文件
function saveTweets(target: string, tweets: Tweet[]) {
  const dataDir = TwitterUtils.ensureDataDir();
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dataDir, `${target}_tweets_${dateStr}.json`);

  fs.writeFileSync(filePath, JSON.stringify(tweets, null, 2));
  console.log(chalk.green(`✅ 已保存 ${tweets.length} 条推文到 ${filePath}`));

  // 更新最新推文文件
  const latestFilePath = path.join(dataDir, `${target}_latest_tweets.json`);
  fs.writeFileSync(latestFilePath, JSON.stringify(tweets, null, 2));
}

// 加载已知推文ID
function loadKnownTweetIds(target: string): Set<string> {
  const dataDir = TwitterUtils.ensureDataDir();
  const latestFilePath = path.join(dataDir, `${target}_latest_tweets.json`);

  if (fs.existsSync(latestFilePath)) {
    try {
      const tweets = JSON.parse(
        fs.readFileSync(latestFilePath, "utf-8"),
      ) as Tweet[];
      return new Set(tweets.map((tweet) => tweet.id).filter(Boolean));
    } catch (error) {
      console.error(
        chalk.yellow("⚠️ 无法加载已知推文ID，将创建新的记录"),
        error,
      );
      return new Set<string>();
    }
  }

  return new Set<string>();
}

// 提取推文ID（从URL或内容中）
function extractTweetId(tweet: Tweet): string | undefined {
  // 如果已有ID，直接返回
  if (tweet.id) return tweet.id;

  // 尝试从内容中提取ID（这是一个简化的实现，实际应用中可能需要更复杂的逻辑）
  // 使用内容的哈希作为ID
  return Buffer.from(tweet.content).toString("base64").substring(0, 16);
}

// 主要监控函数
async function monitorTwitter() {
  const {
    username,
    password,
    target,
    interval,
    twoFAEnabled,
    twoFASecret,
    verificationEmail,
    verificationPhone,
  } = getArgs();

  console.log(
    chalk.blue(
      `🚀 初始化Twitter监控 - 目标用户: @${target}, 间隔: ${interval}分钟...`,
    ),
  );

  // 初始化监控状态
  const monitorState: MonitorState = {
    lastCheckedAt: new Date(),
    knownTweetIds: loadKnownTweetIds(target),
    latestTweets: [],
  };

  // 初始化Stagehand
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    verbose: 1,
    enableCaching: false,
    // 使用Google模型，更适合结构化数据提取
    llmClient: new GoogleClient({
      logger: console.log,
      // @ts-expect-error - 环境变量类型与预期类型不匹配，但运行时会正常工作
      modelName: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      clientOptions: { apiKey: process.env.GOOGLE_API_KEY },
    }),
    // 设置系统提示，指导模型如何处理Twitter交互
    systemPrompt: `你是一个帮助用户监控Twitter的助手。
      请准确提取推文的内容、ID、发布时间和互动数据（点赞、转发、评论数）。
      确保提取的数据结构化且完整，特别是推文ID和时间戳，这对于去重和排序非常重要。`,
    localBrowserLaunchOptions: {
      headless: false, // 设置为false使用有头浏览器，便于观察和可能的手动干预
    },
  });

  try {
    console.log(chalk.blue("🌐 启动浏览器..."));
    await stagehand.init();
    const page = stagehand.page;

    // 加载或保存 Cookie，跳过多次登录
    const cookiesLoaded = await TwitterUtils.handleCookies(stagehand.context, 'load');
    
    if (!cookiesLoaded) {
      // 首次运行，执行登录并保存 Cookie
      await TwitterUtils.loginToTwitter(
        page,
        username,
        password,
        twoFAEnabled,
        twoFASecret,
        verificationEmail,
        verificationPhone,
      );
      await TwitterUtils.handleCookies(stagehand.context, 'save');
    } else {
      console.log(chalk.green("✅ 已加载 Cookie，跳过登录"));
    }

    // 设置定时器，定期检查新推文
    console.log(
      chalk.blue(
        `⏰ 开始监控 @${target} 的推文，每 ${interval} 分钟检查一次...`,
      ),
    );

    // 首次检查
    await checkNewTweets(page, target, monitorState);

    // 设置定时检查
    const intervalId = setInterval(
      async () => {
        try {
          await checkNewTweets(page, target, monitorState);
        } catch (error) {
          console.error(chalk.red("❌ 检查推文时出错:"), error);

          // 尝试恢复会话
          try {
            console.log(chalk.yellow("⚠️ 尝试恢复会话..."));
            await page.goto(`https://x.com/${target}`);
            await page.waitForTimeout(5000);
          } catch (recoveryError) {
            console.error(chalk.red("❌ 无法恢复会话:"), recoveryError);

            // 如果恢复失败，清除定时器并退出
            clearInterval(intervalId);
            console.log(chalk.red("❌ 监控已停止，请重新启动脚本"));
            await stagehand.close();
            process.exit(1);
          }
        }
      },
      interval * 60 * 1000,
    );

    // 处理进程退出
    process.on("SIGINT", async () => {
      console.log(chalk.yellow("\n⚠️ 收到退出信号，正在清理资源..."));
      clearInterval(intervalId);
      await stagehand.close();
      console.log(chalk.green("✅ 资源已清理，监控已停止"));
      process.exit(0);
    });
  } catch (error) {
    console.error(chalk.red("❌ 监控过程中出错:"), error);
    await stagehand.close();
    process.exit(1);
  }
}

// 检查新推文
async function checkNewTweets(page: StagehandPage, target: string, state: MonitorState) {
  console.log(chalk.blue(`\n🔍 检查 @${target} 的新推文...`));
  console.log(
    chalk.gray(`上次检查时间: ${state.lastCheckedAt.toLocaleString()}`),
  );

  // 导航到用户页面
  await page.goto(`https://x.com/${target}`);
  await page.waitForTimeout(5000); // 等待页面加载

  // 提取推文
  try {
    const extractedData = await page.extract({
      instruction: `提取用户 @${target} 的最新10条推文，包括推文ID、内容、时间戳和互动数据`,
      schema: z.object({
        tweets: z
          .array(
            z.object({
              id: z.string().describe("推文ID").optional(),
              content: z.string().describe("推文内容"),
              timestamp: z.string().describe("发布时间").optional(),
              likes: z.string().describe("点赞数").optional(),
              retweets: z.string().describe("转发数").optional(),
              replies: z.string().describe("回复数").optional(),
            }),
          )
          .describe("推文列表"),
      }),
    });

    // 处理提取的推文
    if (
      extractedData &&
      extractedData.tweets &&
      extractedData.tweets.length > 0
    ) {
      console.log(
        chalk.green(`✅ 成功提取 ${extractedData.tweets.length} 条推文`),
      );

      // 为每条推文添加ID（如果没有）
      const tweets = extractedData.tweets.map((tweet: Tweet) => {
        if (!tweet.id) {
          tweet.id = extractTweetId(tweet);
        }
        return tweet;
      });

      // 找出新推文
      const newTweets = tweets.filter(
        (tweet: Tweet) => tweet.id && !state.knownTweetIds.has(tweet.id),
      );

      if (newTweets.length > 0) {
        console.log(chalk.green(`🔔 发现 ${newTweets.length} 条新推文!`));

        // 显示新推文
        newTweets.forEach((tweet: Tweet, index: number) => {
          console.log(chalk.yellow(`\n新推文 #${index + 1}:`));
          console.log(chalk.white(`${tweet.content}`));

          const stats = [];
          if (tweet.timestamp) stats.push(`🕒 ${tweet.timestamp}`);
          if (tweet.likes) stats.push(`❤️ ${tweet.likes}`);
          if (tweet.retweets) stats.push(`🔄 ${tweet.retweets}`);
          if (tweet.replies) stats.push(`💬 ${tweet.replies}`);

          if (stats.length > 0) {
            console.log(chalk.gray(stats.join(" | ")));
          }
        });

        // 保存新推文
        saveTweets(target, newTweets);

        // 更新已知推文ID
        newTweets.forEach((tweet: Tweet) => {
          if (tweet.id) {
            state.knownTweetIds.add(tweet.id);
          }
        });

        // 更新最新推文
        state.latestTweets = newTweets;
      } else {
        console.log(chalk.blue("ℹ️ 没有发现新推文"));
      }

      // 更新检查时间
      state.lastCheckedAt = new Date();
    } else {
      console.log(chalk.yellow("⚠️ 未能提取到推文"));
    }
  } catch (error) {
    console.error(chalk.red("❌ 提取推文时出错:"), error);
    throw error; // 向上传递错误，让调用者处理
  }
}

// 执行监控脚本
(async () => {
  await monitorTwitter();
})();
