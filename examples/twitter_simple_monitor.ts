/**
 * Twitter简易监控回复脚本
 *
 * 功能：
 * 1. 多账号轮询
 * 2. 监控多个目标用户的最新一条推文
 * 3. 进行回复
 * 4. 每分钟执行一次
 */

import path from "path";
import fs from "fs";
import chalk from "chalk";
import { Stagehand } from "@/dist";
import type { Page as StagehandPage } from "@/types/page";
import StagehandConfig from "@/stagehand.config";
import * as TwitterUtilsModule from "./twitter_utils";
import * as dotenv from "dotenv";
import { GoogleClient } from "../lib/llm/GoogleClient";
import { AvailableModel } from "../types/model";
import { z } from "zod";

// 加载环境变量
dotenv.config();

// 定义配置类型
interface Target {
  username: string;
  lastChecked?: Date;
}

interface Account {
  username: string;
  password: string;
  twoFAEnabled: boolean;
  twoFASecret: string;
  cookiesPath?: string;
  cookieValid?: boolean;
  verificationEmail?: string;
  verificationPhone?: string;
  proxy?: {
    server: string;
    bypass?: string;
    username?: string;
    password?: string;
  };
}

interface ReplyContent {
  text?: string;
  image?: string;
  video?: string;
  accountUsername?: string;
}

interface Tweet {
  id: string;
  content: string;
  url: string;
  authorUsername: string;
}

// 确保配置目录存在
function ensureConfigDir(): string {
  const configDir = path.join(process.cwd(), "examples", "config");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  return configDir;
}

// 加载目标用户配置
function loadTargets(): Target[] {
  const configDir = ensureConfigDir();
  const targetsFile = path.join(configDir, "targets.json");

  if (!fs.existsSync(targetsFile)) {
    console.log(chalk.yellow("⚠️ 未找到targets.json文件，创建示例配置"));
    const exampleTargets = [
      {
        username: "elonmusk",
      },
    ];
    fs.writeFileSync(targetsFile, JSON.stringify(exampleTargets, null, 2));
    return exampleTargets;
  }

  try {
    return JSON.parse(fs.readFileSync(targetsFile, "utf-8"));
  } catch (error) {
    console.error(chalk.red("❌ 无法解析targets.json文件:"), error);
    return [];
  }
}

// 加载账号配置
function loadAccounts(): Account[] {
  const configDir = ensureConfigDir();
  const accountsFile = path.join(configDir, "accounts.json");

  if (!fs.existsSync(accountsFile)) {
    console.log(chalk.yellow("⚠️ 未找到accounts.json文件，请创建配置文件"));
    const exampleAccounts = [
      {
        username: "example_user",
        password: "password123",
        twoFAEnabled: false,
        twoFASecret: "",
        cookiesPath: "./data/cookies_example.json",
        cookieValid: true,
        verificationEmail: "your_email@example.com",
        verificationPhone: "+1234567890",
      },
    ];
    fs.writeFileSync(accountsFile, JSON.stringify(exampleAccounts, null, 2));
    return [];
  }

  try {
    return JSON.parse(fs.readFileSync(accountsFile, "utf-8"));
  } catch (error) {
    console.error(chalk.red("❌ 无法解析accounts.json文件:"), error);
    return [];
  }
}

// 加载回复内容
function loadReplyContent(): ReplyContent[] {
  const configDir = ensureConfigDir();
  const repliesFile = path.join(configDir, "replies.json");

  if (!fs.existsSync(repliesFile)) {
    console.log(chalk.yellow("⚠️ 未找到replies.json文件，创建示例配置"));
    const exampleReplies = [
      {
        text: "这是一条自动回复消息",
      },
    ];
    fs.writeFileSync(repliesFile, JSON.stringify(exampleReplies, null, 2));
    return exampleReplies;
  }

  try {
    const replies = JSON.parse(fs.readFileSync(repliesFile, "utf-8"));
    return replies.map((reply: ReplyContent) => {
      // 检查图片和视频文件是否存在
      if (reply.image && !fs.existsSync(reply.image)) {
        console.warn(chalk.yellow(`⚠️ 图片文件不存在: ${reply.image}`));
        return { ...reply, image: undefined };
      }
      if (reply.video && !fs.existsSync(reply.video)) {
        console.warn(chalk.yellow(`⚠️ 视频文件不存在: ${reply.video}`));
        return { ...reply, video: undefined };
      }
      return reply;
    });
  } catch (error) {
    console.error(chalk.red("❌ 无法解析replies.json文件:"), error);
    return [{ text: "这是一条自动回复消息" }];
  }
}

