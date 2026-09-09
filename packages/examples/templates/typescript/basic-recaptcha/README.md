# Stagehand + Browserbase: Basic reCAPTCHA Solving

## AT A GLANCE

- Goal: Demonstrate automatic reCAPTCHA solving using Browserbase's built-in captcha solving capabilities.
- Automated Solving: Browserbase automatically detects and solves CAPTCHAs in the background. CAPTCHA solving is **enabled by default** - you don't need to set `solveCaptchas: true` unless you want to explicitly enable it (or set it to `false` to disable).
- Solving Time: CAPTCHA solving typically takes between 5-30 seconds depending on CAPTCHA type and complexity.
- Progress Monitoring: Listen for console messages (`browserbase-solving-started`, `browserbase-solving-finished`) to track captcha solving progress in real-time.
- Proxies Recommended: Enable proxies for higher CAPTCHA solving success rates.
- Result inspection: Extracts and prints the page content after form submission.
- Docs → https://docs.browserbase.com/features/stealth-mode#captcha-solving

## GLOSSARY

- solveCaptchas: Browserbase browser setting that enables automatic captcha solving for reCAPTCHA, hCaptcha, and other captcha types. Enabled by default for Basic and Advanced Stealth Mode.
  Docs → https://docs.browserbase.com/features/stealth-mode#captcha-solving
- CAPTCHA solving: When a CAPTCHA is detected, Browserbase attempts to solve it automatically in the background, allowing your automation to continue without manual intervention.
- console messages: browser console events that indicate captcha solving status:
  - `browserbase-solving-started`: emitted when CAPTCHA detection begins
  - `browserbase-solving-finished`: emitted when CAPTCHA solving completes
- custom CAPTCHA solving: For non-standard or custom captcha providers, you can specify CSS selectors for the captcha image and input field using `captchaImageSelector` and `captchaInputSelector` in browserSettings.
- act: perform UI actions from a prompt (type, click, fill forms)
  Docs → https://docs.stagehand.dev/v4/basics/act
- extract: pull data from web pages using natural language instructions
  Docs → https://docs.stagehand.dev/v4/basics/extract

## STAGEHAND VS PLAYWRIGHT

| Feature         | Stagehand (this template)            | Playwright                    |
| --------------- | ------------------------------------ | ----------------------------- |
| Actions         | `stagehand.act("Click the button")`  | `page.click()`, `page.goto()` |
| Data Extraction | `stagehand.extract("Get the price")` | Manual DOM queries            |

## CAPTCHA SOLVING DETAILS

### How CAPTCHA Solving Works

Browserbase provides integrated CAPTCHA solving to handle challenges automatically:

- **Automatic Detection**: When a CAPTCHA is detected on a page, Browserbase attempts to solve it in the background
- **Solving Time**: CAPTCHA solving typically takes between 5-30 seconds, depending on the CAPTCHA type and complexity
- **Default Behavior**: CAPTCHA solving is enabled by default for Basic and Advanced Stealth Mode
- **Proxies**: It's recommended to enable proxies when using CAPTCHA solving for higher success rates
- **Multiple Types**: Browserbase supports reCAPTCHA, hCaptcha, and other common captcha providers automatically

### Custom CAPTCHA Solving

For non-standard or custom captcha providers, you can specify CSS selectors to guide the solution process:

```typescript
browserSettings: {
  solveCaptchas: true,
  captchaImageSelector: "#custom-captcha-image-id",
  captchaInputSelector: "#custom-captcha-input-id"
}
```

To find the selectors:

1. Right-click on the captcha image and select "Inspect" to get the image selector
2. Right-click on the input field and select "Inspect" to get the input selector
3. Use the element's `id` or a CSS selector that uniquely identifies it

### Disabling CAPTCHA Solving

If you want to disable automatic captcha solving, set `solveCaptchas: false` in browserSettings:

```typescript
browserSettings: {
  solveCaptchas: false;
}
```

## QUICKSTART

1. cd basic-recaptcha
2. pnpm install
3. cp .env.example .env
4. Add your Browserbase API key to .env
5. pnpm start

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase
- Listens for Browserbase captcha progress through Stagehand V4 console events
- Navigates to Google reCAPTCHA demo page
- Clicks submit button to trigger reCAPTCHA challenge
- Waits for Browserbase to automatically solve the captcha
- Logs captcha solving progress messages
- Clicks submit again after captcha is solved
- Extracts and displays page content
- Prints the resulting page content for inspection
- Closes session cleanly

## COMMON PITFALLS

- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- Captcha solving not enabled: ensure `solveCaptchas: true` is set in browserSettings (enabled by default)
- Solving timeout: allow up to 30 seconds for CAPTCHA solving to complete before timing out
- Proxies not enabled: enable proxies in browserSettings for higher CAPTCHA solving success rates
- Demo page inaccessible: verify the reCAPTCHA demo page URL is accessible and hasn't changed
- Console message timing: ensure console event listeners are set up before triggering the captcha
- Custom captcha selectors: for non-standard CAPTCHAs, verify that `captchaImageSelector` and `captchaInputSelector` are correctly defined

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
