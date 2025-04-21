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
  // 新增账号健康状态字段
  healthStatus?: {
    score: number; // 0-100分，代表账号健康状态，越高越健康
    cooldownUntil?: Date; // 冷却时间，在此时间前不应使用此账号
    consecutiveFailures: number; // 连续失败次数
    consecutiveSuccesses: number; // 连续成功次数
    lastErrorMessage?: string; // 最后一次错误信息
    lastStatusCheckTime?: Date; // 最后一次状态检查时间
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

// 初始化账号健康状态
function initAccountHealthStatus(account: Account): Account {
  if (!account.healthStatus) {
    account.healthStatus = {
      score: 100, // 初始满分
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastStatusCheckTime: new Date(),
    };
  }
  return account;
}

// 更新账号状态（增强版）
function updateAccountStatus(
  account: Account,
  isInUse: boolean, // 保留参数以保持兼容性
  wasSuccessful: boolean = true,
  errorMessage?: string,
): void {
  // 初始化健康状态
  account = initAccountHealthStatus(account);
  
  // 只在操作成功时更新上次使用时间
  if (!isInUse) {
    account.lastUsed = new Date();
    
    // 更新健康状态
    if (wasSuccessful) {
      // 成功操作
      account.healthStatus.consecutiveSuccesses++;
      account.healthStatus.consecutiveFailures = 0;
      
      // 提高健康分数（最高100）
      account.healthStatus.score = Math.min(100, account.healthStatus.score + 5);
      
      // 成功后清除冷却时间
      account.healthStatus.cooldownUntil = undefined;
    } else {
      // 失败操作
      account.healthStatus.consecutiveFailures++;
      account.healthStatus.consecutiveSuccesses = 0;
      account.healthStatus.lastErrorMessage = errorMessage;
      
      // 降低健康分数（最低0）
      account.healthStatus.score = Math.max(0, account.healthStatus.score - 10);
      
      // 根据连续失败次数设置不同的冷却时间
      const cooldownMinutes = Math.min(360, Math.pow(2, account.healthStatus.consecutiveFailures) * 5);
      const cooldownUntil = new Date();
      cooldownUntil.setMinutes(cooldownUntil.getMinutes() + cooldownMinutes);
      account.healthStatus.cooldownUntil = cooldownUntil;
      
      console.log(chalk.yellow(
        `⚠️ 账号 @${account.username} 操作失败，设置 ${cooldownMinutes} 分钟冷却时间，当前健康分数: ${account.healthStatus.score}`,
      ));
    }
    
    // 更新状态检查时间
    account.healthStatus.lastStatusCheckTime = new Date();
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

// 获取最优账号（智能轮询系统）
function getOptimalAccount(accounts: Account[]): Account | undefined {
  if (accounts.length === 0) return undefined;
  
  // 确保所有账号都有健康状态
  const accountsWithHealth = accounts.map(initAccountHealthStatus);
  
  // 过滤掉处于冷却期的账号
  const now = new Date();
  const availableAccounts = accountsWithHealth.filter(account => {
    if (account.healthStatus?.cooldownUntil && account.healthStatus.cooldownUntil > now) {
      const cooldownMinutes = Math.round((account.healthStatus.cooldownUntil.getTime() - now.getTime()) / 60000);
      console.log(chalk.gray(`ℹ️ 账号 @${account.username} 在冷却期内，还剩 ${cooldownMinutes} 分钟`));
      return false;
    }
    return true;
  });
  
  if (availableAccounts.length === 0) {
    console.log(chalk.yellow(`⚠️ 所有账号都在冷却期内，尝试使用最快恢复的账号`));
    // 如果所有账号都在冷却期，选择冷却时间最短的账号
    return accounts.sort((a, b) => {
      const timeA = a.healthStatus?.cooldownUntil?.getTime() || 0;
      const timeB = b.healthStatus?.cooldownUntil?.getTime() || 0;
      return timeA - timeB;
    })[0];
  }
  
  // 按优先级排序：
  // 1. 健康分数高的优先
  // 2. 健康分数相同时，最久未使用的优先
  const sortedAccounts = availableAccounts.sort((a, b) => {
    // 首先比较健康分数（降序）
    const scoreA = a.healthStatus?.score || 0;
    const scoreB = b.healthStatus?.score || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    
    // 健康分数相同，比较上次使用时间（升序）
    const timeA = a.lastUsed?.getTime() || 0;
    const timeB = b.lastUsed?.getTime() || 0;
    return timeA - timeB;
  });
  
  const selected = sortedAccounts[0];
  console.log(chalk.blue(
    `📊 选择了健康分数为 ${selected.healthStatus?.score} 的账号 @${selected.username}${
      selected.proxy ? " (使用代理)" : ""
    }`,
  ));
  
  return selected;
}

// 智能延迟函数：随机化等待时间，模拟人类行为
async function smartDelay(page: StagehandPage, minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(minMs + Math.random() * (maxMs - minMs));
  console.log(chalk.gray(`⏱️ 等待 ${delay}ms...`));
  await page.waitForTimeout(delay);
}

// 使用账号回复推文
async function replyToTweet(
  db: Database,
  tweet: Tweet,
  account: Account,
  replyContent: ReplyContent,
  page: StagehandPage, // 新增参数：接收 Page 对象
): Promise<boolean> {
  console.log(
    chalk.blue(
      `\n======================= 回复流程开始 =======================`,
    ),
  );
  console.log(
    chalk.blue(
      `🔄 在 @${account.username} 的会话中回复推文 ID: ${tweet.id}...`,
    ),
  );
  console.log(chalk.blue(`📌 原始推文URL: ${tweet.url}`));
  console.log(chalk.blue(`📌 回复内容: "${replyContent.text}"`));

  try {
    // 确保账号已登录
    const loggedIn = await ensureLoggedIn(page, account);
    if (!loggedIn) {
      console.log(chalk.red(`❌ 无法确保账号 @${account.username} 处于登录状态，中止回复操作`));
      updateAccountStatus(account, false, false, "登录状态检查失败");
      return false;
    }
    
    // 添加随机化的延迟，模拟人类行为
    await smartDelay(page, 1000, 3000);
    
    // 导航到推文页面
    console.log(chalk.blue(`🔍 导航到推文页面: ${tweet.url}`));
    // 增加URL有效性检查并尝试构建URL
    if (
      !tweet.url ||
      typeof tweet.url !== "string" ||
      !tweet.url.startsWith("http")
    ) {
      // 如果有推文ID但URL无效，尝试构建URL
      if (tweet.id && tweet.id !== "NOT_EXTRACTABLE_FROM_DOM") {
        tweet.url = `https://twitter.com/${tweet.authorUsername}/status/${tweet.id}`;
        console.log(chalk.yellow(`⚠️ URL无效，已自动构建新URL: ${tweet.url}`));
      } else {
        console.error(chalk.red(`❌ 无效的推文URL，无法构建: ${tweet.url}`));
        console.log(
          chalk.blue(
            `======================= 回复流程结束 =======================\n`,
          ),
        );
        return false; // 返回失败
      }
    }

    console.log(chalk.blue(`🌐 即将打开页面: ${tweet.url}`));
    await page.goto(tweet.url);
    console.log(chalk.blue(`✅ 页面已加载，等待5秒`));
    await page.waitForTimeout(5000);

    // 获取当前URL，检查是否成功导航
    const currentUrl = page.url();
    console.log(chalk.blue(`📍 当前页面URL: ${currentUrl}`));
    if (
      currentUrl.includes("twitter.com/login") ||
      currentUrl.includes("x.com/login")
    ) {
      console.log(
        chalk.red(`❌ 导航失败：被重定向到登录页面，可能需要重新登录`),
      );
      return false;
    }

    // 确保是在推文详情页面，而不是在用户个人页或时间线页面
    if (!currentUrl.includes("/status/")) {
      console.log(
        chalk.red(`❌ 导航失败：当前页面不是推文详情页面: ${currentUrl}`),
      );
      return false;
    }

    // 点击回复按钮 - 使用更精确的指令和选择器
    console.log(chalk.blue(`💬 找到并点击回复按钮...`));

    // 首先尝试使用更精确的CSS选择器直接找到回复按钮
    const replyButtonSelector = '[data-testid="reply"]';
    let replyButtonFound = false;

    try {
      // 检查回复按钮是否存在
      replyButtonFound = await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        return !!button;
      }, replyButtonSelector);

      if (replyButtonFound) {
        console.log(chalk.green(`✅ 使用CSS选择器找到回复按钮`));
        await page.click(replyButtonSelector);
      } else {
        // 如果直接选择器不起作用，尝试通过观察和语义查找
        console.log(
          chalk.yellow(`⚠️ 通过选择器未找到回复按钮，尝试使用Observe`),
        );

        // 更新回复按钮指令，使其更加精确
        const replyButtonInstruction = `找到并点击当前推文的回复按钮。这个按钮通常在推文底部，有一个回复图标（类似气泡或对话框的图标），有时标记为"Reply"或"回复"。不要点击导航栏上的任何按钮，只关注当前推文的回复按钮。`;

        try {
          const [replyAction] = await page.observe(replyButtonInstruction);
          console.log(
            chalk.cyan(
              `✅ 使用 Observe 找到回复按钮: ${replyAction.description}`,
            ),
          );
          await page.act(replyAction);
        } catch (observeError) {
          console.warn(
            chalk.yellow(
              `⚠️ Observe 回复按钮失败，尝试直接 Act: ${observeError.message}`,
            ),
          );
          await page.act(replyButtonInstruction);
        }
      }
    } catch (clickError) {
      console.error(chalk.red(`❌ 点击回复按钮时出错: ${clickError.message}`));
      return false;
    }

    console.log(chalk.blue(`⏳ 等待回复框加载 (最多10秒)...`));
    await page.waitForTimeout(3000);

    // 检查回复框是否出现 - 更严格的检测
    const replyBoxVisible = await page.evaluate(() => {
      const possibleReplyBoxes = [
        document.querySelector('[data-testid="tweetTextarea_0"]'),
        document.querySelector('[role="textbox"][contenteditable="true"]'),
      ];

      // 检查是否有"回复"或"Reply to"文本提示，这通常表示在回复模式
      const replyingToIndicators = Array.from(
        document.querySelectorAll("div, span"),
      ).filter((el) => {
        const text = el.textContent || "";
        return (
          text.includes("Replying to") ||
          text.includes("回复") ||
          text.includes("正在回复")
        );
      });

      return {
        hasReplyBox: possibleReplyBoxes.some((element) => element !== null),
        hasReplyIndicator: replyingToIndicators.length > 0,
      };
    });

    // 打印更详细的诊断信息
    if (replyBoxVisible.hasReplyBox && replyBoxVisible.hasReplyIndicator) {
      console.log(chalk.green(`✅ 回复框已出现，且确认在回复模式`));
    } else if (replyBoxVisible.hasReplyBox) {
      console.log(chalk.yellow(`⚠️ 找到回复框，但未确认是否在回复模式`));
    } else {
      console.log(chalk.red(`❌ 回复框未出现，点击回复按钮可能失败`));
      return false; // 如果回复框未出现，直接返回失败
    }

    // 检查当前URL，确保不是在创建新推文
    const currentUrlAfterClick = page.url();
    if (currentUrlAfterClick.includes("/compose/")) {
      console.log(chalk.red(`❌ 错误: 当前在新推文创建页面，而不是回复原推文`));
      return false;
    }

    // 输入回复内容
    const replyText = replyContent.text || ""; // 确保有默认值
    console.log(chalk.blue(`✏️ 输入回复内容: "${replyText}"`));

    try {
      // 尝试直接使用选择器找到文本框并填充
      const textboxSelector = '[data-testid="tweetTextarea_0"]';
      const textboxExists = await page.evaluate((selector) => {
        return !!document.querySelector(selector);
      }, textboxSelector);

      if (textboxExists) {
        console.log(chalk.green(`✅ 使用选择器找到文本框并填充内容`));
        await page.fill(textboxSelector, replyText);
      } else {
        // 备用方案：使用act指令
        console.log(chalk.yellow(`⚠️ 未找到文本框选择器，使用act指令`));
        const inputTextInstruction = `在回复框中输入文本: "${replyText}"`;
        await page.act(inputTextInstruction);
      }
    } catch (inputError) {
      console.error(chalk.red(`❌ 输入文本时出错: ${inputError.message}`));
      // 继续尝试，不要立即返回失败
    }

    console.log(chalk.blue(`⏳ 等待2秒，确保文本输入完成`));
    await page.waitForTimeout(2000);

    // 检查文本是否成功输入
    const textInputSuccess = await page.evaluate((expectedText) => {
      const possibleTextboxes = [
        document.querySelector('[data-testid="tweetTextarea_0"]'),
        document.querySelector('[role="textbox"][contenteditable="true"]'),
      ];
      for (const box of possibleTextboxes) {
        if (
          box &&
          (box.textContent?.includes(expectedText) ||
            (box as HTMLInputElement).value?.includes(expectedText))
        ) {
          return true;
        }
      }
      return false;
    }, replyText);

    console.log(
      textInputSuccess
        ? chalk.green(`✅ 文本已成功输入`)
        : chalk.yellow(`⚠️ 无法确认文本是否成功输入，继续执行`),
    );

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

    // 点击发布按钮 - 使用更精确的指令和选择器
    console.log(chalk.blue(`📤 发布回复...`));

    // 首先尝试使用精确的CSS选择器找到回复按钮
    const replyPostButtonSelector = '[data-testid="tweetButton"]';
    let replyPostButtonFound = false;

    try {
      // 检查回复按钮是否存在
      replyPostButtonFound = await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        return !!button && !button.hasAttribute("disabled");
      }, replyPostButtonSelector);

      if (replyPostButtonFound) {
        console.log(chalk.green(`✅ 使用CSS选择器找到发布按钮`));
        await page.click(replyPostButtonSelector);
      } else {
        // 更精确的发布按钮指令
        const postButtonInstruction = `找到并点击回复框下方的回复发布按钮，通常标记为"Reply"、"Post"、"发送"或"回复"。这个按钮应该在回复文本框的下方或右侧，不是在导航栏上。仅点击与当前回复操作相关的按钮。`;

        try {
          const [postAction] = await page.observe(postButtonInstruction);
          // 检查是否找到了正确的按钮 (不是顶部导航栏的Post按钮)
          if (
            postAction.description &&
            (postAction.description.toLowerCase().includes("header") ||
              postAction.description.toLowerCase().includes("navigation"))
          ) {
            console.log(
              chalk.red(
                `❌ 找到的按钮可能是导航栏上的按钮，而不是回复按钮: ${postAction.description}`,
              ),
            );
            return false;
          }

          console.log(
            chalk.cyan(
              `✅ 使用 Observe 找到发布按钮: ${postAction.description}`,
            ),
          );
          await page.act(postAction);
        } catch (observeError) {
          console.warn(
            chalk.yellow(
              `⚠️ Observe 发布按钮失败，尝试直接 Act: ${observeError.message}`,
            ),
          );
          await page.act(postButtonInstruction);
        }
      }
    } catch (clickError) {
      console.error(chalk.red(`❌ 点击发布按钮时出错: ${clickError.message}`));
      return false;
    }

    console.log(chalk.blue(`⏳ 等待回复发布完成 (最多15秒)...`));
    await page.waitForTimeout(8000); // 增加等待时间

    // 检查是否导航到了新推文创建页面，这表示操作失败
    const urlAfterSubmit = page.url();
    if (urlAfterSubmit.includes("/compose/")) {
      console.log(
        chalk.red(`❌ 操作失败: 当前在新推文创建页面，而不是回复原推文`),
      );
      return false;
    }

    // 检查是否成功发布 (改进检查方式)
    console.log(chalk.blue(`🔍 检查回复是否成功发布...`));
    const replySuccess = await page.evaluate(() => {
      // 检查是否有错误提示toast
      const errorToast = document.querySelector(
        'div[data-testid="toast"][role="alert"]',
      );
      console.log("Debug: 错误提示存在:", !!errorToast);

      // 检查是否有"已发送"或"已回复"的成功提示
      const successElements = document.querySelectorAll('div[role="status"]');
      let hasSuccessMessage = false;
      successElements.forEach((el) => {
        if (
          el.textContent?.includes("发送") ||
          el.textContent?.includes("回复") ||
          el.textContent?.includes("sent") ||
          el.textContent?.includes("replied") ||
          el.textContent?.includes("Your reply was sent")
        ) {
          hasSuccessMessage = true;
        }
      });
      console.log("Debug: 成功提示存在:", hasSuccessMessage);

      // 检查页面状态，看是否回到了原始推文页面且回复框消失
      const replyBoxGone = !document.querySelector(
        '[data-testid="tweetTextarea_0"]',
      );
      console.log("Debug: 回复框已消失:", replyBoxGone);

      // 综合判断是否成功
      return !errorToast && (hasSuccessMessage || replyBoxGone);
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
      console.log(
        chalk.blue(
          `======================= 回复流程结束 =======================\n`,
        ),
      );
      return true; // 返回成功
    } else {
      console.log(
        chalk.red(`❌ 回复推文失败! (未检测到成功提示或回复框仍然可见)`),
      );

      // 尝试截图操作（如果有该功能）
      try {
        const screenshotPath = path.join(
          process.cwd(),
          "data",
          `reply_failed_${new Date().getTime()}.png`,
        );
        await page.screenshot({ path: screenshotPath });
        console.log(chalk.yellow(`📸 已保存失败状态截图: ${screenshotPath}`));
      } catch (screenshotError) {
        console.log(
          chalk.yellow(`📸 无法保存截图: ${screenshotError.message}`),
        );
      }

      console.log(
        chalk.blue(
          `======================= 回复流程结束 =======================\n`,
        ),
      );
      return false; // 返回失败
    }
  } catch (error) {
    console.error(chalk.red(`❌ 回复过程中出错:`), error);
    console.log(
      chalk.blue(
        `======================= 回复流程结束 =======================\n`,
      ),
    );
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

  // 选择最优账号进行监控
  const monitorAccount = getOptimalAccount(accounts);
  
  if (!monitorAccount) {
    console.log(chalk.red(`❌ 没有可用账号来监控 @${target.username}`));
    return;
  }
  
  console.log(chalk.blue(`👤 使用账号 @${monitorAccount.username} 进行监控`));

  // 设置代理 (如果有)
  if (monitorAccount.proxy) {
    console.log(
      chalk.blue(`🔐 监控阶段使用HTTP代理: ${monitorAccount.proxy.server}`),
    );
  }

  // 初始化Stagehand
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    verbose: 1,
    enableCaching: false,
    // 使用Google模型，适合结构化数据提取
    extract: {
      model: "gemini-2.5-flash-preview-04-17", // 也可以切换到更高级的模型
    },
    // 使用代理 (如果有)
    proxy: monitorAccount.proxy?.server,
  });

  await stagehand.init();
  const page = stagehand.page;

  try {
    console.log(chalk.blue(`🌐 启动浏览器...`));

    // 为监控账号加载Cookie (如果有)
    const cookieLoaded = await TwitterUtils.loadCookiesForAccount(
      stagehand.context,
      monitorAccount,
    );

    if (cookieLoaded) {
      console.log(chalk.green(`✅ 使用Cookie成功登录!`));
    } else {
      // 尝试正常登录
      console.log(chalk.blue(`🔑 Cookie加载失败，尝试正常登录...`));
      const loginSuccess = await TwitterUtils.loginAccountOnPage(
        page,
        monitorAccount,
        stagehand.context,
      );

      if (!loginSuccess) {
        console.log(
          chalk.red(
            `❌ 账号 @${monitorAccount.username} 登录失败，无法执行监控`,
          ),
        );
        // 记录账号健康状态
        updateAccountStatus(monitorAccount, false, false, "登录失败");
        await stagehand.close();
        return;
      }
      
      // 登录成功，保存Cookie
      await TwitterUtils.saveCookiesForAccount(stagehand.context, monitorAccount);
    }
    
    // 确保账号已登录
    const loggedIn = await ensureLoggedIn(page, monitorAccount);
    if (!loggedIn) {
      console.log(chalk.red(`❌ 无法确保账号处于登录状态，中止监控`));
      updateAccountStatus(monitorAccount, false, false, "登录状态检查失败");
      await stagehand.close();
      return;
    }

    // 访问用户页面
    console.log(chalk.blue(`🔍 导航到用户 @${target.username} 页面...`));
    await page.goto(`https://x.com/${target.username}`);

    // 等待推文时间线或第一个推文元素加载
    const timelineSelector =
      '[data-testid="primaryColumn"] section[role="region"]';
    const firstTweetSelector = `${timelineSelector} [data-testid="tweet"]`;
    console.log(chalk.blue(`⏳ 等待推文时间线加载 (最多30秒)...`));
    try {
      await page.waitForSelector(firstTweetSelector, { timeout: 30000 });
      console.log(chalk.cyan(`✅ 推文时间线已加载`));
    } catch {
      console.warn(
        chalk.yellow(`⚠️ 等待推文加载超时，可能页面未完全加载或无推文`),
      );
      // 即使超时，也继续尝试提取，可能页面结构不同或有其他问题
    }

    // 提取推文
    console.log(chalk.blue(`📋 提取最新推文...`));
    const extractedData = await page.extract({
      instruction: `提取用户 @${target.username} 主时间线上第一个可见推文的详细信息。
特别注意：
1. 推文ID必须是数字字符串，可以从URL或元素属性中提取，例如从URL路径 twitter.com/username/status/1234567890 中提取ID '1234567890'
2. 完整的推文URL必须以 'https://twitter.com/' 或 'https://x.com/' 开头，且包含 '/status/' 路径和推文ID。如推文URL难以直接提取，可以从推文ID构建：'https://twitter.com/${target.username}/status/[推文ID]'
3. 如果从DOM中无法提取到完整的URL但找到了ID，请构建URL: 'https://twitter.com/${target.username}/status/[推文ID]'`,
      schema: z.object({
        tweets: z
          .array(
            z.object({
              id: z
                .string()
                .describe(
                  "推文的唯一标识符，通常是以数字组成的推文ID，例如 '1234567890'",
                ),
              content: z.string().describe("推文的文本内容"),
              timestamp: z
                .string()
                .describe("推文的发布时间戳或相对时间 (例如 'Apr 19', '16h')")
                .optional(),
              url: z
                .string()
                .describe(
                  "推文的完整URL (以'https://twitter.com/'或'https://x.com/'开头，包含'/status/'和推文ID)。如无法直接提取，请构建 'https://twitter.com/用户名/status/推文ID'",
                ),
            }),
          )
          .describe("包含推文对象的数组"),
      }),
    });

    // 处理提取的推文
    if (extractedData?.tweets && extractedData.tweets.length > 0) {
      console.log(
        chalk.green(`✅ 成功提取 ${extractedData.tweets.length} 条推文`),
      );

      // 处理每条推文，确保所有必需字段都存在，并修复无效的URL
      const allTweets = extractedData.tweets
        .filter((tweet) => tweet.id && tweet.content) // 只需要确保ID和内容存在
        .map((tweet) => {
          // 检查URL是否有效，如果无效但有ID，则构建一个有效的URL
          let url = tweet.url;
          if (
            !url ||
            url === "NOT_EXTRACTABLE_FROM_DOM" ||
            !url.startsWith("http")
          ) {
            if (tweet.id && tweet.id !== "NOT_EXTRACTABLE_FROM_DOM") {
              url = `https://twitter.com/${target.username}/status/${tweet.id}`;
              console.log(chalk.yellow(`⚠️ URL无效，已自动构建新URL: ${url}`));
            } else {
              url = ""; // 如果ID也无效，则设为空字符串
            }
          }

          return {
            id: tweet.id,
            content: tweet.content,
            url: url,
            timestamp: tweet.timestamp || new Date().toISOString(),
            authorUsername: target.username,
          };
        })
        // 再次过滤掉URL为空的记录
        .filter((tweet) => tweet.url);

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

        // 准备回复操作 - 智能选择多个账号进行回复
        for (const tweet of newTweets) {
          console.log(chalk.yellow(`\n➡️  处理新推文:`));
          console.log(chalk.white(`   ${tweet.content}`));
          console.log(chalk.gray(`   🔗 ${tweet.url}`));

          // 为每条推文选择一个最优账号进行回复
          const replyAccount = getOptimalAccount(accounts);
          
          if (!replyAccount) {
            console.log(chalk.yellow(`⚠️ 没有可用账号来回复推文`));
            continue;
          }
          
          console.log(
            chalk.blue(
              `🔧 准备使用账号 @${replyAccount.username} 进行回复...`,
            ),
          );
          
          // 登录回复账号（如果与监控账号不同）
          let loginSuccess = true;
          if (replyAccount.username !== monitorAccount.username) {
            loginSuccess = await TwitterUtils.loginAccountOnPage(
              page,
              replyAccount,
              stagehand.context, // 传递 context 用于 cookie 操作
            );
          }

          if (loginSuccess) {
            console.log(
              chalk.green(`✅ 账号 @${replyAccount.username} 准备就绪`),
            );
            
            // 随机选择一条回复内容 
            const replyContent =
              replyContents[Math.floor(Math.random() * replyContents.length)];

            // 在回复前添加随机延迟，更像人类行为
            await smartDelay(page, 3000, 8000);
            
            // 调用回复函数
            const replyAttemptSuccess = await replyToTweet(
              db,
              tweet,
              replyAccount,
              replyContent,
              page, // 传入当前 Page 对象
            );

            // 更新账号状态（无论成功与否）
            updateAccountStatus(
              replyAccount, 
              false, 
              replyAttemptSuccess, 
              replyAttemptSuccess ? undefined : "回复失败"
            );

            if (replyAttemptSuccess) {
              console.log(
                chalk.green(
                  `   ✅ 成功回复推文 by @${replyAccount.username}`,
                ),
              );
            } else {
              console.log(
                chalk.red(
                  `   ❌ 回复任务失败 for @${replyAccount.username}`,
                ),
              );
            }
            
            // 在两次回复操作之间添加较长延迟，避免被Twitter检测到自动操作
            if (newTweets.length > 1) {
              await smartDelay(page, 10000, 20000);
            }
          } else {
            console.log(
              chalk.red(
                `❌ 账号 @${replyAccount.username} 登录失败，无法回复`,
              ),
            );
            // 登录失败，降低账号健康分数
            updateAccountStatus(replyAccount, false, false, "登录失败");
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

    // 更新账号健康状态
    updateAccountStatus(monitorAccount, false, false, `监控错误: ${error.message}`);
    
    // 关闭浏览器
    await stagehand.close();
  }
}

// 处理登录状态检查及自动恢复
async function ensureLoggedIn(page: StagehandPage, account: Account): Promise<boolean> {
  // 获取当前URL
  const currentUrl = page.url();
  
  // 检查是否在登录页面
  if (currentUrl.includes("/login") || currentUrl.includes("/i/flow/login")) {
    console.log(chalk.yellow(
      `⚠️ 检测到登录页面，账号 @${account.username} 的登录状态已失效，尝试重新登录`,
    ));
    
    // 尝试重新登录
    try {
      const loginSuccess = await TwitterUtils.loginAccountOnPage(
        page,
        account,
        page.context(),
      );
      
      if (loginSuccess) {
        console.log(chalk.green(`✅ 账号 @${account.username} 重新登录成功`));
        return true;
      } else {
        console.log(chalk.red(`❌ 账号 @${account.username} 重新登录失败`));
        // 登录失败，降低账号健康分数
        updateAccountStatus(account, false, false, "登录失败");
        return false;
      }
    } catch (error) {
      console.error(chalk.red(`❌ 重新登录过程中出错:`), error);
      updateAccountStatus(account, false, false, `登录错误: ${error.message}`);
      return false;
    }
  }
  
  // 不在登录页面，检查是否有活跃会话
  try {
    // 检查是否有用户菜单或个人资料图标，这通常表示已登录
    const isLoggedIn = await page.evaluate(() => {
      const userMenu = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
      const accountSwitcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
      return !!userMenu || !!accountSwitcher;
    });
    
    if (isLoggedIn) {
      console.log(chalk.green(`✅ 账号 @${account.username} 已处于登录状态`));
      return true;
    } else {
      console.log(chalk.yellow(`⚠️ 未检测到登录状态指标，可能未登录或页面结构变化`));
      // 导航到首页检查
      await page.goto("https://twitter.com/home");
      
      // 再次检查URL是否被重定向到登录页
      const newUrl = page.url();
      if (newUrl.includes("/login") || newUrl.includes("/i/flow/login")) {
        console.log(chalk.yellow(`⚠️ 被重定向到登录页面，尝试重新登录`));
        return await ensureLoggedIn(page, account); // 递归调用
      }
      
      return true; // 假设现在已登录
    }
  } catch (error) {
    console.error(chalk.red(`❌ 检查登录状态时出错:`), error);
    return false;
  }
}

// 拓展TwitterUtils，添加账号专用Cookie管理功能
namespace TwitterUtils {
  // 为特定账号加载Cookie
  export async function loadCookiesForAccount(
    context: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addCookies: (cookies: any[]) => Promise<void>;
    },
    account: Account,
  ): Promise<boolean> {
    // 首先尝试加载账号专用的Cookie文件
    const accountCookiePath = path.join(
      process.cwd(),
      `twitter-cookies-${account.username}.json`,
    );
    
    // 如果找不到账号专用Cookie，尝试通用Cookie
    const generalCookiePath = path.join(process.cwd(), "twitter-cookies.json");
    
    if (fs.existsSync(accountCookiePath)) {
      console.log(chalk.blue(`🍪 尝试使用 ${account.username} 的Cookie登录...`));
      const storage = JSON.parse(fs.readFileSync(accountCookiePath, "utf-8"));
      try {
        await context.addCookies(storage.cookies);
        return true;
      } catch (error) {
        console.warn(chalk.yellow(`⚠️ 加载账号专用Cookie失败: ${error.message}`));
        return false;
      }
    } else if (fs.existsSync(generalCookiePath)) {
      console.log(chalk.blue(`🍪 未找到账号专用Cookie，尝试使用通用Cookie...`));
      const storage = JSON.parse(fs.readFileSync(generalCookiePath, "utf-8"));
      try {
        await context.addCookies(storage.cookies);
        return true;
      } catch (error) {
        console.warn(chalk.yellow(`⚠️ 加载通用Cookie失败: ${error.message}`));
        return false;
      }
    }
    
    console.log(chalk.yellow(`⚠️ 未找到Cookie文件，需要登录`));
    return false;
  }
  
  // 为特定账号保存Cookie
  export async function saveCookiesForAccount(
    context: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      storageState: (options: { path: string }) => Promise<any>;
    },
    account: Account,
  ): Promise<boolean> {
    const accountCookiePath = path.join(
      process.cwd(),
      `twitter-cookies-${account.username}.json`,
    );
    
    try {
      await context.storageState({ path: accountCookiePath });
      console.log(chalk.green(`✅ 已保存 ${account.username} 的Cookie`));
      return true;
    } catch (error) {
      console.warn(chalk.yellow(`⚠️ 保存Cookie失败: ${error.message}`));
      return false;
    }
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