// 智能延迟函数
async function smartDelay(
  page: StagehandPage,
  minMs: number,
  maxMs: number,
): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(chalk.gray(`⏱️ 等待 ${delay}ms...`));
  await page.waitForTimeout(delay);
}

// 回复推文函数
async function replyToTweet(
  tweet: Tweet,
  account: Account,
  replyContent: ReplyContent,
  page: StagehandPage,
): Promise<boolean> {
  console.log(
    chalk.blue(
      `🔄 使用账号 @${account.username} 回复 @${tweet.authorUsername} 的推文`,
    ),
  );

  try {
    // 导航到推文URL
    console.log(chalk.blue(`🔗 导航到推文页面: ${tweet.url}`));
    await page.goto(tweet.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // 等待页面加载
    await smartDelay(page, 2000, 3000);

    // 查找回复按钮
    const replyButtonSelector = '[data-testid="reply"]';

    // 等待回复按钮出现
    await page.waitForSelector(replyButtonSelector, { timeout: 15000 });

    // 点击回复按钮
    await page.click(replyButtonSelector);
    console.log(chalk.green("✅ 点击回复按钮"));

    // 等待回复框出现
    await smartDelay(page, 1000, 2000);
    const replyBoxSelector = '[data-testid="tweetTextarea_0"]';
    await page.waitForSelector(replyBoxSelector, { timeout: 10000 });

    // 输入回复内容
    const replyText = replyContent.text || "这是一条自动回复";
    await page.fill(replyBoxSelector, replyText);
    console.log(
      chalk.green(`✅ 输入回复内容: ${replyText.substring(0, 30)}...`),
    );

    // 等待内容输入完成
    await smartDelay(page, 1000, 2000);

    // 上传图片或视频 (如果有)
    if (replyContent.image) {
      const mediaButtonSelector = '[data-testid="attachments"]';
      await page.click(mediaButtonSelector);
      console.log(chalk.blue(`🖼️ 开始上传图片: ${replyContent.image}`));

      // 等待文件选择框出现
      await smartDelay(page, 1000, 2000);
      const fileInputSelector = 'input[type="file"]';

      // 查找文件上传输入框
      const fileInput = await page.$(fileInputSelector);
      if (fileInput) {
        await fileInput.setInputFiles(replyContent.image);
        console.log(chalk.green("✅ 图片上传完成"));

        // 等待图片上传
        await smartDelay(page, 3000, 5000);
      } else {
        console.log(chalk.yellow("⚠️ 无法找到文件上传输入框"));
      }
    }

    // 点击发送回复按钮
    const postButtonSelector = '[data-testid="tweetButton"]';
    await page.waitForSelector(postButtonSelector, { timeout: 10000 });

    // 点击发送按钮
    await page.click(postButtonSelector);
    console.log(chalk.green("✅ 点击发送按钮"));

    // 等待回复发送完成
    await smartDelay(page, 3000, 5000);

    console.log(chalk.green("✅ 成功回复推文"));
    return true;
  } catch (error) {
    console.error(chalk.red(`❌ 回复推文出错:`), error);
    return false;
  }
}

// 检查用户最新推文
async function checkUserLatestTweet(
  target: Target,
  account: Account,
  replyContents: ReplyContent[],
): Promise<void> {
  console.log(chalk.blue(`\n🔍 检查用户 @${target.username} 的最新推文...`));
  console.log(chalk.blue(`👤 使用账号 @${account.username} 进行监控`));

  // 构建代理配置
  let proxyOptions = null;
  if (account.proxy) {
    proxyOptions = {
      server: account.proxy.server,
    };

    // 如果代理需要认证，添加认证信息
    if (account.proxy.username && account.proxy.password) {
      proxyOptions = {
        server: account.proxy.server,
        username: account.proxy.username,
        password: account.proxy.password,
      };
    }
  }

  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    verbose: 1,
    enableCaching: false,
    llmClient: new GoogleClient({
      logger: console.log,
      modelName: "gemini-2.5-flash-preview-04-17" as AvailableModel,
      clientOptions: { apiKey: process.env.GOOGLE_API_KEY },
    }),
    localBrowserLaunchOptions: proxyOptions
      ? {
          proxy: proxyOptions,
          headless: false,
        }
      : { headless: false },
  });

  try {
    // 初始化浏览器
    console.log(chalk.blue(`🌐 启动浏览器...`));
    await stagehand.init();
    const page = stagehand.page;

    // 登录Twitter
    console.log(chalk.blue(`🔑 登录账号 @${account.username}...`));
    const loginSuccess = await TwitterUtilsModule.loginAccountOnPage(
      page,
      account,
      stagehand.context,
    );

    if (!loginSuccess) {
      throw new Error(`账号 @${account.username} 登录失败`);
    }

    console.log(chalk.green(`✅ 登录成功`));

    // 访问目标用户页面
    console.log(chalk.blue(`🔗 访问 @${target.username} 的主页`));
    await page.goto(`https://twitter.com/${target.username}`, {
      timeout: 60000,
      waitUntil: "domcontentloaded",
    });

    // 等待页面加载
    await smartDelay(page, 3000, 5000);

    // 显式等待第一个推文元素出现
    try {
      console.log(chalk.blue("⏳ 等待推文加载..."));
      await page.waitForSelector('article[data-testid="tweet"]', {
        timeout: 15000,
      });
      console.log(chalk.green("✅ 推文元素已加载"));
    } catch (error) {
      console.log(
        chalk.yellow(
          "⚠️ 等待推文元素超时或失败，可能页面未正确加载推文。错误信息:",
        ),
        error,
      );
      // 即使等待失败，也继续尝试后续操作，因为 extract 回退机制或许能处理
    }

    // --- Playwright DOM 结构检查 --- START ---
    try {
      console.log(chalk.magenta("🔬 使用 Playwright 检查页面结构..."));
      const tweetLocator = page.locator('article[data-testid="tweet"]');
      const tweetCount = await tweetLocator.count();
      console.log(
        chalk.magenta(
          `  -> 发现 ${tweetCount} 个推文元素 (article[data-testid="tweet"])`,
        ),
      );

      if (tweetCount > 0) {
        const firstTweetHtml = await tweetLocator
          .first()
          .evaluate((element) => element.outerHTML);
        console.log(
          chalk.magenta(
            `  -> 第一个推文元素 HTML (前 500 字符):
${firstTweetHtml.substring(0, 500)}${firstTweetHtml.length > 500 ? "..." : ""}`,
          ),
        );
        // 尝试查找时间戳链接
        const timeLinkLocator = tweetLocator
          .first()
          .locator('a[href*="/status/"] time');
        const timeLinkCount = await timeLinkLocator.count();
        console.log(
          chalk.magenta(
            `  -> 在第一个推文中发现 ${timeLinkCount} 个时间戳链接`,
          ),
        );
        if (timeLinkCount > 0) {
          const timeLinkHref = await timeLinkLocator
            .first()
            .locator("..")
            .getAttribute("href");
          console.log(
            chalk.magenta(`  -> 第一个时间戳链接 HREF: ${timeLinkHref}`),
          );
        }
      }
    } catch (error) {
      console.error(chalk.red("❌ Playwright 页面检查时出错:"), error);
    }
    // --- Playwright DOM 结构检查 --- END ---

    // 提取最新推文
    console.log(chalk.blue(`�� 提取最新推文...`));

    let tweetId: string | null = null;
    let tweetUrl: string | null = null;
    let tweetContent: string | null = null;
    let tweetAuthorUsername: string | null = null;

    try {
      // 1. 使用 Playwright 定位第一个推文和时间戳链接
      const tweetLocator = page.locator('article[data-testid="tweet"]').first();
      const timeLinkLocator = tweetLocator
        .locator('a[href*="/status/"]')
        .locator("time"); // 定位到 time 元素，然后找父 a 元素

      if ((await timeLinkLocator.count()) > 0) {
        const linkElement = timeLinkLocator.locator("xpath=.."); // 获取 time 元素的父元素 (a)
        const href = await linkElement.getAttribute("href");
        if (href) {
          const idMatch = href.match(/\/status\/([0-9]+)/);
          if (idMatch && idMatch[1]) {
            tweetId = idMatch[1];
            tweetUrl = `https://twitter.com${href}`; // 使用相对路径构建完整URL
            tweetAuthorUsername = href.split("/")[1] || target.username; // 从 URL 提取用户名
            console.log(
              chalk.green(
                `✅ Playwright 提取到 ID: ${tweetId}, URL: ${tweetUrl}`,
              ),
            );
          }
        }
      } else {
        console.log(chalk.yellow("⚠️ Playwright 未找到时间戳链接。"));
      }

      // 2. 如果Playwright找到了ID，则使用 extract 获取内容
      if (tweetId) {
        const extractInstruction = `Extract the main text content of the tweet with ID ${tweetId} authored by @${tweetAuthorUsername || target.username}.`;
        try {
          const contentData = await page.extract({
            instruction: extractInstruction,
            schema: z.object({
              content: z.string().optional(), // 内容可能为空
              // authorUsername: z.string(), // 我们已经从URL获取了用户名
            }),
          });
          tweetContent = contentData.content || null;
          if (tweetContent) {
            console.log(chalk.green("✅ Extract 成功提取到推文内容。"));
          } else {
            console.log(chalk.yellow("⚠️ Extract 未能提取到推文内容。"));
          }
          // 确认作者用户名，优先使用 extract 结果（如果未来添加），否则用 Playwright 结果
          // tweetAuthorUsername = contentData.authorUsername || tweetAuthorUsername;
        } catch (extractError) {
          console.error(
            chalk.red("❌ 使用 extract 提取内容时出错:"),
            extractError,
          );
          // 即使 extract 失败，我们仍然有 ID 和 URL，可以尝试回复
          tweetContent = "[无法提取内容]"; // 标记内容无法提取
        }
      } else {
        // 如果 Playwright 未找到 ID，尝试旧的 extract 方法作为回退
        console.log(
          chalk.yellow("⚠️ Playwright 未找到 ID，尝试使用 extract 回退..."),
        );
        const fallbackInstruction = `Find the first tweet element on the user's profile page for @${target.username}. Extract the following from that tweet element:
1.  **id**: The unique numerical ID of the tweet. Usually found in the URL of the tweet's timestamp link.
2.  **content**: The main text content of the tweet.
3.  **url**: The full permanent URL (permalink) to the tweet. This typically looks like https://twitter.com/[username]/status/[tweet_id].
4.  **authorUsername**: The username of the person who posted the tweet (should be @${target.username}).

Return the result as a JSON object with keys: "id", "content", "url", "authorUsername". If any piece of information cannot be found, return an empty string for that key. Ensure the 'id' is just the number string.`;

        try {
          const tweetData = (await page.extract({
            instruction: fallbackInstruction,
            schema: z.object({
              id: z.string().optional(),
              content: z.string().optional(),
              url: z.string().optional(),
              authorUsername: z.string().optional(),
            }),
          })) as Partial<Tweet>;

          tweetId = tweetData.id || null;
          tweetContent = tweetData.content || null;
          tweetUrl = tweetData.url || null;
          tweetAuthorUsername = tweetData.authorUsername || target.username;

          // 简单的 ID/URL 修复逻辑
          if (tweetUrl && !tweetId) {
            const idMatch = tweetUrl.match(/\/status\/([0-9]+)/);
            if (idMatch) tweetId = idMatch[1];
          }
          if (tweetId && !tweetUrl) {
            tweetUrl = `https://twitter.com/${tweetAuthorUsername}/status/${tweetId}`;
          }

          if (tweetId && tweetContent) {
            console.log(chalk.green("✅ Extract 回退成功提取到推文数据。"));
          } else {
            console.log(
              chalk.yellow("⚠️ Extract 回退未能提取到完整推文数据。"),
            );
          }
        } catch (extractFallbackError) {
          console.error(
            chalk.red("❌ Extract 回退提取时出错:"),
            extractFallbackError,
          );
        }
      }

      // 检查是否成功获取了必要的推文信息 (ID 和 URL 是回复的关键)
      if (tweetId && tweetUrl && tweetContent) {
        console.log(chalk.green(`✅ 成功提取到最新推文 (ID: ${tweetId})`));
        console.log(chalk.blue(`\n📝 推文内容:`));
        console.log(
          chalk.white(
            `${tweetContent.substring(0, 100)}${tweetContent.length > 100 ? "..." : ""}`,
          ),
        );
        console.log(chalk.gray(`🔗 ${tweetUrl}`));

        const fullTweet: Tweet = {
          id: tweetId,
          content: tweetContent,
          url: tweetUrl,
          authorUsername: tweetAuthorUsername || target.username, // 确保有用户名
        };

        // 随机选择一条回复内容
        const compatibleReplies = replyContents.filter(
          (reply) =>
            !reply.accountUsername ||
            reply.accountUsername === account.username,
        );

        if (compatibleReplies.length === 0) {
          console.log(
            chalk.yellow(`⚠️ 没有适用于账号 @${account.username} 的回复内容`),
          );
          return;
        }

        const replyContent =
          compatibleReplies[
            Math.floor(Math.random() * compatibleReplies.length)
          ];

        // 显示回复内容预览
        if (replyContent.text) {
          console.log(
            chalk.gray(
              `📝 回复内容: ${replyContent.text.substring(0, 70)}${replyContent.text.length > 70 ? "..." : ""}`,
            ),
          );
        }
        if (replyContent.image) {
          console.log(chalk.gray(`🖼️ 附带图片: ${replyContent.image}`));
        }

        // 在回复前添加随机延迟
        await smartDelay(page, 3000, 5000);

        // 执行回复
        await replyToTweet(fullTweet, account, replyContent, page);
      } else {
        console.log(chalk.yellow(`⚠️ 未找到有效推文`));
      }
    } catch (error) {
      console.error(chalk.red(`❌ 解析推文数据时出错:`), error);
    }

    // 等待浏览器关闭
    await smartDelay(page, 2000, 3000);
  } catch (error) {
    console.error(chalk.red(`❌ 检查推文时出错:`), error);
  } finally {
    // 确保浏览器资源被正确释放
    console.log(chalk.blue(`🧹 清理浏览器资源...`));
    await stagehand.close();
  }
}

