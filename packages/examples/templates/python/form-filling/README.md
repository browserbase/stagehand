# Stagehand + Browserbase: Form Filling Automation

Stagehand is the SDK for browser agents.

## AT A GLANCE

- Goal: showcase how to automate form filling with Stagehand and Browserbase.
- Smart Form Automation: dynamically fill contact forms with variable-driven data.
- AI-Powered Interaction: use `act()` to map each labeled input to the right field reliably.
- Variable-driven actions: fill each form control with the supplied sample values.
  Docs → https://docs.browserbase.com/fundamentals/create-browser-session

## GLOSSARY

- act: perform UI actions from a prompt (type, click, fill forms)
  Docs → https://docs.stagehand.dev/v4/basics/act
- variable substitution: inject dynamic values into actions using `%variable%` syntax

## QUICKSTART

1.  cd form-filling
2.  uv venv && source .venv/bin/activate # On Windows: .venv\Scripts\activate
3.  pip install stagehand python-dotenv
4.  cp .env.example .env # Add your Browserbase API key to .env
5.  python main.py

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase
- Navigates to contact form page
- Fills form with sample data using `act()` and variable substitution
- Closes session cleanly

## COMMON PITFALLS

- "ModuleNotFoundError": ensure all dependencies are installed via pip
- Missing credentials: verify .env contains all required API keys
- Form detection: ensure target page has fillable form fields
- Variable mismatch: ensure variable names in action match variables object
- Network issues: check internet connection and website accessibility
- Import errors: activate your virtual environment if you created one

## USE CASES

• Lead & intake automation: Auto-fill contact/quote/request forms from CRM or CSV to speed up inbound/outbound workflows.
• QA & regression testing: Validate form fields, required rules, and error states across releases/environments.
• Bulk registrations & surveys: Programmatically complete repeatable sign-ups or survey passes for pilots and internal ops.

## NEXT STEPS

• Wire in data sources: Load variables from CSV/JSON/CRM, map fields via observe, and support per-site field aliases.
• Submit & verify: Enable submit, capture success toasts/emails, take screenshots, and retry on validation errors.
• Handle complex widgets: Add file uploads, multi-step flows, dropdown/radio/datepickers, and basic anti-bot tactics (delays/proxies).

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
