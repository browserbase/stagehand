# Docs style guide

Severity: blocking. Every rule in this file is mandatory. Flag violations as bugs, not suggestions. Do not approve a PR that violates any of these rules.

Apply these rules to public-facing documentation, docs navigation, README content, changelog prose, examples, and product copy.

Stagehand is a product/framework from Browserbase. The main focus of this documentation is Stagehand, NOT the Browserbase Platform.

## Writing style

Flag every violation, even minor ones.

- Brevity is mandatory. Every sentence must earn its place. Cut filler words: "just," "simply," "basically," "actually," "in order to," and "it should be noted that." If a sentence can be shorter without losing meaning, it must be.
- Use sentence case for all titles and headings. Only capitalize the first word and proper nouns.
- Use a conversational tone, not a casual one. Text should sound natural if spoken aloud. Contractions are encouraged. Do not use slang or filler phrases like "let's dive in" or "as you can see."
- Use active voice only. Flag passive voice. For example, replace "the session is created" with "Browserbase creates the session" or "you create the session."
- Use second person ("you") for the reader. Always address the reader as "you," never as "we." Flag any use of "we" to mean the reader.
- Require the Oxford comma. Always use a comma before "and" or "or" in a list of three or more items. Flag missing Oxford commas.
- Do not use em dashes. Replace them with commas, colons, parentheses, or shorter sentences.
- Capitalize product names, including Browserbase, Stagehand, Playwright, Functions, Search, and Identity. Default to lowercase for everything else. Flag inconsistent capitalization.
- Never use "we," "us," or "our" for Browserbase. Always refer to the company by name. This applies to first-person plural in any form: subject ("we"), object ("us"), possessive ("our"), and contractions ("we're," "we've," "we'll"). Flag every instance.
- Exception: direct quotes from customers or team members in case studies may use first-person plural.

## Tagline

- Current tagline: "Agents can now browse and interact with the web like humans."
- Deprecated tagline: "Autonomously read, write, and perform tasks on the web with a headless browser." Flag this if you see it.

## Structure and formatting

- Make content easy to skim. Use bullet points, break up text, and include images, videos, or tables where helpful.
- Headlines should outline a clear structure and make sense on their own.
- Lead with the main information. Get to the point fast, then add details. Front-load keywords for scanning.
- Make customer choices and next steps obvious.

## Code examples

- Default to SDK code examples over raw API calls whenever possible.
- Highlight the pieces that change and link to related docs.

## SEO

- Write with new users, search terms, and AI consumption in mind.

## Terminology

Use these terms consistently:

| Use this                             | Not this                          |
| ------------------------------------ | --------------------------------- |
| browser agent                        | web agent                         |
| agents                               | AI, in most external copy         |
| headless browsers                    | serverless browsers               |
| agent identity                       | stealth                           |
| SDK for browser agents (Stagehand)   | browser automation framework      |
| agents                               | agentic workflows                 |
| browser agent platform (Browserbase) | browser automation infrastructure |

- Do not reference automation or scraping in public-facing positioning.
- Do not reference competitors by name in public-facing docs.

## Product descriptions

Use these canonical descriptions when referring to Browserbase products:

- Browserbase: the complete platform to build and deploy agents that browse and interact with the web like humans.
- Browsers: programmatic access to fleets of headless browsers with globally distributed infrastructure, isolated sessions, and built-in observability.
- Stagehand: the SDK for browser agents, combining Playwright-level control with AI primitives (act, extract, observe).
- Agent Identity: strategic partnerships and secure credential management that get agents past anti-bot systems, CAPTCHAs, and authentication walls.
- Functions: deploy and run agents on Browserbase with sub-5ms latency to the browser, zero infrastructure.
- Fetch and Search APIs: quick, token-efficient web context for agents. Treat these as supporting primitives, not headline products.
- Model Gateway: access to major models via a single Browserbase API key with unified billing.
- Browse CLI: lightweight entry point for giving agents browsing capabilities without writing integration code.
