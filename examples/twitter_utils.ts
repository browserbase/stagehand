/**
 * Twitter自动化工具函数
 *
 * 此文件包含Twitter自动化过程中使用的通用工具函数，
 * 减少Twitter登录测试和监控脚本中的代码重复
 */

import { Page } from "playwright";
import chalk from "chalk";
import { authenticator } from "otplib";
import fs from "fs";
import path from "path";

// 生成TOTP验证码
export function generateTOTP(secret: string): string {
  return authenticator.generate(secret);
}

// 从环境变量获取Twitter登录凭据 - 已弃用，改为从配置文件读取
export function getTwitterCredentials() {
  console.warn("警告: getTwitterCredentials 函数已弃用，请从 config/accounts.json 文件中读取账号信息");

  // 返回空对象，避免代码报错
  return {
    username: "",
    password: "",
    twoFAEnabled: false,
    twoFASecret: "",
    verificationEmail: "",
    verificationPhone: "",
  };
}

// 确保数据目录存在
export function ensureDataDir() {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

// 保存和加载Cookie
export async function handleCookies(context: any, action: 'load' | 'save') {
  const cookiePath = path.join(process.cwd(), "twitter-cookies.json");

  if (action === 'load' && fs.existsSync(cookiePath)) {
    console.log(chalk.blue("🍪 发现保存的Cookie文件，尝试使用Cookie登录..."));
    const storage = JSON.parse(fs.readFileSync(cookiePath, "utf-8"));
    await context.addCookies(storage.cookies);
    console.log(chalk.green(`✅ 已加载 ${storage.cookies.length} 条 Cookie`));
    return true;
  }
  else if (action === 'save') {
    await context.storageState({ path: cookiePath });
    console.log(chalk.green(`✅ 登录后Cookie已保存到 ${cookiePath}`));
    return true;
  }

  return false;
}

// 处理账号验证（邮箱或手机号）
export async function handleAccountVerification(
  page: Page,
  verificationEmail?: string,
  verificationPhone?: string,
) {
  console.log(chalk.blue("🔐 检查是否需要账号验证..."));

  // 检查页面是否包含需要输入邮箱或手机号的文本
  const isVerificationPage = await page.$$eval(
    [
      'div:has-text("Enter your phone number or email address")',
      'div:has-text("输入你的手机号或电子邮件地址")',
      'div:has-text("输入您的手机号码或电子邮箱")',
      'div:has-text("Verify your identity")',
      'div:has-text("验证您的身份")',
      'div:has-text("We need to confirm your identity")',
      'div:has-text("我们需要确认您的身份")',
      'div:has-text("Help us verify your identity")',
      'div:has-text("请帮助我们验证您的身份")',
      'div:has-text("Confirm your identity")',
      'div:has-text("确认您的身份")',
      'div:has-text("Enter the email")',
      'div:has-text("输入邮箱")',
      'div:has-text("Enter the phone")',
      'div:has-text("输入手机号")',
      'div:has-text("Let\'s verify your identity")',
      'div:has-text("让我们验证您的身份")',
    ].join(", "),
    (elements) => elements.length > 0,
  );

  if (!isVerificationPage) {
    console.log(chalk.blue("ℹ️ 没有检测到账号验证页面"));
    return false;
  }

  console.log(
    chalk.yellow("⚠️ 检测到账号验证页面，需要输入邮箱或手机号进行验证"),
  );

  // 检查页面上的提示文本，确定优先使用邮箱还是手机号
  const emailPreferred = await page.$$eval(
    [
      'div:has-text("Enter your email")',
      'div:has-text("输入你的邮箱")',
      'div:has-text("Verify your email")',
      'div:has-text("验证您的电子邮件")',
    ].join(", "),
    (elements) => elements.length > 0,
  );

  const phonePreferred = await page.$$eval(
    [
      'div:has-text("Enter your phone")',
      'div:has-text("输入你的手机号")',
      'div:has-text("Verify your phone")',
      'div:has-text("验证您的手机号")',
    ].join(", "),
    (elements) => elements.length > 0,
  );

  // 根据页面提示选择合适的验证方式
  let verificationValue;
  if (emailPreferred && verificationEmail) {
    verificationValue = verificationEmail;
    console.log(
      chalk.blue(`ℹ️ 页面提示使用邮箱验证，将使用邮箱: ${verificationEmail}`),
    );
  } else if (phonePreferred && verificationPhone) {
    verificationValue = verificationPhone;
    console.log(
      chalk.blue(
        `ℹ️ 页面提示使用手机号验证，将使用手机号: ${verificationPhone}`,
      ),
    );
  } else {
    // 没有明确提示时，优先使用邮箱
    verificationValue = verificationEmail || verificationPhone;
    console.log(
      chalk.blue(
        `ℹ️ 优先使用 ${verificationEmail ? "邮箱" : "手机号"} 进行验证: ${verificationValue}`,
      ),
    );
  }

  if (!verificationValue) {
    console.log(chalk.red("❌ 账号验证需要邮箱或手机号，但未提供"));
    throw new Error("账号验证失败：未提供邮箱或手机号进行验证");
  }

  // 查找验证输入框
  const verificationInput = await page.$(
    [
      'input[data-testid="ocfEnterTextTextInput"]',
      'input[name="text"]',
      'input[autocomplete="email"]',
      'input[autocomplete="tel"]',
      'input[type="email"]',
      'input[type="tel"]',
      'input[placeholder*="email"]',
      'input[placeholder*="phone"]',
      'input[placeholder*="邮箱"]',
      'input[placeholder*="手机"]',
    ].join(", "),
  );

  if (verificationInput) {
    await verificationInput.fill(verificationValue);
    console.log(chalk.green(`✅ 已输入账号验证信息: ${verificationValue}`));

    // 点击下一步按钮
    const nextButton =
      (await page.$('div[role="button"]:has-text("下一步")')) ||
      (await page.$('div[role="button"]:has-text("Next")')) ||
      (await page.$('div[role="button"]:has-text("继续")')) ||
      (await page.$('div[role="button"]:has-text("Continue")')) ||
      (await page.$('div[role="button"]:has-text("验证")')) ||
      (await page.$('div[role="button"]:has-text("Verify")')) ||
      (await page.$('div[role="button"]:has-text("确认")')) ||
      (await page.$('div[role="button"]:has-text("Confirm")')) ||
      (await page.$('div[role="button"]:has-text("提交")')) ||
      (await page.$('div[role="button"]:has-text("Submit")'));

    if (nextButton) {
      await nextButton.click();
      console.log(chalk.green("✅ 已点击验证按钮"));
      await page.waitForTimeout(3000);
      return true;
    } else {
      console.log(chalk.yellow("⚠️ 找不到验证按钮，尝试使用Enter键"));
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3000);
      return true;
    }
  } else {
    console.log(chalk.yellow("⚠️ 找不到验证输入框，尝试使用act方法"));
    try {
      // @ts-expect-error - act方法可能不存在于标准Page类型，需要根据实际项目调整
      await page.act(
        `在验证页面中输入 "${verificationValue}" 作为验证信息，然后点击下一步、验证或继续按钮`,
      );
      await page.waitForTimeout(3000);
      return true;
    } catch (error) {
      console.log(chalk.red(`❌ 使用act方法验证失败: ${error}`));
      throw new Error("账号验证失败：无法完成验证流程");
    }
  }
}

