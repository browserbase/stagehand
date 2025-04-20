/**
 * Twitter监控脚本 - 定时监控指定用户的最新推文
 *
 * 使用方法:
 * 1. 确保已在.env文件中设置所有必要的环境变量
 * 2. 运行: npm run twitter-monitor -- --target=目标用户名 --interval=监控间隔(分钟)
 */

import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import { z } from "zod";
import chalk from "chalk";
import { OpenAIClient } from "@/lib/llm/OpenAIClient";
import * as dotenv from "dotenv";
import { authenticator } from "otplib";
import fs from "fs";
import path from "path";

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

  // 从环境变量中获取登录凭据
  const username = process.env.TWITTER_USERNAME;
  const password = process.env.TWITTER_PASSWORD;

  // 从命令行参数或默认值获取目标用户
  const target =
    args.find((arg) => arg.startsWith("--target="))?.split("=")[1] ||
    "elonmusk"; // 默认监控Elon Musk的推文

  // 从命令行参数获取监控间隔（分钟）
  const intervalStr = args.find((arg) => arg.startsWith("--interval="))?.split("=")[1];
  const interval = intervalStr ? parseInt(intervalStr) : 1; // 默认每1分钟检查一次

  // 2FA认证相关配置
  const twoFAEnabled = process.env.TWITTER_2FA_ENABLED === "true";
  const twoFASecret = process.env.TWITTER_2FA_SECRET;

  if (!username || !password) {
    console.error("请在.env文件中设置Twitter登录凭据。");
    process.exit(1);
  }

  if (twoFAEnabled && !twoFASecret) {
    console.error(
      "已启用双因素认证，但未提供2FA密钥。请在.env文件中设置TWITTER_2FA_SECRET。",
    );
    process.exit(1);
  }

  return { username, password, target, interval, twoFAEnabled, twoFASecret };
}

