# Stagehand Component Example

Complete example showing how to use the `convex-stagehand` component for AI-powered web scraping.

## Prerequisites

Before running this example, you'll need:

1. **Browserbase Account** (for cloud browser infrastructure)
   - Sign up at https://browserbase.com
   - Get your API key and Project ID from the dashboard

2. **AI Model API Key** (for intelligent extraction)
   - OpenAI: Get API key from https://platform.openai.com/api-keys
   - OR Anthropic: Get API key from https://console.anthropic.com/

3. **Convex Account** (for backend deployment)
   - Sign up at https://convex.dev (free)

## Setup Instructions

### 1. Install Dependencies

```bash
cd example
npm install
```

### 2. Configure Convex

Create a new Convex deployment:

```bash
npx convex dev
```

This will:

- Prompt you to log in (if first time)
- Create a new project
- Start watching for changes

### 3. Set Environment Variables

In the Convex dashboard (opens automatically), go to **Settings → Environment Variables** and add:

```
BROWSERBASE_API_KEY=your_browserbase_api_key
BROWSERBASE_PROJECT_ID=your_browserbase_project_id
MODEL_API_KEY=your_llm_provider_api_key
```

**Where to find these:**

- Browserbase: Dashboard → Settings → API Keys
- OpenAI: https://platform.openai.com/api-keys
- Anthropic: https://console.anthropic.com/settings/keys
- Other providers: See [supported models](https://docs.stagehand.dev/configuration/models)

### 4. Run the Examples

With `npx convex dev` still running in one terminal, open another terminal and run:

**Extract HackerNews stories:**

```bash
npx convex run example:scrapeHackerNews '{"maxStories": 5}'
```

**Extract GitHub repository info:**

```bash
npx convex run example:scrapeGitHubRepo '{"owner": "anthropics", "repo": "anthropic-sdk-typescript"}'
```

**Find navigation links:**

```bash
npx convex run example:findNavLinks '{"url": "https://news.ycombinator.com"}'
```

**Perform an action:**

```bash
npx convex run example:performAction '{"url": "https://example.com", "actionToPerform": "Click the More information link"}'
```

**Search and extract results:**

```bash
npx convex run example:searchAndExtract '{"searchQuery": "convex database"}'
```

**Extract products from e-commerce:**

```bash
npx convex run example:scrapeProducts '{"url": "https://www.amazon.com/s?k=laptop"}'
```

## What Each Example Does

### 1. `scrapeHackerNews` - Data Extraction + Database Persistence

Extracts top stories from HackerNews and saves them to your Convex database. Shows the complete pattern: extract with AI → persist to Convex.

**Expected output:**

```json
{
  "count": 5,
  "scrapedAt": "2024-01-14T12:03:32.123Z"
}
```

**Time:** ~10-12 seconds

### 2. `scrapeGitHubRepo` - Dynamic Page Extraction

Extracts repository metadata from GitHub including stars, forks, and language.

**Time:** ~8-10 seconds

### 3. `findNavLinks` - Element Discovery

Uses the `observe` method to find interactive elements on a page.

**Time:** ~5-8 seconds

### 4. `performAction` - Browser Automation

Uses the `act` method to click buttons and interact with pages.

**Time:** ~6-9 seconds

### 5. `searchAndExtract` - Multi-step Workflow

Chains multiple actions together: searches Google, then extracts results. Shows the `workflow` method for complex automation.

**Time:** ~15-18 seconds

### 6. `scrapeProducts` - Real-world E-commerce

Extracts product listings with prices and ratings.

**Time:** ~10-13 seconds

## View Your Data

To see the scraped HackerNews stories in your database:

```bash
npx convex dashboard
```

Navigate to **Data → hackerNewsStories** to see all scraped articles.

## Using Different AI Models

By default, examples use `openai/gpt-4o`. To use a different model, edit `convex/example.ts`:

```typescript
const stagehand = new Stagehand(components.stagehand, {
  browserbaseApiKey: process.env.BROWSERBASE_API_KEY!,
  browserbaseProjectId: process.env.BROWSERBASE_PROJECT_ID!,
  modelApiKey: process.env.MODEL_API_KEY!, // Your LLM provider API key
  modelName: "anthropic/claude-3-5-sonnet-20241022", // Change model
});
```

See the [Stagehand Models documentation](https://docs.stagehand.dev/configuration/models) for all supported models and providers.

## Troubleshooting

**"Couldn't resolve stagehand.lib.extract"**

- Make sure you ran `npx convex dev` to deploy your functions
- The component needs to be pushed to Convex first

**"Missing environment variable"**

- Check that all three environment variables are set in Convex dashboard
- Variable names must match exactly (case-sensitive)

**"Browserbase session failed"**

- Verify your Browserbase API key and Project ID are correct
- Check your Browserbase dashboard for session logs

**Slow performance**

- This is normal - AI-powered browser automation takes 5-15 seconds per operation
- Check Browserbase dashboard to watch the live browser session

**Model API errors**

- Verify your OpenAI/Anthropic API key is valid
- Check you have credits available in your account

## Next Steps

1. **Modify the examples** - Edit `convex/example.ts` to scrape your own websites
2. **Add your own schema** - Extend `convex/schema.ts` with new tables
3. **Build your app** - Use these patterns in your own Convex application

## Learn More

- [Component Documentation](../README.md)
- [Stagehand REST API](https://stagehand.stldocs.app/api)
- [Convex Docs](https://docs.convex.dev)
- [Browserbase Docs](https://docs.browserbase.com)