// 主函数
async function monitorTwitter(): Promise<void> {
  console.log(chalk.blue(`🚀 启动Twitter简易监控回复系统...`));

  // 加载配置
  const targets = loadTargets();
  const accounts = loadAccounts();
  const replyContents = loadReplyContent();

  if (
    targets.length === 0 ||
    accounts.length === 0 ||
    replyContents.length === 0
  ) {
    console.error(chalk.red(`❌ 配置不完整，请检查配置文件`));
    return;
  }

  console.log(
    chalk.green(
      `✅ 已加载 ${targets.length} 个目标用户, ${accounts.length} 个账号, ${replyContents.length} 条回复模板`,
    ),
  );

  // 账号索引
  let accountIndex = 0;

  // 循环监控
  while (true) {
    console.log(chalk.cyan(`\n📊 开始新一轮监控...`));

    // 循环检查每个目标用户的推文
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];

      // 选择下一个账号（循环使用）
      const account = accounts[accountIndex];
      accountIndex = (accountIndex + 1) % accounts.length;

      try {
        await checkUserLatestTweet(target, account, replyContents);
      } catch (error) {
        console.error(chalk.red(`❌ 监控 @${target.username} 出错:`), error);
      }

      // 在目标之间添加分隔线和延迟
      if (i < targets.length - 1) {
        console.log(chalk.blue(`\n${"=".repeat(50)}\n`));
        const delayBetweenTargets = 5000;
        console.log(
          chalk.gray(
            `⏱️ 休息 ${delayBetweenTargets / 1000} 秒后检查下一个目标...`,
          ),
        );
        await new Promise((resolve) =>
          setTimeout(resolve, delayBetweenTargets),
        );
      }
    }

    // 固定为1分钟一次的监控频率
    const oneMinute = 60 * 1000;
    console.log(chalk.cyan(`\n🔄 本轮监控完成，将在1分钟后开始下一轮...`));

    console.log(
      chalk.gray(`   (当前时间: ${new Date().toLocaleTimeString()})`),
    );

    console.log(
      chalk.gray(
        `   (下次开始: ${new Date(Date.now() + oneMinute).toLocaleTimeString()})`,
      ),
    );

    // 等待一分钟
    await new Promise((resolve) => setTimeout(resolve, oneMinute));
  }
}

// 执行主函数并处理终止信号
(async () => {
  console.log(chalk.blue(`🚀 启动 Twitter 简易监控脚本...`));

  // 设置终止信号处理
  process.on("SIGINT", () => {
    console.log(chalk.yellow(`\n⚠️ 收到终止信号，准备退出程序...`));
    console.log(chalk.green(`✅ 监控系统已停止`));
    process.exit(0);
  });

  await monitorTwitter();
})();
