/**
 * Twitter多用户监控与多账号回复脚本
 *
 * 使用方法:
 * 1. 确保已在.env文件中设置所有必要的环境变量（Gemini API密钥等）
 * 2. 在examples/config目录下创建targets.json和accounts.json配置文件
 * 3. 在accounts.json中配置每个Twitter账号的登录凭证、双因素认证和代理IP
 * 4. 运行前安装依赖: npm install better-sqlite3
 * 5. 运行: npm run twitter-multi-monitor
 *
 * 实现功能:
 * 1. 监控多个指定用户的推文
 * 2. 使用多个账号进行回复
 * 3. 支持回复文本、图片和视频
 * 4. 避免重复回复同一推文
 * 5. 自动清理浏览器资源
 * 6. 每个账号使用独立的代理IP
 */

import { Stagehand } from "@/dist";
import type { Page as StagehandPage } from "@/types/page";
import StagehandConfig from "@/stagehand.config";
import { z } from "zod";
import chalk from "chalk";
import { GoogleClient } from "@/lib/llm/GoogleClient";
import * as dotenv from "dotenv";
import * as TwitterUtils from "./twitter_utils";
import fs from "fs";
import path from "path";
// 不需要显式导入Page，因为TwitterUtils中已经导入
// @ts-expect-error - 请在使用此脚本前安装此依赖: npm install better-sqlite3
import Database from "better-sqlite3";

// 加载环境变量
dotenv.config();

// 定义配置类型
interface Target {
  username: string;
  checkInterval: number; // 检查间隔（分钟）
  lastChecked?: Date;
}

interface Account {
  username: string;
  password: string;
  twoFAEnabled: boolean;
  twoFASecret: string;
  verificationEmail?: string; // 保留验证邮箱字段
  totp_secret?: string;
  verification_email_subject?: string;
  verification_email_regex?: string;
  verification_email_index?: number;
  lastUsed?: Date;
  cookieValid?: boolean;
  // 代理配置
  proxy?: {
    server: string; // 代理服务器地址，如 http://myproxy.com:3128
    bypass?: string; // 绕过代理的地址
    username?: string; // 代理认证用户名
    password?: string; // 代理认证密码
  };
}

interface ReplyContent {
  text?: string;
  image?: string;
  video?: string;
  accountUsername?: string; // 指定使用哪个账号回复，如果未指定则随机选择
}

// 推文类型
interface Tweet {
  id: string;
  content: string;
  url: string;
  timestamp: string;
  authorUsername: string;
}

// 回复记录类型
interface ReplyRecord {
  tweetId: string;
  accountUsername: string;
  timestamp: string;
  content?: string;
  targetUsername: string;
}

// 定义数据库路径和表结构
const DB_PATH = path.join(process.cwd(), "data", "twitter_monitor.db");

// 确保配置目录存在
function ensureConfigDir() {
  const configDir = path.join(process.cwd(), "examples", "config");
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  return configDir;
}

// 确保数据库初始化
function initDatabase() {
  // 确保数据目录存在
  TwitterUtils.ensureDataDir();

  // 创建数据库连接
  const db = new Database(DB_PATH);

  // 创建已回复推文表
  db.exec(`
    CREATE TABLE IF NOT EXISTS replied_tweets (
      tweet_id TEXT PRIMARY KEY,
      author_username TEXT NOT NULL,
      reply_account TEXT NOT NULL,
      reply_time TIMESTAMP NOT NULL,
      content TEXT
    );

    CREATE TABLE IF NOT EXISTS monitor_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_username TEXT NOT NULL,
      check_time TIMESTAMP NOT NULL,
      new_tweets_count INTEGER NOT NULL,
      error TEXT
    );
  `);

  return db;
}

// 加载目标用户配置
function loadTargets(): Target[] {
  const configDir = ensureConfigDir();
  const targetsPath = path.join(configDir, "targets.json");

  // 如果配置文件不存在，创建默认配置
  if (!fs.existsSync(targetsPath)) {
    const defaultTargets: Target[] = [
      { username: "elonmusk", checkInterval: 5 },
    ];
    fs.writeFileSync(targetsPath, JSON.stringify(defaultTargets, null, 2));
    return defaultTargets;
  }

  try {
    return JSON.parse(fs.readFileSync(targetsPath, "utf-8")) as Target[];
  } catch (error) {
    console.error(chalk.red("❌ 无法加载目标用户配置:"), error);
    return [];
  }
}