// 确保数据目录存在
function ensureDataDir() {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

// 保存推文到文件
function saveTweets(target: string, tweets: Tweet[]) {
  const dataDir = ensureDataDir();
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
  const dataDir = ensureDataDir();
  const latestFilePath = path.join(dataDir, `${target}_latest_tweets.json`);
  
  if (fs.existsSync(latestFilePath)) {
    try {
      const tweets = JSON.parse(fs.readFileSync(latestFilePath, "utf-8")) as Tweet[];
      return new Set(tweets.map(tweet => tweet.id).filter(Boolean));
    } catch (error) {
      console.error(chalk.yellow("⚠️ 无法加载已知推文ID，将创建新的记录"), error);
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
  const { username, password, target, interval, twoFAEnabled, twoFASecret } = getArgs();
  
  console.log(chalk.blue(`🚀 初始化Twitter监控 - 目标用户: @${target}, 间隔: ${interval}分钟...`));
  
  // 初始化监控状态
  const monitorState: MonitorState = {
    lastCheckedAt: new Date(),
    knownTweetIds: loadKnownTweetIds(target),
    latestTweets: []
  };
  
  // 初始化Stagehand
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    verbose: 1,
    enableCaching: false,
    // 使用OpenAI模型，更适合结构化数据提取
    llmClient: new OpenAIClient({
      logger: console.log,
      modelName: process.env.OPENAI_MODEL || "gpt-4o",
      clientOptions: {
        apiKey: process.env.OPENAI_API_KEY,
      },
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
    
    // 登录Twitter
    await loginToTwitter(page, username, password, twoFAEnabled, twoFASecret);
    
    // 设置定时器，定期检查新推文
    console.log(chalk.blue(`⏰ 开始监控 @${target} 的推文，每 ${interval} 分钟检查一次...`));
    
    // 首次检查
    await checkNewTweets(page, target, monitorState);
    
    // 设置定时检查
    const intervalId = setInterval(async () => {
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
    }, interval * 60 * 1000);
    
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

// 登录Twitter
async function loginToTwitter(
  page: any,
  username: string,
  password: string,
  twoFAEnabled: boolean,
  twoFASecret: string | undefined
) {
  console.log(chalk.blue("🔍 导航到Twitter登录页面..."));
  await page.goto("https://twitter.com/login");
  
  console.log(chalk.blue("🔑 正在登录Twitter..."));
  
  try {
    // 等待登录按钮出现，确保页面已加载
    await page
      .waitForSelector('div[role="button"]:has-text("下一步")', {
        timeout: 10000,
      })
      .catch(() =>
        console.log(chalk.yellow("⚠️ 未找到下一步按钮，继续尝试登录")),
      );
    
    // 定位用户名输入框
    const userIdentifierInput =
      (await page.$('input[autocomplete="username"]')) ||
      (await page.$('input[name="text"]')) ||
      (await page.$('input[data-testid="text-input"]'));
    
    if (userIdentifierInput) {
      // 输入用户名
      await userIdentifierInput.fill(username);
      console.log(chalk.blue(`✅ 已输入用户名: ${username}`));
      
      // 点击下一步按钮
      const nextButton =
        (await page.$('div[role="button"]:has-text("下一步")')) ||
        (await page.$('div[role="button"]:has-text("Next")'));
      
      if (nextButton) {
        await nextButton.click();
        console.log(chalk.blue("✅ 已点击下一步按钮"));
      } else {
        console.log(chalk.yellow("⚠️ 找不到下一步按钮，尝试使用Enter键"));
        await page.keyboard.press("Enter");
      }
    } else {
      console.log(chalk.yellow("⚠️ 找不到用户名输入框，尝试使用act方法"));
      await page.act(
        `在登录页面上输入用户名 "${username}"，然后点击下一步或类似的按钮`,
      );
    }
    
    // 等待密码输入框出现
    await page.waitForTimeout(3000);
    
    // 定位密码输入框
    const passwordInput =
      (await page.$('input[name="password"]')) ||
      (await page.$('input[type="password"]'));
    
    if (passwordInput) {
      // 输入密码
      await passwordInput.fill(password);
      console.log(chalk.blue("✅ 已输入密码"));
      
      // 点击登录按钮
      const loginButton =
        (await page.$('div[role="button"]:has-text("登录")')) ||
        (await page.$('div[role="button"]:has-text("Log in")'));
      
      if (loginButton) {
        await loginButton.click();
        console.log(chalk.blue("✅ 已点击登录按钮"));
      } else {
        console.log(chalk.yellow("⚠️ 找不到登录按钮，尝试使用Enter键"));
        await page.keyboard.press("Enter");
      }
    } else {
      console.log(chalk.yellow("⚠️ 找不到密码输入框，尝试使用act方法"));
      await page.act(`输入密码 "${password}"，然后点击登录按钮`);
    }
    
    // 如果启用了双因素认证，处理 2FA
    if (twoFAEnabled && twoFASecret) {
      console.log(chalk.blue("🔐 检测到双因素认证，正在处理..."));
      
      // 生成 TOTP 验证码
      const totpCode = authenticator.generate(twoFASecret);
      console.log(chalk.blue(`🔑 生成TOTP验证码: ${totpCode}`));
      
      // 等待一下，确保2FA页面加载完成
      await page.waitForTimeout(3000);
      
      // 尝试定位2FA输入框
      const twoFAInput =
        (await page.$('input[data-testid="ocfEnterTextTextInput"]')) ||
        (await page.$('input[aria-label="验证码"]')) ||
        (await page.$('input[placeholder*="验证码"]')) ||
        (await page.$('input[placeholder*="code"]'));
      
      if (twoFAInput) {
        // 输入验证码
        await twoFAInput.fill(totpCode);
        console.log(chalk.blue("✅ 已输入验证码"));
        
        // 点击验证按钮
        const verifyButton =
          (await page.$('div[role="button"]:has-text("验证")')) ||
          (await page.$('div[role="button"]:has-text("Verify")')) ||
          (await page.$('div[role="button"]:has-text("Next")')) ||
          (await page.$('div[role="button"]:has-text("下一步")'));
        
        if (verifyButton) {
          await verifyButton.click();
          console.log(chalk.blue("✅ 已点击验证按钮"));
        } else {
          console.log(chalk.yellow("⚠️ 找不到验证按钮，尝试使用Enter键"));
          await page.keyboard.press("Enter");
        }
      } else {
        console.log(chalk.yellow("⚠️ 找不到验证码输入框，尝试使用act方法"));
        // 使用act方法输入验证码并点击验证按钮
        await page.act(
          `输入双因素验证码 "${totpCode}"，然后点击确认或下一步按钮`,
        );
      }
    }
    
    // 等待登录完成
    console.log(chalk.blue("⏳ 等待登录完成..."));
    
    // 等待主页面加载
    console.log(chalk.blue("🔍 等待页面导航..."));
    await page
      .waitForNavigation({ timeout: 30000 })
      .then(() => console.log(chalk.green("✅ 页面导航完成")))
      .catch((error: Error) =>
        console.log(chalk.yellow(`⚠️ 页面导航超时: ${error.message}`)),
      );
    
    // 检查是否成功登录
    const currentUrl = await page.url();
    if (
      currentUrl.includes("twitter.com/home") ||
      currentUrl.includes("x.com/home")
    ) {
      console.log(chalk.green("✅ 登录成功!"));
      return true;
    } else {
      console.log(
        chalk.yellow(
          "⚠️ 登录可能失败或需要额外验证。当前 URL: " + currentUrl,
        ),
      );
      
      // 如果需要手动干预，给用户一些时间
      console.log(
        chalk.yellow(
          "⚠️ 如果需要手动干预，请在浏览器中完成登录流程。等待 30 秒...",
        ),
      );
      await page.waitForTimeout(30000);
      
      // 再次检查是否登录成功
      const newUrl = await page.url();
      if (
        newUrl.includes("twitter.com/home") ||
        newUrl.includes("x.com/home")
      ) {
        console.log(chalk.green("✅ 登录成功!"));
        return true;
      } else {
        console.log(chalk.red("❌ 登录失败。请检查您的凭据或手动登录。"));
        throw new Error("登录失败");
      }
    }
  } catch (error) {
    console.error(chalk.red("❌ 登录过程中出错:"), error);
    console.log(chalk.yellow("⚠️ 尝试等待手动登录完成..."));
    
    // 给用户一些时间手动登录
    console.log(
      chalk.yellow("⚠️ 请在浏览器中手动完成登录流程。等待 60 秒..."),
    );
    await page.waitForTimeout(60000);
    
    // 检查是否已登录
    const currentUrl = await page.url();
    if (
      !currentUrl.includes("twitter.com/home") &&
      !currentUrl.includes("x.com/home")
    ) {
      console.log(chalk.red("❌ 登录失败。请手动登录并重新运行脚本。"));
      throw new Error("登录失败");
    } else {
      console.log(chalk.green("✅ 登录成功!"));
      return true;
    }
  }
}

// 检查新推文
async function checkNewTweets(page: any, target: string, state: MonitorState) {
  console.log(chalk.blue(`\n🔍 检查 @${target} 的新推文...`));
  console.log(chalk.gray(`上次检查时间: ${state.lastCheckedAt.toLocaleString()}`));
  
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
    if (extractedData && extractedData.tweets && extractedData.tweets.length > 0) {
      console.log(chalk.green(`✅ 成功提取 ${extractedData.tweets.length} 条推文`));
      
      // 为每条推文添加ID（如果没有）
      const tweets = extractedData.tweets.map(tweet => {
        if (!tweet.id) {
          tweet.id = extractTweetId(tweet);
        }
        return tweet;
      });
      
      // 找出新推文
      const newTweets = tweets.filter(tweet => tweet.id && !state.knownTweetIds.has(tweet.id));
      
      if (newTweets.length > 0) {
        console.log(chalk.green(`🔔 发现 ${newTweets.length} 条新推文!`));
        
        // 显示新推文
        newTweets.forEach((tweet, index) => {
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
        newTweets.forEach(tweet => {
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
