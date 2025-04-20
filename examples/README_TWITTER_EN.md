# Twitter Automation Script

[中文文档](./README_TWITTER.md)

This script uses the Stagehand framework to automatically log into Twitter and browse tweets from specified users. By integrating Google's Gemini model, the script can intelligently handle login processes, navigation, and content extraction, adapting even when the Twitter interface changes.

> Note: This script is for learning and research purposes only. Please comply with Twitter's terms of service and usage policies.

## Features

### Basic Features

- Automatic login to Twitter accounts
- Navigation to specified users' Twitter pages
- Extraction of user profile information
- Extraction of users' latest tweets
- Scroll loading of more tweets
- Display of extracted information in a friendly format

### Multi-User Monitoring Features

- **Multiple Account Management**: Support for configuring multiple Twitter accounts, used in rotation
- **Multiple Target Monitoring**: Simultaneously monitor tweet updates from multiple Twitter users
- **Custom Replies**: Support for text, image, and video replies
- **Proxy IP Configuration**: Each account can use an independent proxy IP
- **Database Recording**: Use SQLite database to record monitoring and reply history

## Prerequisites

1. Install Node.js and npm
2. Clone the Stagehand repository and install dependencies:
   ```bash
   git clone https://github.com/browserbase/stagehand.git
   cd stagehand
   npm install
   npx playwright install
   ```
3. Set up environment variables:

   ```bash
   cp .env.example .env
   ```

   Then edit the .env file and add the following configuration:

   ```
   # Gemini model configuration
   GOOGLE_API_KEY="your_google_api_key"
   GEMINI_MODEL="gemini-2.5-flash-preview-04-17"
   ```

   Twitter account configuration has been moved to the `config/accounts.json` file. First, copy the example file:

   ```bash
   cp examples/config/accounts.json.example config/accounts.json
   ```

   Then edit the `config/accounts.json` file and configure your account information according to the following format:

   > Note: The `accounts.json` file contains sensitive information and has been added to `.gitignore` to prevent it from being committed to the Git repository.

   ```json
   [
     {
       "username": "your_twitter_username1",
       "password": "your_password1",
       "email": "your_email1@example.com",
       "phone": "+1234567890",
       "twoFAEnabled": true,
       "twoFASecret": "YOUR_2FA_SECRET_KEY",
       "verificationEmail": "your_verification_email@example.com",
       "verificationPhone": "+1234567890",
       "proxy": {
         "server": "http://proxy1.example.com:8080",
         "username": "proxy_user1",
         "password": "proxy_pass1"
       }
     }
   ]
   ```

   Available Gemini models include:

   - gemini-1.5-flash
   - gemini-1.5-pro
   - gemini-1.5-flash-8b
   - gemini-2.0-flash-lite
   - gemini-2.0-flash
   - gemini-2.5-flash-preview-04-17
   - gemini-2.5-pro-preview-03-25

## Usage

### Basic Usage

Run the following command to start the Twitter automation script:

```bash
npm run twitter-auto -- --target=target_username
```

Parameter explanation:

- `--target`: The Twitter username you want to browse (without the @ symbol), default is "elonmusk"

Example:

```bash
npm run twitter-auto -- --target=twitter
```

### Multi-User Monitoring

Run the following command to start the multi-user monitoring script:

```bash
npm run twitter-multi-monitor
```

This command will automatically monitor tweets from multiple target users based on configuration files and reply using multiple accounts.

The monitoring script requires the following configuration files:

1. `config/targets.json` - Monitoring target configuration (can be copied from `examples/config/targets.json.example`)
2. `config/accounts.json` - Account configuration (can be copied from `examples/config/accounts.json.example`)
3. `config/replies.json` - Reply content configuration (can be copied from `examples/config/replies.json.example`)

Note: Login credentials and 2FA authentication information are now read from configuration files rather than being passed as command-line parameters, which improves security.

## Important Notes

### Basic Considerations

1. Please ensure you have permission to access the specified Twitter account
2. This script is for learning and research purposes only; please comply with Twitter's terms of use
3. By default, the browser runs visibly. If you want to run it in the background, modify the `headless` option to `true` in the script
4. If Twitter's login process changes, the script may need to be updated

