# Stagehand + Browserbase: Form Filling Automation

## AT A GLANCE

- Goal: showcase how to automate form filling with Stagehand and Browserbase.
- Smart Form Automation: dynamically fill contact forms with variable-driven data.
- Observe → Act: discovers the live form controls once, then fills the observed actions with the matching values.
- Variable-driven actions: pair observed form controls with the supplied sample values.
  Docs → https://docs.browserbase.com/fundamentals/create-browser-session

## GLOSSARY

- observe / act: discover interactive elements, then execute the observed actions
  Docs → https://docs.stagehand.dev/v4/basics/observe

## QUICKSTART

1. cd form-filling
2. npm install
3. cp .env.example .env
4. Add your Browserbase API key and Project ID to .env
5. npm start

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase
- Navigates to contact form page
- Fills the known form fields and help dropdown with sample data
- Closes both the Stagehand instance and browser handle after the workflow
- Closes session cleanly

## COMMON PITFALLS

- "Cannot find module": ensure all dependencies are installed
- Missing credentials: verify .env contains all required API keys
- Field mismatch: adjust the semantic field descriptions if the contact form changes
- Network issues: check internet connection and website accessibility

## USE CASES

• Lead & intake automation: Auto-fill contact/quote/request forms from CRM or CSV to speed up inbound/outbound workflows.
• QA & regression testing: Validate form fields, required rules, and error states across releases/environments.
• Bulk registrations & surveys: Programmatically complete repeatable sign-ups or survey passes for pilots and internal ops.

## NEXT STEPS

• Wire in data sources: Load variables from CSV/JSON/CRM and add per-site field mappings.
• Submit & verify: Enable submit, capture success toasts/emails, take screenshots, and retry on validation errors.
• Handle complex widgets: Add file uploads, multi-step flows, dropdown/radio/datepickers, and basic anti-bot tactics (delays/proxies).

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