// 处理2FA验证
export async function handle2FAVerification(page: Page, tfaSecret?: string) {
  if (!tfaSecret) return false;

  console.log(chalk.blue("🔐 检查是否需要2FA验证..."));

  // 检查是否存在2FA输入框
  const is2FAPage = await page.$$eval(
    [
      'input[data-testid="ocfEnterTextTextInput"]',
      'input[placeholder*="验证码"]',
      'input[placeholder*="code"]',
      'div:has-text("Enter the verification code")',
      'div:has-text("输入验证码")',
      'div:has-text("Two-factor authentication")',
      'div:has-text("两步验证")',
      'div:has-text("Two-step verification")',
      'div:has-text("双重验证")',
    ].join(", "),
    (elements) => elements.length > 0,
  );

  if (!is2FAPage) {
    console.log(chalk.blue("ℹ️ 没有检测到2FA验证页面"));
    return false;
  }

  console.log(chalk.blue("🔐 检测到2FA验证页面，正在处理..."));

  // 生成TOTP验证码
  const totpCode = generateTOTP(tfaSecret);
  console.log(chalk.blue(`🔑 生成TOTP验证码: ${totpCode}`));

  // 尝试定位2FA输入框
  const twoFAInput = await page.$(
    [
      'input[data-testid="ocfEnterTextTextInput"]',
      'input[aria-label="验证码"]',
      'input[placeholder*="验证码"]',
      'input[placeholder*="code"]',
      'input[inputmode="numeric"]',
      'input[autocomplete="one-time-code"]',
    ].join(", "),
  );

  if (twoFAInput) {
    // 输入验证码
    await twoFAInput.fill(totpCode);
    console.log(chalk.green("✅ 已输入验证码"));

    // 点击验证按钮
    const verifyButton =
      (await page.$('div[role="button"]:has-text("验证")')) ||
      (await page.$('div[role="button"]:has-text("Verify")')) ||
      (await page.$('div[role="button"]:has-text("Next")')) ||
      (await page.$('div[role="button"]:has-text("下一步")'));

    if (verifyButton) {
      await verifyButton.click();
      console.log(chalk.green("✅ 已点击验证按钮"));
      await page.waitForTimeout(3000);
      return true;
    } else {
      console.log(chalk.yellow("⚠️ 找不到验证按钮，尝试使用Enter键"));
      await page.keyboard.press("Enter");
      await page.waitForTimeout(3000);
      return true;
    }
  } else {
    console.log(chalk.yellow("⚠️ 找不到验证码输入框，尝试使用act方法"));
    try {
      // @ts-expect-error - act方法可能不存在于标准Page类型
      await page.act(`输入双因素验证码 "${totpCode}"，然后点击确认或下一步按钮`);
      await page.waitForTimeout(3000);
      return true;
    } catch (error) {
      console.log(chalk.red(`❌ 使用act方法验证失败: ${error}`));
      throw new Error("2FA验证失败：无法完成验证流程");
    }
  }
}

