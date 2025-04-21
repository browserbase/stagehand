/**
 * Twitter自动化登录测试脚本
 *
 * 使用方法:
 * 1. 确保已在.env文件中设置所有必要的环境变量
 * 2. 运行: npx ts-node examples/twitter_login_test.ts
 *
 * 脚本将测试以下功能:
 * 1. 如果有保存的cookie文件，尝试使用cookie登录
 * 2. 如果没有cookie或cookie失效，进行完整的登录流程
 * 3. 登录成功后保存cookie供下次使用
 */

import { Stagehand } from "@/dist";
import StagehandConfig from "@/stagehand.config";
import chalk from "chalk";
import * as dotenv from "dotenv";
// import type { Page as StagehandPage } from "@/types/page";
import * as TwitterUtils from "./twitter_utils";

// 加载环境变量
dotenv.config();

// 测试账号信息（请根据需要修改或从配置文件加载）
const testAccount = {
  username: process.env.TWITTER_USERNAME || "testuser", // 从环境变量或使用占位符
  password: process.env.TWITTER_PASSWORD || "testpass",
  twoFAEnabled: !!process.env.TWITTER_2FA_SECRET,
  twoFASecret: process.env.TWITTER_2FA_SECRET || undefined,
  verificationEmail: process.env.TWITTER_VERIFICATION_EMAIL || undefined,
};

// 测试验证cookie登录
async function testLoginWithCookies() {
  console.log(chalk.blue("🚀 开始测试Twitter自动化登录..."));

  // 初始化Stagehand
  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    verbose: 1,
    enableCaching: false,
    // 设置系统提示，指导模型如何处理Twitter交互
    systemPrompt: `你是一个帮助用户登录Twitter的助手。
      请按照用户的指示执行登录操作，不要询问后续问题。`,
    localBrowserLaunchOptions: {
      headless: false, // 设置为false使用有头浏览器，便于观察和可能的手动干预
    },
  });

  try {
    console.log(chalk.blue("🌐 启动浏览器..."));
    await stagehand.init();
    const page = stagehand.page;

    // 尝试加载Cookie
    const cookiesLoaded = await TwitterUtils.handleCookies(
      stagehand.context,
      "load",
    );

    if (cookiesLoaded) {
      // 访问Twitter主页验证是否已登录
      await page.goto("https://twitter.com/home");
      await page.waitForTimeout(5000);

      // 检查是否成功登录
      const currentUrl = await page.url();
      if (
        currentUrl.includes("twitter.com/home") ||
        currentUrl.includes("x.com/home")
      ) {
        console.log(chalk.green("✅ 通过Cookie成功登录!"));
      } else {
        console.log(chalk.yellow("⚠️ Cookie登录失败，尝试使用账号密码登录..."));

        // Cookie登录失败，尝试正常登录 - 修正参数
        await TwitterUtils.loginToTwitter(
          page,
          testAccount.username,
          testAccount.password,
          testAccount.twoFAEnabled,
          testAccount.twoFASecret,
          testAccount.verificationEmail,
        );

        // 登录成功后保存新的Cookie
        await TwitterUtils.handleCookies(stagehand.context, "save");
      }
    } else {
      console.log(chalk.blue("🔑 未发现Cookie文件，使用账号密码登录..."));
      // 首次运行，执行登录并保存 Cookie - 修正参数
      await TwitterUtils.loginToTwitter(
        page,
        testAccount.username,
        testAccount.password,
        testAccount.twoFAEnabled,
        testAccount.twoFASecret,
        testAccount.verificationEmail,
      );

      // 登录成功后保存Cookie
      await TwitterUtils.handleCookies(stagehand.context, "save");
    }

    // 验证登录状态
    console.log(chalk.blue("🔍 验证当前登录状态..."));
    await page.goto("https://twitter.com/home");
    await page.waitForTimeout(3000);

    // 提取当前登录的用户名
    try {
      const accountInfo = await page.evaluate(() => {
        // 尝试找到用户名信息
        const usernameElement = document.querySelector(
          'a[data-testid="AppTabBar_Profile_Link"] span[dir="ltr"]',
        );
        return usernameElement ? usernameElement.textContent : null;
      });

      if (accountInfo) {
        console.log(chalk.green(`✅ 当前登录账号: ${accountInfo}`));
      } else {
        console.log(chalk.yellow("⚠️ 无法获取当前登录账号信息"));
      }
    } catch (error) {
      console.log(chalk.yellow("⚠️ 无法获取当前登录账号信息"), error);
    }

    // 测试完成
    console.log(chalk.green("\n✅ 自动化登录测试完成!"));

    // 等待用户手动关闭
    console.log(
      chalk.blue("🔍 浏览器将保持打开状态，请手动关闭终端来结束测试"),
    );

    // 防止脚本立即结束
    await new Promise((resolve) => {
      // 这里不调用resolve，保持脚本运行直到用户手动中断
      process.on("SIGINT", () => {
        console.log(chalk.yellow("\n⚠️ 收到退出信号，正在清理资源..."));
        stagehand.close().then(() => {
          console.log(chalk.green("✅ 资源已清理，测试已停止"));
          resolve(null);
        });
      });
    });
  } catch (error) {
    console.error(chalk.red("❌ 测试过程中出错:"), error);
  } finally {
    // 脚本不会自动结束，除非用户按下Ctrl+C
  }
}

// 执行测试
(async () => {
  await testLoginWithCookies();
})();
