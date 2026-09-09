# Company News Finder Function

A Browserbase Function that uses Stagehand's AI agent to search Google for the latest news about a company and provide an intelligent summary along with top news links.

## What It Does

This function takes a company name, searches Google for the latest news about that company, and uses Stagehand's AI-powered agent to analyze the results. It returns:

- **Summary** - A comprehensive 2-3 paragraph summary of what's currently happening with the company
- **Top News Links** - The most relevant and recent news articles with titles, URLs, and sources
- **Metadata** - Execution time, session replay URL, and timestamp

**Use Cases:**

- Get quick updates on what's happening with a competitor
- Research a company before a meeting or interview
- Track news about companies in your portfolio
- Monitor industry leaders and their recent developments
- Stay informed about customer or partner companies

## Prerequisites

1. **Browserbase Account** - Sign up at [browserbase.com](https://www.browserbase.com)
2. **API Key** - Get your API key from [Settings](https://www.browserbase.com/settings)
3. **AI Model API Key** - Get an API key from your AI provider (see below)
4. **Node.js** - Version 18 or higher

## Setup

1. **Install dependencies:**

```bash
npm install
```

2. **Set environment variables:**

```bash
export BROWSERBASE_API_KEY="your-api-key-here"
export BROWSERBASE_PROJECT_ID="your-project-id-here"
export MODEL_API_KEY="your-ai-model-api-key-here"
```

Or create a `.env` file:

```env
BROWSERBASE_API_KEY=your-api-key-here
BROWSERBASE_PROJECT_ID=your-project-id-here
MODEL_API_KEY=your-ai-model-api-key-here
```

**Note:** The `MODEL_API_KEY` is required for Stagehand's AI agent. Get an API key from your AI provider:

- **Google Gemini** (recommended): [Google AI Studio](https://aistudio.google.com/apikey)
- **OpenAI**: [OpenAI Platform](https://platform.openai.com/api-keys)
- **Anthropic**: [Anthropic Console](https://console.anthropic.com/)

## Deploy the Function

Deploy the function to Browserbase:

```bash
npm run deploy
```

This will:

1. Bundle the function code
2. Upload it to Browserbase
3. Return a Function ID you can invoke

**Save the Function ID** from the output - you'll need it to invoke the function.

## Test the Function

### Option 1: Test via Browserbase Dashboard

1. Go to [Browserbase Dashboard → Functions](https://www.browserbase.com/functions)
2. Find your `company-news-finder` function
3. Click "Test" or "Invoke"
4. Provide test parameters:

```json
{
  "companyName": "Tesla",
  "model": "google/gemini-3-flash-preview",
  "maxSteps": 30
}
```

**Note:** The `model` and `maxSteps` parameters are optional and will use defaults if not provided.

5. Click "Invoke" and watch the results appear

### Option 2: Test via API

Use the Functions API to invoke directly:

```bash
# Get your Function ID
FUNCTION_ID="func_xxxxxxxxxxxxx"

# Invoke the function
curl -X POST "https://api.browserbase.com/v1/functions/${FUNCTION_ID}/invoke" \
  -H "x-bb-api-key: ${BROWSERBASE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "companyName": "OpenAI",
      "model": "google/gemini-3-flash-preview"
    }
  }'
```

This returns an invocation ID. Poll for results:

```bash
INVOCATION_ID="inv_xxxxxxxxxxxxx"

curl "https://api.browserbase.com/v1/functions/invocations/${INVOCATION_ID}" \
  -H "x-bb-api-key: ${BROWSERBASE_API_KEY}"
```

### Option 3: Test with Node.js Script

Create `test.js`:

```javascript
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const FUNCTION_ID = "func_xxxxxxxxxxxxx"; // Your function ID

async function testCompanyNewsFinder() {
  // Invoke function
  const invokeRes = await fetch(`https://api.browserbase.com/v1/functions/${FUNCTION_ID}/invoke`, {
    method: "POST",
    headers: {
      "x-bb-api-key": BROWSERBASE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      params: {
        companyName: "Microsoft",
        model: "google/gemini-3-flash-preview",
      },
    }),
  });

  const { id: invocationId } = await invokeRes.json();
  console.log("Invocation ID:", invocationId);

  // Poll for completion
  let status = "RUNNING";
  let result;

  while (status === "RUNNING") {
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const pollRes = await fetch(
      `https://api.browserbase.com/v1/functions/invocations/${invocationId}`,
      {
        headers: { "x-bb-api-key": BROWSERBASE_API_KEY },
      },
    );

    result = await pollRes.json();
    status = result.status;
    console.log("Status:", status);
  }

  console.log("\n=== Company News Summary ===");
  console.log(result.results.summary);
  console.log("\n=== Top News Links ===");
  result.results.topLinks.forEach((link, i) => {
    console.log(`\n${i + 1}. ${link.title}`);
    console.log(`   Source: ${link.source || "Unknown"}`);
    console.log(`   URL: ${link.url}`);
  });
  console.log(`\nSession Replay: ${result.results.metadata.sessionReplayUrl}`);
}

testCompanyNewsFinder();
```

Run it:

```bash
node test.js
```

## Example Output

```json
{
  "success": true,
  "companyName": "Tesla",
  "summary": "Tesla has been making headlines recently with several major developments. The company reported strong Q4 earnings, beating analyst expectations with record vehicle deliveries despite ongoing supply chain challenges. CEO Elon Musk announced plans for a new manufacturing facility in Southeast Asia, marking Tesla's continued global expansion.\n\nIn other news, Tesla's Full Self-Driving (FSD) beta program reached a new milestone with over 500,000 active users. The company also unveiled updated versions of the Model 3 and Model Y with improved range and new features. However, Tesla faces increased competition from traditional automakers and Chinese EV manufacturers who are rapidly expanding their electric vehicle offerings.",
  "topLinks": [
    {
      "title": "Tesla Reports Record Q4 Earnings, Beats Expectations",
      "url": "https://www.reuters.com/business/tesla-earnings-q4-2024",
      "source": "Reuters"
    },
    {
      "title": "Elon Musk Announces New Tesla Factory in Southeast Asia",
      "url": "https://www.bloomberg.com/news/tesla-factory-asia",
      "source": "Bloomberg"
    },
    {
      "title": "Tesla's FSD Beta Reaches 500,000 Active Users",
      "url": "https://techcrunch.com/tesla-fsd-milestone",
      "source": "TechCrunch"
    },
    {
      "title": "Updated Model 3 and Model Y Feature Improved Range",
      "url": "https://www.theverge.com/tesla-model-update",
      "source": "The Verge"
    },
    {
      "title": "Tesla Faces Growing Competition from Chinese EV Makers",
      "url": "https://www.cnbc.com/tesla-competition-china",
      "source": "CNBC"
    }
  ],
  "metadata": {
    "totalLinks": 5,
    "scrapedAt": "2024-01-15T10:30:00.000Z",
    "duration": 25834,
    "sessionReplayUrl": "https://www.browserbase.com/sessions/sess_xxxxx"
  }
}
```

## How It Works

1. **Connect** - Function connects to Browserbase browser session via CDP
2. **Navigate to Google** - Browser visits google.com
3. **Search** - AI agent types the company name + "latest news" and submits search
4. **Analyze Results** - Agent reads headlines, snippets, and sources from top results
5. **Generate Summary** - Agent creates a comprehensive summary of current developments
6. **Extract Links** - Agent collects the top 5-7 most relevant news articles
7. **Return Data** - Returns clean JSON with summary, links, and metadata
8. **Session Replay** - Full browser session recorded for debugging

**Technical Details:**

- Uses Playwright's Chrome DevTools Protocol (CDP) connection
- Stagehand runs in "LOCAL" mode using the existing browser session
- Agent operates in "hybrid" mode for optimal performance
- Default model: `google/gemini-3-flash-preview` (configurable)
- Searches Google and analyzes results in real-time

**Key Features:**

- ✅ **AI-Powered Summary** - Get the big picture quickly
- ✅ **Latest News** - Always searches for recent developments
- ✅ **Top Sources** - Links to original articles from major news outlets
- ✅ **Fast** - Typically completes in 20-30 seconds
- ✅ **Debuggable** - Session replay for every run
- ✅ **Flexible** - Works for any company name
- ✅ **Configurable** - Choose your preferred AI model

## Troubleshooting

### Function times out

- Google search results load slowly sometimes
- Check the session replay URL to see where it got stuck
- Try increasing `maxSteps` if the agent needs more time

### Summary is empty or links missing

- The agent may not have found clear news results
- Try a more specific company name (e.g., "Tesla Inc" instead of just "Tesla")
- Check the session replay to see what Google returned
- Increase `maxSteps` to give the agent more time

### API Key errors

- Verify your `BROWSERBASE_API_KEY` is set correctly
- Ensure your `MODEL_API_KEY` is set and valid for your chosen AI provider
- Ensure your account has Functions enabled
- Check that you're using the correct project ID

### Deployment fails

- Make sure you have the latest `@browserbasehq/sdk-functions` package
- Verify your TypeScript configuration is correct
- Check that all dependencies are installed

### Model errors

- Verify your AI model API key is correct for the provider
- Check that the model name is valid (e.g., `google/gemini-3-flash-preview`)
- Ensure you have sufficient credits with your AI provider

### Google blocks the search

- Browserbase uses advanced stealth mode to avoid detection
- If blocked, check the session replay to see what happened
- This is rare but can happen with high request volumes

## Customization

### Adjust the search query

Edit the instruction in `index.ts` to modify the search:

```typescript
instruction: `Search Google for "${params.companyName} news 2024" and analyze the results.
  Focus on financial news and company announcements.
  Exclude opinion pieces and analysis articles.`;
```

### Change the AI model

You can use different AI models by passing the `model` parameter:

```json
{
  "companyName": "Apple",
  "model": "openai/gpt-4o"
}
```

Supported models:

- `google/gemini-3-flash-preview` (default, fast and cost-effective)
- `openai/gpt-4o` (powerful, requires OpenAI API key)
- `anthropic/claude-3.5-sonnet` (excellent reasoning, requires Anthropic API key)

### Adjust agent steps

Control how many steps the agent takes:

```json
{
  "companyName": "Amazon",
  "maxSteps": 40
}
```

Higher `maxSteps` allows more thorough analysis but takes longer.

### Modify summary style

Edit the instruction to change the summary format:

```typescript
instruction: `Search Google for "${params.companyName} latest news" and analyze the results.

  Create a summary that:
  - Starts with the most important recent development
  - Focuses on financial and business metrics
  - Is written in a professional, objective tone
  - Includes specific dates and numbers when available

  Return JSON with "summary" and "topLinks" fields.`;
```

## Resources

- [Browserbase Functions Documentation](https://docs.browserbase.com/features/functions)
- [Stagehand Documentation](https://docs.browserbase.com/guides/stagehand)
- [Functions API Reference](https://docs.browserbase.com/functions/reference)
- [Session Replay](https://docs.browserbase.com/features/session-replay)

## Support

- [Discord Community](https://discord.gg/browserbase)
- [GitHub Issues](https://github.com/browserbase/sdk-functions/issues)
- [Email Support](mailto:support@browserbase.com)