### Security and Privacy

1. **Credential Security**: Do not hardcode your login credentials in the code. Always use command-line parameters or environment variables to pass sensitive information.
2. **Data Processing**: Data extracted by the script is only processed and displayed locally and is not uploaded to external servers (except for interactions with the Gemini API).
3. **Rate Limiting**: The script includes appropriate delays to avoid triggering Twitter's rate limiting measures due to too-rapid requests.
4. **Session Management**: The script properly closes browser sessions after completion to avoid leaking session data.

### Model Usage Considerations

1. **API Key Security**: Please keep your Google API key secure and do not share it with others.
2. **Model Selection**: Different Gemini models have different performance and cost characteristics. Please choose an appropriate model based on your needs.
3. **Cost Control**: Using the Gemini API may incur costs. Please monitor your API usage to avoid unexpected expenses.

## Technical Implementation

The script uses the following technologies and methods:

1. **Stagehand Framework**: Leverages browser automation capabilities provided by Stagehand
2. **Google's Gemini Model**: Uses the Gemini model specified in environment variables for web interaction and content extraction
3. **Page Operation Methods**:
   - `page.act()`: Performs actions such as clicking, inputting, etc.
   - `page.extract()`: Extracts web content
   - `page.setSystemPrompt()`: Sets system prompts to guide how the model handles interactions

## Customization and Advanced Usage

### Basic Customization

You can modify the `examples/twitter_automation.ts` file to customize the script's behavior, such as:

- Changing the number of tweets extracted
- Adding more extraction fields
- Implementing other Twitter features like liking, retweeting, etc.

### Advanced Usage Scenarios

#### 0. Login Testing and Cookie Management

You can use a dedicated login test script to test the login process and manage cookies:

```bash
npm run twitter-login-test
```

This command runs the `examples/twitter_login_test.ts` script, which:

1. Attempts to log in using a saved cookie file
2. Executes the complete login process if the cookie doesn't exist or is invalid
3. Saves cookies to the `twitter-cookies.json` file in the project root directory after successful login
4. Prioritizes using saved cookies on subsequent runs to save login time

For setup instructions and environment variable configuration, refer to the `examples/twitter_setup.md` file.

#### 1. Regular Monitoring of Specific Users' Tweets

You can combine cron tasks to run the script regularly and monitor tweet updates from specific users:

```bash
# Run the script once per hour and save results to a log file
0 * * * * cd /path/to/stagehand && npm run twitter-auto -- --target=elonmusk > /path/to/logs/twitter_monitor_$(date +\%Y\%m\%d\%H\%M\%S).log 2>&1
```

#### 2. Data Analysis Integration

You can modify the script to save extracted tweet data in JSON format and then integrate it into a data analysis workflow:

```typescript
// Add the following code at the end of the script
import * as fs from "fs";

// Save extracted tweet data as a JSON file
const tweetData = {
  userInfo,
  tweets: tweets.tweets,
  moreTweets: moreTweets.tweets,
  timestamp: new Date().toISOString(),
};

fs.writeFileSync(
  `./data/${target}_tweets_${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  JSON.stringify(tweetData, null, 2),
);
```

#### 3. Multi-User Batch Processing

You can create a file containing multiple target users and then process them in batch:

```typescript
// batch_twitter.ts
import { execSync } from "child_process";
import * as fs from "fs";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Read target user list from file
const targets = fs
  .readFileSync("./targets.txt", "utf-8")
  .split("\n")
  .filter(Boolean);

// Check if environment variables are set
if (!process.env.TWITTER_USERNAME || !process.env.TWITTER_PASSWORD) {
  console.error("Please set Twitter login credentials in the .env file.");
  process.exit(1);
}