// 登录Twitter
export async function loginToTwitter(
  page: Page,
  username: string,
  password: string,
  twoFAEnabled: boolean,
  twoFASecret: string | undefined,
  verificationEmail?: string,
  verificationPhone?: string,
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

      // 等待可能出现的账号验证页面
      await page.waitForTimeout(3000);

      // 处理可能出现的账号验证流程（邮箱或手机号验证）
      await handleAccountVerification(
        page,
        verificationEmail,
        verificationPhone,
      );
    } else {
      console.log(chalk.yellow("⚠️ 找不到用户名输入框，尝试使用act方法"));
      try {
        // @ts-expect-error - act方法可能不存在于标准Page类型
        await page.act(
          `在登录页面上输入用户名 "${username}"，然后点击下一步或类似的按钮`,
        );
      } catch (error) {
        console.log(chalk.red(`❌ 使用act方法输入用户名失败: ${error}`));
        throw new Error("登录失败：无法输入用户名");
      }
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
      try {
        // @ts-expect-error - act方法可能不存在于标准Page类型
        await page.act(`输入密码 "${password}"，然后点击登录按钮`);
      } catch (error) {
        console.log(chalk.red(`❌ 使用act方法输入密码失败: ${error}`));
        throw new Error("登录失败：无法输入密码");
      }
    }

    // 等待页面加载，可能会出现验证页面
    await page.waitForTimeout(3000);

    // 处理可能出现的账号验证流程
    await handleAccountVerification(page, verificationEmail, verificationPhone);

    // 如果启用了2FA并且有密钥，处理2FA验证
    if (twoFAEnabled && twoFASecret) {
      await handle2FAVerification(page, twoFASecret);
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
        chalk.yellow("⚠️ 登录可能失败或需要额外验证。当前 URL: " + currentUrl),
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
    console.log(chalk.yellow("⚠️ 请在浏览器中手动完成登录流程。等待 60 秒..."));
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

// 清除输入框内容（类型安全的方法）
export async function clearInputField(page: Page, selector: string) {
  await page.evaluate((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (el instanceof HTMLInputElement) {
        el.value = '';
      }
    });
  }, selector);
}