// 加载账号配置
function loadAccounts(): Account[] {
  const configDir = ensureConfigDir();
  const accountsPath = path.join(configDir, "accounts.json");

  // 如果配置文件不存在，提示用户从示例文件创建
  if (!fs.existsSync(accountsPath)) {
    console.error(chalk.red("❌ 账号配置文件不存在"));
    console.log(
      chalk.yellow(`请从示例文件创建配置：
  cp ${path.join(__dirname, "config", "accounts.json.example")} ${accountsPath}
  然后编辑 ${accountsPath} 文件，配置您的Twitter账号信息`),
    );
    process.exit(1);
  }

  try {
    const accounts = JSON.parse(
      fs.readFileSync(accountsPath, "utf-8"),
    ) as Account[];

    // 验证账号配置是否完整
    for (const account of accounts) {
      if (!account.username || !account.password) {
        console.error(
          chalk.red(
            `❌ 账号配置不完整，缺少必要的用户名或密码: ${account.username || "未知账号"}`,
          ),
        );
        process.exit(1);
      }

      if (account.twoFAEnabled && !account.twoFASecret) {
        console.error(
          chalk.red(
            `❌ 账号 ${account.username} 启用了双因素认证，但未提供2FA密钥`,
          ),
        );
        process.exit(1);
      }
    }

    return accounts;
  } catch (error) {
    console.error(chalk.red("❌ 无法加载账号配置:"), error);
    return [];
  }
}

