/**
 * Twitter自动化脚本 - 自动登录Twitter并浏览用户推文
 *
 * 使用方法:
 * 1. 确保已在.env文件中设置所有必要的环境变量
 * 2. 运行: npm run twitter-auto -- --target=目标用户名
 */

import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import { z } from "zod";
import chalk from "chalk";
import { GoogleClient } from "@/lib/llm/GoogleClient";
import * as dotenv from "dotenv";
import { authenticator } from "otplib";

// 加载环境变量
dotenv.config();

// 从环境变量和命令行参数中获取登录凭据和目标用户
function getArgs() {
  const args = process.argv.slice(2);

  // 从环境变量中获取登录凭据
  const username = process.env.TWITTER_USERNAME;
  const password = process.env.TWITTER_PASSWORD;

  // 从命令行参数或默认值获取目标用户
  const target =
    args.find((arg) => arg.startsWith("--target="))?.split("=")[1] ||
    "elonmusk"; // 默认浏览Elon Musk的推文

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

  return { username, password, target, twoFAEnabled, twoFASecret };
}

async function twitterAutomation() {
  const { username, password, target, twoFAEnabled, twoFASecret } = getArgs();

  console.log(chalk.blue("🚀 初始化Twitter自动化..."));

  // 初始化Stagehand
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    verbose: 1,
    enableCaching: false,
    // 使用Google的Gemini模型
    llmClient: new GoogleClient({
      logger: console.log,
      // @ts-expect-error - 环境变量类型与预期类型不匹配，但运行时会正常工作
      modelName: process.env.GEMINI_MODEL || "gemini-1.5-pro", // 从环境变量中读取模型名称，如果未设置则使用默认值
      clientOptions: {
        apiKey: process.env.GOOGLE_API_KEY,
      },
    }),
    // 设置系统提示，指导模型如何处理Twitter交互
    systemPrompt: `你是一个帮助用户浏览Twitter的助手。
      请按照用户的指示执行操作，不要询问后续问题。
      当浏览推文时，请提取推文的内容、发布时间和互动数据（点赞、转发、评论数）。`,
    localBrowserLaunchOptions: {
      headless: false, // 设置为false使用有头浏览器，便于观察和可能的手动干预
    },
  });

  try {
    console.log(chalk.blue("🌐 启动浏览器..."));
    await stagehand.init();
    const page = stagehand.page;

    // 创建一个agent来处理复杂的交互
    // 注意：由于我们使用的是Gemini模型，我们将使用基本的act和extract方法
    // 而不是使用agent，因为Gemini目前不支持computer-use模型

    // 注意：Stagehand不直接支持setSystemPrompt方法，我们在初始化Stagehand时设置系统提示

    // 1. 导航到Twitter登录页面
    console.log(chalk.blue("🔍 导航到Twitter登录页面..."));
    await page.goto("https://twitter.com/login");

    // 2. 使用Playwright直接处理登录流程
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
        .catch((error) =>
          console.log(chalk.yellow(`⚠️ 页面导航超时: ${error.message}`)),
        );

      // 检查是否成功登录
      const currentUrl = await page.url();
      if (
        currentUrl.includes("twitter.com/home") ||
        currentUrl.includes("x.com/home")
      ) {
        console.log(chalk.green("✅ 登录成功!"));
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
      }
    }

    // 3. 导航到目标用户的Twitter页面
    console.log(chalk.blue(`🔍 导航到用户 @${target} 的Twitter页面...`));
    await page.goto(`https://x.com/${target}`);

    // 4. 提取用户信息
    console.log(chalk.blue("📊 提取用户信息..."));
    console.log(chalk.blue(`🔍 当前页面URL: ${await page.url()}`));
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

    console.log(chalk.green("用户信息:"));
    console.log(
      chalk.cyan(`📝 名称: ${userInfo.displayName} (@${userInfo.username})`),
    );
    if (userInfo.bio) console.log(chalk.cyan(`📝 简介: ${userInfo.bio}`));
    if (userInfo.followersCount)
      console.log(chalk.cyan(`👥 粉丝: ${userInfo.followersCount}`));
    if (userInfo.followingCount)
      console.log(chalk.cyan(`👥 关注: ${userInfo.followingCount}`));

    // 5. 提取最新推文
    console.log(chalk.blue("📜 提取最新推文..."));
    try {
      const tweets = await page.extract({
        instruction: `提取用户 @${target} 的最新5条推文`,
        schema: z.object({
          tweets: z
            .array(
              z.object({
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
          console.log(chalk.gray(stats.join(" | ")));
        }
      });
    } catch (error) {
      console.error(chalk.red("❌ 提取推文时出错:"), error);
    }

    // 7. 滚动加载更多推文
    console.log(chalk.blue("\n📜 滚动加载更多推文..."));

    // 滚动页面以加载更多推文
    await page.act(`向下滚动页面以加载更多推文`);
    await page.waitForTimeout(3000); // 等待新推文加载

    // 提取新加载的推文
    try {
      const moreTweets = await page.extract({
        instruction: `提取新加载的推文，这些推文应该与之前提取的不同`,
        schema: z.object({
          tweets: z
            .array(
              z.object({
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
          console.log(chalk.gray(stats.join(" | ")));
        }
      });
    } catch (error) {
      console.error(chalk.red("❌ 提取新推文时出错:"), error);
    }

    // 8. 完成任务
    console.log(chalk.green("\n✅ 自动化任务完成!"));
  } catch (error) {
    console.error(chalk.red("❌ 发生错误:"), error);
  } finally {
    // 关闭浏览器
    console.log(chalk.blue("🔒 关闭浏览器..."));
    await stagehand.close();
  }
}

// 执行自动化脚本
(async () => {
  await twitterAutomation();
})();
