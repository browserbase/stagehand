# Stagehand V4 + Browserbase: Automated Job Application Workflow

## AT A GLANCE

- Goal: Automate job applications by discovering job listings and submitting applications with unique agent identifiers.
- Concurrent Processing: applies to multiple jobs in parallel with configurable concurrency limits based on Browserbase project settings.
- Dynamic Data Generation: generates unique agent IDs and email addresses for each application.
- File Upload Support: automatically uploads resume PDF from a remote URL during the application process.
- Docs → https://docs.stagehand.dev/v4/basics/act

## GLOSSARY

- act: perform UI actions from a prompt (click, type, fill forms)
  Docs → https://docs.stagehand.dev/v4/basics/act
- extract: extract structured data from web pages using natural language instructions
  Docs → https://docs.stagehand.dev/v4/basics/extract
- observe: analyze a page and return selectors or action plans before executing
  Docs → https://docs.stagehand.dev/v4/basics/observe
- semaphore: concurrency control mechanism to limit parallel job applications based on project limits

## QUICKSTART

1. pnpm install
2. cp .env.example .env
3. Add your Browserbase API key and Project ID to .env (BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID)
4. pnpm start

## EXPECTED OUTPUT

- Fetches project concurrency limit from Browserbase (maxed at 5)
- Initializes main Stagehand session with Browserbase
- Navigates to agent job board
- Clicks "View Jobs" button
- Extracts all job listings with titles and URLs using structured schema
- Closes main session
- Creates semaphore for concurrency control
- Applies to all jobs in parallel (respecting concurrency limit)
- For each job application:
  - Generates unique agent ID and email
  - Navigates to job page
  - Clicks on specific job
  - Fills agent identifier field
  - Fills contact endpoint (email) field
  - Fills deployment region field
  - Uploads resume PDF from remote URL
  - Selects multi-region deployment option
  - Submits application
- Displays completion message when all applications are finished

## COMMON PITFALLS

- Dependency install errors: ensure npm install completed
- Missing credentials: verify .env contains BROWSERBASE_PROJECT_ID and BROWSERBASE_API_KEY
- Concurrency limits: script automatically respects Browserbase project concurrency (capped at 5)
- Resume URL: ensure the resume URL (https://agent-job-board.vercel.app/Agent%20Resume.pdf) is accessible
- Job detection: verify that job listings are visible on the page and match expected structure
- Network issues: check internet connection and website accessibility
- Find more information on your Browserbase dashboard -> https://www.browserbase.com/sign-in

## USE CASES

• Bulk job applications: Automate applying to multiple job postings simultaneously with unique credentials for each application.
• Agent deployment automation: Streamline the process of deploying multiple AI agents by automating the application and registration workflow.
• Testing & QA: Validate job application forms and workflows across multiple listings to ensure consistent functionality.
• Recruitment automation: Scale agent recruitment processes by programmatically submitting applications with generated identifiers.

## NEXT STEPS

• Add filtering: Implement job filtering by title keywords, location, or other criteria before applying.
• Error handling: Add retry logic for failed applications and better error reporting with job-specific logs.
• Resume customization: Support multiple resume versions or dynamic resume generation based on job requirements.
• Application tracking: Store application status, timestamps, and results in a database for tracking and follow-up.
• Rate limiting: Add delays between applications to avoid overwhelming the target system.
• Multi-site support: Extend to support multiple job boards with site-specific form field mappings.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
