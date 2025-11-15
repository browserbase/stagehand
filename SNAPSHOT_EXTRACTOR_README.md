# Stagehand Snapshot Extractor Scripts

Two scripts to extract accessibility tree snapshots from web pages using Stagehand's internal implementation.

## 📋 What These Scripts Do

Both scripts take a URL and extract the **exact data that Stagehand sends to an LLM** before performing browser automation:

1. **Accessibility Tree** - Human-readable outline of the page structure
2. **XPath Map** - Maps element IDs to precise XPath selectors
3. **URL Map** - Maps element IDs to their href/src URLs
4. **LLM Prompt Template** - Shows the exact prompt format sent to GPT-4

## 🔧 Prerequisites

```bash
# Install dependencies (from repo root)
pnpm install
```

## 🚀 Usage

### Option A: Using V3 Class (Recommended)
Uses Stagehand's high-level V3 class - cleanest and most reliable.

```bash
node --import tsx snapshot-extractor-option-a.ts <URL>
```

**Example:**
```bash
node --import tsx snapshot-extractor-option-a.ts https://jobs.netflix.com/jobs/12345
node --import tsx snapshot-extractor-option-a.ts https://www.google.com/forms/application
node --import tsx snapshot-extractor-option-a.ts https://greenhouse.io/apply/12345
```

### Option B: Using Direct CDP Calls
Uses Playwright + CDP directly - more control over browser setup.

```bash
node --import tsx snapshot-extractor-option-b.ts <URL>
```

**Example:**
```bash
node --import tsx snapshot-extractor-option-b.ts https://jobs.netflix.com/jobs/12345
```

## 📁 Output Files

All outputs are saved to `snapshot-output/` directory with timestamped filenames:

```
snapshot-output/
├── <url>_<timestamp>_snapshot.txt        # Accessibility tree
├── <url>_<timestamp>_xpath-map.json      # Element ID → XPath mappings
├── <url>_<timestamp>_url-map.json        # Element ID → URL mappings
├── <url>_<timestamp>_llm-prompt.txt      # Example LLM prompt
└── <url>_<timestamp>_summary.json        # Stats and metadata
```

### Example Output: `snapshot.txt`

```
[1-1] WebArea: Job Application - Software Engineer
  [1-10] banner: Company Header
    [1-11] link: Home
    [1-12] link: Careers
  [1-20] main: Application Form
    [1-21] heading: Personal Information
    [1-22] textbox: Full Name
    [1-23] textbox: Email Address
    [1-24] textbox: Phone Number
    [1-30] heading: Work Experience
    [1-31] textbox: Current Company
    [1-32] textbox: Years of Experience
    [1-40] button: Upload Resume
    [1-41] button: Submit Application
```

### Example Output: `xpath-map.json`

```json
{
  "1-22": "/html/body/main/form/div[1]/input[1]",
  "1-23": "/html/body/main/form/div[1]/input[2]",
  "1-24": "/html/body/main/form/div[1]/input[3]",
  "1-40": "/html/body/main/form/button[1]",
  "1-41": "/html/body/main/form/button[2]"
}
```

### Example Output: `summary.json`

```json
{
  "url": "https://jobs.netflix.com/jobs/12345",
  "timestamp": "2025-11-15T12:34:56.789Z",
  "stats": {
    "totalElements": 45,
    "totalLinks": 8,
    "treeLineCount": 52,
    "treeCharCount": 3421
  },
  "files": {
    "snapshot": "jobs_netflix_com_2025-11-15_snapshot.txt",
    "xpathMap": "jobs_netflix_com_2025-11-15_xpath-map.json",
    "urlMap": "jobs_netflix_com_2025-11-15_url-map.json",
    "llmPrompt": "jobs_netflix_com_2025-11-15_llm-prompt.txt"
  }
}
```

## 🔍 Differences Between Option A and Option B