// 加载回复内容
function loadReplyContent(): ReplyContent[] {
  const configDir = ensureConfigDir();
  const repliesPath = path.join(configDir, "replies.json");

  // 如果配置文件不存在，创建默认配置
  if (!fs.existsSync(repliesPath)) {
    const defaultReplies: ReplyContent[] = [{ text: "这是一条自动回复" }];
    fs.writeFileSync(repliesPath, JSON.stringify(defaultReplies, null, 2));
    return defaultReplies;
  }

  try {
    const replies = JSON.parse(
      fs.readFileSync(repliesPath, "utf-8"),
    ) as ReplyContent[];

    // 验证所有文件路径是否存在
    return replies.map((reply) => {
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
    console.error(chalk.red("❌ 无法加载回复内容配置:"), error);
    return [{ text: "这是一条自动回复" }];
  }
}

// 检查推文是否已回复
function hasReplied(db: Database, tweetId: string): boolean {
  const stmt = db.prepare("SELECT 1 FROM replied_tweets WHERE tweet_id = ?");
  const result = stmt.get(tweetId);
  return result !== undefined;
}

// 记录已回复推文
function markReplied(db: Database, record: ReplyRecord): void {
  const stmt = db.prepare(`
    INSERT INTO replied_tweets (tweet_id, author_username, reply_account, reply_time, content)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(
    record.tweetId,
    record.accountUsername,
    record.accountUsername,
    record.timestamp,
    record.content,
  );
}

// 记录监控日志
function logMonitorActivity(
  db: Database,
  target: string,
  newTweetsCount: number,
  error?: string,
): void {
  const stmt = db.prepare(`
    INSERT INTO monitor_logs (target_username, check_time, new_tweets_count, error)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(target, new Date().toISOString(), newTweetsCount, error || null);
}

// 获取空闲账号
function getAvailableAccount(accounts: Account[]): Account | undefined {
  // 按上次使用时间排序，优先使用最久未使用的账号
  const sortedAccounts = [...accounts].sort((a, b) => {
    if (!a.lastUsed) return -1;
    if (!b.lastUsed) return 1;
    return a.lastUsed.getTime() - b.lastUsed.getTime();
  });

  return sortedAccounts[0];
}

// 更新账号状态
function updateAccountStatus(
  account: Account,
  isInUse: boolean, // 保留参数以保持兼容性，但不再使用
  wasSuccessful: boolean = true,
): void {
  // 只在操作成功时更新上次使用时间
  if (!isInUse && wasSuccessful) {
    account.lastUsed = new Date();
  }

  // 保存账号状态到配置文件
  const configDir = ensureConfigDir();
  const accountsPath = path.join(configDir, "accounts.json");
  const accounts = loadAccounts();

  const index = accounts.findIndex((a) => a.username === account.username);
  if (index !== -1) {
    accounts[index] = account;
    fs.writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));
  }
}

// 使用账号回复推文
async function replyToTweet(
  db: Database,
  tweet: Tweet,
  account: Account,
  replyContent: ReplyContent,
  page: StagehandPage, // 新增参数：接收 Page 对象
): Promise<boolean> {
  // 移除标记账号为使用中，移至调用处
  // updateAccountStatus(account, true);

  console.log(
    chalk.blue(
      `🔄 在 @${account.username} 的会话中回复推文 ID: ${tweet.id}...`,
    ),
  );

  try {
    // 移除 Stagehand 初始化和登录逻辑
    // const stagehand = new Stagehand({...});
    // await stagehand.init();
    // const page = stagehand.page;
    // ... 登录逻辑移除 ...

    // 导航到推文页面
    console.log(chalk.blue(`🔍 导航到推文页面: ${tweet.url}`));
    // 增加URL有效性检查
    if (
      !tweet.url ||
      typeof tweet.url !== "string" ||
      !tweet.url.startsWith("http")
    ) {
      console.error(chalk.red(`❌ 无效的推文URL: ${tweet.url}`));
      return false; // 返回失败
    }
    await page.goto(tweet.url);
    await page.waitForTimeout(5000);

    // 点击回复按钮
    console.log(chalk.blue(`💬 找到并点击回复按钮...`));
    // 优先使用 observe 缓存
    const replyButtonInstruction = `找到并点击这条推文的回复按钮`;
    let replyAction = null;
    try {
      [replyAction] = await page.observe(replyButtonInstruction);
      console.log(chalk.cyan(`✅ 使用 Observe 找到回复按钮`));
    } catch (observeError) {
      console.warn(
        chalk.yellow(
          `⚠️ Observe 回复按钮失败，尝试直接 Act: ${observeError.message}`,
        ),
      );
    }
    // 如果 observe 成功，使用缓存的 action，否则直接 act 指令
    if (replyAction) {
      await page.act(replyAction);
    } else {
      await page.act(replyButtonInstruction);
    }
    await page.waitForTimeout(2000);

    // 输入回复内容
    const replyText = replyContent.text || ""; // 确保有默认值
    console.log(chalk.blue(`✏️ 输入回复内容...`));
    const inputTextInstruction = `在回复框中输入文本: "${replyText}"`;
    // 这里通常不需要 observe，直接 act
    await page.act(inputTextInstruction);
    await page.waitForTimeout(2000);

    // 上传媒体文件（如果有）
    if (replyContent.image && fs.existsSync(replyContent.image)) {
      console.log(chalk.blue(`🖼️ 上传图片: ${replyContent.image}`));
      const fileInputSelector = 'input[type="file"][multiple]';
      // 确保选择器存在
      try {
        await page.waitForSelector(fileInputSelector, { timeout: 15000 });
        await page.setInputFiles(fileInputSelector, replyContent.image);
        await page.waitForTimeout(5000); // 增加等待时间
      } catch (uploadError) {
        console.error(chalk.red(`❌ 上传图片失败: ${uploadError.message}`));
        // 可以选择返回失败或继续尝试发布文本
        // return false;
      }
    } else if (replyContent.image) {
      console.warn(
        chalk.yellow(`⚠️ 图片文件不存在，跳过上传: ${replyContent.image}`),
      );
    }

    if (replyContent.video && fs.existsSync(replyContent.video)) {
      console.log(chalk.blue(`🎬 上传视频: ${replyContent.video}`));
      const fileInputSelector = 'input[type="file"][multiple]';
      try {
        await page.waitForSelector(fileInputSelector, { timeout: 20000 }); // 增加等待时间
        await page.setInputFiles(fileInputSelector, replyContent.video);
        await page.waitForTimeout(10000); // 视频上传需要更长时间
      } catch (uploadError) {
        console.error(chalk.red(`❌ 上传视频失败: ${uploadError.message}`));
        // 可以选择返回失败或继续尝试发布文本
        // return false;
      }
    } else if (replyContent.video) {
      console.warn(
        chalk.yellow(`⚠️ 视频文件不存在，跳过上传: ${replyContent.video}`),
      );
    }

    // 点击发布按钮
    console.log(chalk.blue(`📤 发布回复...`));
    const postButtonInstruction = `找到并点击标记为 "Reply", "Post", "发送" 或 "回复" 的发布按钮`;
    let postAction = null;
    try {
      [postAction] = await page.observe(postButtonInstruction);
      console.log(chalk.cyan(`✅ 使用 Observe 找到发布按钮`));
    } catch (observeError) {
      console.warn(
        chalk.yellow(
          `⚠️ Observe 发布按钮失败，尝试直接 Act: ${observeError.message}`,
        ),
      );
    }
    if (postAction) {
      await page.act(postAction);
    } else {
      await page.act(postButtonInstruction);
    }
    await page.waitForTimeout(8000); // 增加等待时间

    // 检查是否成功发布 (可以改进检查方式)
    const replySuccess = await page.evaluate(() => {
      // 检查是否有错误提示toast，或者检查回复是否出现在时间线上（更可靠但复杂）
      const errorToast = document.querySelector(
        'div[data-testid="toast"][role="alert"]',
      ); // 更精确的选择器
      // 检查URL是否跳转回用户主页或者推文页面（发布成功后可能会跳转）
      // const isBackOnProfile = window.location.pathname.includes(tweet.authorUsername);
      // const isBackOnTweet = window.location.pathname.includes(tweet.id); // 需要确保 tweet.id 存在

      // 简单的成功判断：没有错误提示
      return !errorToast;
    });

    if (replySuccess) {
      console.log(chalk.green(`✅ 成功回复推文!`));

      // 记录回复
      markReplied(db, {
        tweetId: tweet.id,
        accountUsername: account.username, // 使用传入的 account
        timestamp: new Date().toISOString(),
        content: replyText,
        targetUsername: tweet.authorUsername,
      });
      return true; // 返回成功
    } else {
      console.log(
        chalk.red(`❌ 回复推文失败! (未检测到错误提示，或发布未完成)`),
      );
      return false; // 返回失败
    }

    // 移除 stagehand.close()
    // await stagehand.close();

    // 移除更新账号状态，移至调用处
    // updateAccountStatus(account, false, replySuccess);

    // return replySuccess; // 已在上面返回
  } catch (error) {
    console.error(chalk.red(`❌ 回复过程中出错:`), error);
    // 不再需要在这里更新账号状态或关闭浏览器
    return false; // 返回失败
  }
}

// 检查用户的新推文
async function checkUserTweets(
  db: Database,
  target: Target,
  accounts: Account[],
  replyContents: ReplyContent[],
): Promise<void> {
  console.log(chalk.blue(`\n🔍 检查用户 @${target.username} 的推文...`));

  // 初始化Stagehand
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    verbose: 1,
    enableCaching: false,
    // 使用Google模型，适合结构化数据提取
    llmClient: new GoogleClient({
      logger: console.log,
      // @ts-expect-error - 环境变量类型与预期类型不匹配，但运行时会正常工作
      modelName: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      clientOptions: { apiKey: process.env.GOOGLE_API_KEY },
    }),
    systemPrompt: `你是一个帮助用户提取Twitter推文数据的助手。
      请准确提取推文的ID、内容、URL、发布时间和互动数据。
      确保提取的数据结构化且完整，这对于识别和回复新推文非常重要。`,
    localBrowserLaunchOptions: {
      headless: false, // 使用有头模式，可以看到浏览器执行过程
      // 测试代理时，在监控阶段也使用代理
      ...(accounts[0]?.proxy
        ? {
            proxy: {
              server: accounts[0].proxy.server,
              username: accounts[0].proxy.username,
              password: accounts[0].proxy.password,
              // 不需要指定 type，使用 server 中的协议前缀
            },
          }
        : {}),
    },
  });

  try {
    // 打印代理信息
    if (accounts[0]?.proxy) {
      console.log(
        chalk.blue(`🔐 监控阶段使用HTTP代理: ${accounts[0].proxy.server}`),
      );
    } else {
      console.log(chalk.yellow(`⚠️ 监控阶段未使用代理，使用直接连接`));
    }

    console.log(chalk.blue(`🌐 启动浏览器...`));
    await stagehand.init();
    const page = stagehand.page;

    // 无需登录，直接访问用户页面
    console.log(chalk.blue(`🔍 导航到用户 @${target.username} 页面...`));
    await page.goto(`https://x.com/${target.username}`);
    console.log(chalk.blue(`⏳ 等待页面加载 (15秒)...`));
    await page.waitForTimeout(15000); // 增加等待时间，确保页面完全加载

    // 提取推文
    console.log(chalk.blue(`📋 提取最新推文...`));
    const extractedData = await page.extract({
      instruction: `提取用户 @${target.username} 的最新10条推文，包括推文ID、内容、时间戳和URL`,
      schema: z.object({
        tweets: z
          .array(
            z.object({
              id: z.string().describe("推文ID"),
              content: z.string().describe("推文内容"),
              timestamp: z.string().describe("发布时间").optional(),
              url: z.string().describe("推文URL"),
            }),
          )
          .describe("推文列表"),
      }),
    });

    // 处理提取的推文
    if (extractedData?.tweets && extractedData.tweets.length > 0) {
      console.log(
        chalk.green(`✅ 成功提取 ${extractedData.tweets.length} 条推文`),
      );

      // 处理每条推文，确保所有必需字段都存在
      const allTweets = extractedData.tweets
        .filter((tweet) => tweet.id && tweet.content && tweet.url) // 确保必需字段存在
        .map((tweet) => ({
          id: tweet.id,
          content: tweet.content,
          url: tweet.url,
          timestamp: tweet.timestamp || new Date().toISOString(),
          authorUsername: target.username,
        }));

      // 打印所有推文，无论是否已经回复过
      console.log(chalk.blue(`\n📝 所有推文：`));
      allTweets.forEach((tweet, index) => {
        const isReplied = hasReplied(db, tweet.id);
        const statusIcon = isReplied ? chalk.gray(`✅`) : chalk.green(`🔔`);
        console.log(chalk.yellow(`\n推文 ${index + 1}:`));
        console.log(chalk.white(`${tweet.content}`));
        console.log(chalk.gray(`🔗 ${tweet.url}`));
        console.log(
          statusIcon +
            (isReplied ? chalk.gray(` 已回复`) : chalk.green(` 未回复`)),
        );
      });

      // 过滤出未回复的推文
      const newTweets = allTweets.filter((tweet) => !hasReplied(db, tweet.id));

      if (newTweets.length > 0) {
        console.log(chalk.green(`🔔 发现 ${newTweets.length} 条新推文!`));

        // 记录日志
        logMonitorActivity(db, target.username, newTweets.length);

        // 获取一个可用账号以进行回复
        const availableAccount = getAvailableAccount(accounts);

        if (!availableAccount) {
          console.log(chalk.yellow(`⚠️ 发现新推文，但暂无可用账号回复`));
        } else {
          console.log(
            chalk.blue(
              `🔧 准备使用账号 @${availableAccount.username} 进行回复...`,
            ),
          );
          // 标记账号为使用中（逻辑上）
          updateAccountStatus(availableAccount, true);

          // 在当前页面尝试登录此账号
          const loginSuccess = await TwitterUtils.loginAccountOnPage(
            page,
            availableAccount,
            stagehand.context, // 传递 context 用于 cookie 操作
          );

          if (loginSuccess) {
            console.log(
              chalk.green(`✅ 账号 @${availableAccount.username} 登录成功`),
            );
            // 为每条新推文创建回复任务
            for (const tweet of newTweets) {
              console.log(chalk.yellow(`\n➡️  处理新推文:`));
              console.log(chalk.white(`   ${tweet.content}`));
              console.log(chalk.gray(`   🔗 ${tweet.url}`));

              // 随机选择一条回复内容 (TODO: 集成 SmartReplySelector)
              const replyContent =
                replyContents[Math.floor(Math.random() * replyContents.length)];

              // 调用修改后的 replyToTweet
              const replyAttemptSuccess = await replyToTweet(
                db,
                tweet,
                availableAccount,
                replyContent,
                page, // 传入当前 Page 对象
              );

              // 更新账号状态（无论成功与否，标记为非使用中）
              updateAccountStatus(availableAccount, false, replyAttemptSuccess);

              if (replyAttemptSuccess) {
                console.log(
                  chalk.green(
                    `   ✅ 成功标记回复任务 for @${availableAccount.username}`,
                  ),
                );
              } else {
                console.log(
                  chalk.red(
                    `   ❌ 回复任务失败 for @${availableAccount.username}`,
                  ),
                );
                // 如果一个回复失败，可以选择中断或继续尝试下一个
                // break;
              }
              // 可以在两次回复之间加个短暂延迟
              await page.waitForTimeout(2000);
            }
          } else {
            console.log(
              chalk.red(
                `❌ 账号 @${availableAccount.username} 登录失败，无法回复`,
              ),
            );
            // 登录失败，也需要更新账号状态
            updateAccountStatus(availableAccount, false, false);
          }
        }
      } else {
        console.log(chalk.blue(`ℹ️ 没有发现新推文或所有推文都已回复`));
        // 记录日志
        logMonitorActivity(db, target.username, 0);
      }
    } else {
      console.log(chalk.yellow(`⚠️ 未能提取到推文`));
      // 记录日志
      logMonitorActivity(db, target.username, 0, "无法提取推文");
    }

    // 更新上次检查时间
    target.lastChecked = new Date();

    // 在关闭浏览器前等待一段时间，便于观察
    console.log(chalk.blue(`⏳ 等待 10 秒后关闭浏览器...`));
    await page.waitForTimeout(10000);

    // 关闭浏览器释放资源
    await stagehand.close();
  } catch (error) {
    console.error(chalk.red(`❌ 检查推文时出错:`), error);
    // 记录日志
    logMonitorActivity(db, target.username, 0, `错误: ${error.message}`);

    // 关闭浏览器
    await stagehand.close();
  }
}