// Process target users one by one
for (const target of targets) {
  console.log(`Processing user: ${target}`);
  try {
    // Now only need to pass the target user parameter; login credentials are read from the .env file
    execSync(`npm run twitter-auto -- --target=${target}`, {
      stdio: "inherit",
    });
    // Add delay to avoid triggering Twitter's limitations
    console.log("Waiting 30 seconds before processing the next user...");
    execSync("sleep 30");
  } catch (error) {
    console.error(`Error processing user ${target}:`, error);
  }
}
```

## Performance Optimization

To improve the script's performance and reliability, consider the following optimization measures:

1. **Browser Caching**: Enable browser caching to speed up page loading. Add appropriate cache configuration in `localBrowserLaunchOptions`.

2. **Concurrency Limits**: If you're batch processing multiple users, consider using concurrency limits to avoid triggering Twitter's limitations.

3. **Lightweight Models**: For simple tasks, use lightweight Gemini models (such as `gemini-1.5-flash`) to improve response speed and reduce costs.

4. **Selective Extraction**: Only extract the data you really need to reduce interactions with the Gemini API.

5. **Error Retry Mechanism**: Add error retry mechanisms to enhance the script's exception handling capabilities.

## Frequently Asked Questions (FAQ)

### Q1: Can the script handle two-factor authentication (2FA)?

**A:** Yes, the current version of the script supports automatic handling of TOTP-based two-factor authentication. You need to set `twoFAEnabled: true` and provide the TOTP key `twoFASecret` for each account in the `config/accounts.json` file. The script will automatically generate verification codes and complete the login process. If you use other types of 2FA (such as SMS verification), the script will wait for you to manually complete the verification.

### Q2: Does the script support proxy servers?

**A:** Yes, the script supports two proxy configuration methods:

1. **Global Proxy Configuration**: Configure proxy servers in `localBrowserLaunchOptions`:

```typescript
localBrowserLaunchOptions: {
  headless: false,
  proxy: {
    server: 'http://myproxy.com:3128',
    username: 'proxy_user',  // optional
    password: 'proxy_pass'   // optional
  }
}
```

2. **Per-Account Proxy Configuration**: Configure different proxy IPs for each account in `accounts.json` (optional):

```json
[
  {
    "username": "your_twitter_username1",
    "password": "your_password1",
    "proxy": {
      "server": "http://proxy1.example.com:8080",
      "username": "proxy_user1",
      "password": "proxy_pass1"
    }
  },
  {
    "username": "your_twitter_username2",
    "password": "your_password2"
    // This account doesn't use a proxy, connects directly
  },
  {
    "username": "your_twitter_username3",
    "password": "your_password3",
    "proxy": {
      "server": "http://proxy3.example.com:8080"
      // Proxy can be configured with just the server, without username and password
    }
  }
]
```

This way, each account will use its own proxy IP (if configured) when replying to tweets, avoiding platform limitations. If an account doesn't have a proxy configured, it will use a direct connection.

### Q3: How to handle Twitter's CAPTCHA challenges?

**A:** If Twitter requires a CAPTCHA, the script may not be able to handle it automatically. In this case, it's recommended to set `headless` to `false`, manually complete the CAPTCHA challenge, and then the script will continue execution.

### Q4: Does the script support multilingual tweets?

**A:** Yes, the Gemini model supports content processing in multiple languages. The script can extract tweets in various languages and maintain the original format.

### Q5: How to store extracted tweet content?

**A:** Please refer to the "Data Analysis Integration" example in the "Advanced Usage Scenarios" section, which demonstrates how to save extracted tweets as JSON files.

## Troubleshooting

If the script fails to run, try the following methods:

1. **Login Credential Issues**: Ensure your Twitter account credentials are correct. If your account has two-factor authentication enabled, manual intervention may be required.

2. **API Key Issues**: Check if your Google API key is valid and ensure that Gemini API access is enabled.

3. **Dependency Issues**: Run `npm install` to update all dependencies, then rebuild the project.

4. **Interface Changes**: If Twitter's interface has changed, you may need to update selectors or instructions in the script. Try using more generic instructions.

5. **Debug Mode**: Set the `verbose` level to 2 to enable detailed log output to help identify issues:

```typescript
verbose: 2, // Enable detailed logging
```

6. **Network Issues**: Ensure your network connection is stable and that you can access Twitter and the Google API. If needed, consider using a VPN or proxy server.