| Feature | Option A (V3 Class) | Option B (Direct CDP) |
|---------|---------------------|----------------------|
| **Complexity** | Simple (~150 lines) | Medium (~200 lines) |
| **Browser Setup** | Handled by V3 | Manual Playwright |
| **CDP Session** | Automatic | Manual |
| **Page Wrapper** | Automatic | Manual |
| **Reliability** | High (uses V3's logic) | High (more control) |
| **Use Case** | Quick extraction | Custom browser config |

**Recommendation:** Start with **Option A** unless you need custom browser settings.

## 🎯 Use Cases

### 1. Analyze Job Application Forms
```bash
# Extract snapshots from 100 different job applications
for url in $(cat job-urls.txt); do
  node --import tsx snapshot-extractor-option-a.ts "$url"
done
```

### 2. Compare Form Complexity
```bash
# See which companies have the most form fields
node --import tsx snapshot-extractor-option-a.ts https://company1.com/apply
node --import tsx snapshot-extractor-option-a.ts https://company2.com/apply
# Check stats.totalElements in the summary.json files
```

### 3. Build Training Datasets
- Extract accessibility trees from 1000s of pages
- Use as training data for form-filling models
- Analyze patterns in form field naming

### 4. Test LLM Accuracy
- Feed the accessibility tree to different LLMs
- Ask them to identify specific fields
- Compare their responses

## 📊 Understanding the Output

### Accessibility Tree Format
```
[elementId] role: name
```

- **elementId**: Format `frameOrdinal-backendNodeId` (e.g., `1-42`)
- **role**: ARIA role (button, textbox, link, heading, etc.)
- **name**: Accessible name (label, placeholder, or text content)

### How Stagehand Uses This

1. **User asks**: "fill the email field with test@example.com"
2. **Stagehand sends** accessibility tree + instruction to GPT-4
3. **GPT-4 returns**: `{ "elementId": "1-23", "method": "fill", "arguments": ["test@example.com"] }`
4. **Stagehand looks up**: `xpathMap["1-23"]` → `"/html/body/main/form/input[2]"`
5. **Stagehand executes**: `page.locator('xpath=/html/body/main/form/input[2]').fill('test@example.com')`

## 🐛 Troubleshooting

### Browser doesn't launch
```bash
# Install Playwright browsers
npx playwright install chromium
```

### "Cannot find module" errors
```bash
# Ensure you're running from repo root
cd /path/to/stagehand2
pnpm install
```

### Page loads but snapshot is empty
- Increase wait time (edit `domSettleTimeoutMs` or `waitForTimeout`)
- Check if page requires authentication
- Try with `headless: false` to see what's happening

### TypeScript errors
```bash
# Make sure you're using tsx
node --import tsx snapshot-extractor-option-a.ts <URL>
```

## 📚 Related Files

- **Source**: `packages/core/lib/v3/understudy/a11y/snapshot.ts` - Snapshot implementation
- **V3 Class**: `packages/core/lib/v3/v3.ts` - Main Stagehand class
- **Examples**: `packages/core/examples/` - Official examples

## ⚙️ Configuration Options

### Option A Customization
Edit `snapshot-extractor-option-a.ts`:

```typescript
const v3 = new V3({
  env: "LOCAL",
  verbose: 2,              // 0=silent, 1=errors, 2=info
  headless: false,         // Set to false to see browser
  domSettleTimeoutMs: 5000, // Wait longer for dynamic pages
});
```

### Option B Customization
Edit `snapshot-extractor-option-b.ts`:

```typescript
const browser = await chromium.launch({
  headless: false,         // See the browser
  slowMo: 500,            // Slow down actions
  args: ["--window-size=1920,1080"],
});
```

## 🎓 Learning Resources

- **Stagehand Docs**: https://stagehand.dev
- **CDP Protocol**: https://chromedevtools.github.io/devtools-protocol/
- **Accessibility Tree**: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA

## 📝 License

MIT - Same as Stagehand repository