// 主函数
async function monitorMultipleUsers() {
  console.log(chalk.blue(`🚀 启动Twitter多用户监控与多账号回复系统...`));

  // 初始化数据库
  const db = initDatabase();
  console.log(chalk.green(`✅ 数据库已初始化`));

  // 加载配置
  const targets = loadTargets();
  const accounts = loadAccounts();
  const replyContents = loadReplyContent();

  console.log(
    chalk.green(
      `✅ 已加载 ${targets.length} 个目标用户, ${accounts.length} 个账号, ${replyContents.length} 条回复内容`,
    ),
  );

  // 显示配置信息
  console.log(chalk.blue(`\n📋 监控目标:`));
  targets.forEach((target) => {
    console.log(
      chalk.white(
        `  - @${target.username} (每 ${target.checkInterval} 分钟检查一次)`,
      ),
    );
  });

  console.log(chalk.blue(`\n👤 回复账号:`));
  accounts.forEach((account) => {
    const proxyInfo = account.proxy
      ? chalk.cyan(`代理: ${account.proxy.server}`)
      : chalk.gray("不使用代理");
    console.log(
      chalk.white(
        `  - @${account.username} (2FA: ${account.twoFAEnabled ? "启用" : "禁用"}) ${proxyInfo}`,
      ),
    );
  });

  // 检查配置完整性
  if (targets.length === 0) {
    console.error(
      chalk.red(`❌ 没有配置监控目标，请在examples/config/targets.json中配置`),
    );
    process.exit(1);
  }

  if (accounts.length === 0) {
    console.error(
      chalk.red(`❌ 没有配置回复账号，请在examples/config/accounts.json中配置`),
    );
    process.exit(1);
  }

  if (replyContents.length === 0) {
    console.error(
      chalk.red(`❌ 没有配置回复内容，请在examples/config/replies.json中配置`),
    );
    process.exit(1);
  }

  // 只运行一次检查，而不是持续监控
  console.log(chalk.blue(`🔔 只运行一次检查，而不是持续监控`));
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    console.log(chalk.green(`✅ 开始检查 @${target.username} 的推文`));
    await checkUserTweets(db, target, accounts, replyContents);
    // 在每个目标用户之间添加分隔线
    if (i < targets.length - 1) {
      console.log(chalk.blue(`\n${"=".repeat(50)}\n`));
    }
  }

  // 处理退出信号
  process.on("SIGINT", async () => {
    console.log(chalk.yellow(`\n⚠️ 收到退出信号，正在清理资源...`));

    // 关闭数据库连接
    db.close();

    console.log(chalk.green(`✅ 资源已清理，监控已停止`));
    process.exit(0);
  });
}

// 执行主函数
(async () => {
  await monitorMultipleUsers();
})();
