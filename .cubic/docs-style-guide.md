# Stagehand docs prose guide

Severity: blocking. Every rule in this file is mandatory for prose added or modified by the PR. Flag violations as bugs, not suggestions. Do not block a focused PR for untouched legacy violations.

Apply these rules only to public-facing prose under `packages/docs/**`, including frontmatter descriptions, headings, navigation labels, paragraphs, tables, callouts, and authored code comments.

Do not apply prose rules to code identifiers, executable code, URLs, copied prompts, sample task strings, configuration examples, or logs. Do not request direct edits to generated SDK pages under `packages/docs/v3/sdk/`; report source-content problems against the owning SDK repository or `packages/docs/scripts/sync-sdk-docs.js`.

## Scope boundary

Review prose quality only. Stagehand docs are generally developer-facing, demand-capture content, but that default does not authorize this rule to make brand decisions.

Apply the narrow Stagehand positioning rules below. Other messaging decisions, claims, proof points, competitor references, restricted use cases, and sensitive terminology require a dedicated positioning-copy review that fetches the live Browserbase Messaging House. Do not treat frozen examples or remembered rules as the source of truth.

If a PR materially adds or changes a hero, tagline, product description, quantitative claim, customer proof point, competitor reference, or sensitive access terminology, leave one concise review-level note requesting live positioning review. Do not issue multiple inline comments, invent replacement messaging, or block the PR under this prose rule.

## Stagehand positioning

- Position Stagehand as Browserbase's SDK and AI browser driver for building browser agents. Do not position it as a general-purpose agent platform or as a browser automation framework.
- Keep the browser at the center. Explain how Stagehand combines deterministic code and AI-powered browser primitives instead of making broad claims about agent intelligence.
- Treat `act()`, `extract()`, `observe()`, and `agent()` as Stagehand primitives. Describe the user outcome before listing primitives or implementation details.
- Keep Stagehand distinct from Browserbase Agents. Stagehand is the SDK and browser driver; Agents is Browserbase's managed API product. Do not use the names interchangeably.
- Position computer use as one Stagehand capability, not Stagehand's identity.
- Connect top-level positioning to the Browserbase narrative that the web was not built for agents, but Browserbase is. Keep Stagehand copy focused on the developer's browser-agent workflow rather than the entire Browserbase platform.
- Lead with one primary idea per page or section. Do not compress every Browserbase product pillar into Stagehand copy.
- Do not lead Stagehand positioning with Search, Fetch, or other supporting Browserbase products.
- Do not use commodity-infrastructure metaphors such as pipes, roads, or raw compute. Explain the browser outcome directly.
- Do not recommend Director in new or modified copy. Director is sunset.

## Writing style

- Brevity is mandatory. Every sentence must earn its place. Cut filler words such as "just," "simply," "basically," "actually," "in order to," and "it should be noted that." If a sentence can be shorter without losing meaning, shorten it.
- Use sentence case in frontmatter `title` and `sidebarTitle` fields, Markdown headings, navigation groups, cards, tabs, accordions, and callout titles. Preserve the official casing of products, APIs, model names, and code identifiers.
- Use a conversational tone, not a casual one. Text should sound natural if spoken aloud. Contractions are encouraged. Do not use slang or filler phrases like "let's dive in" or "as you can see."
- Use active voice. For example, replace "the session is created" with "Browserbase creates the session" or "you create the session."
- Address the reader as "you," not "we."
- Require the Oxford comma before "and" or "or" in a list of three or more items.
- Do not use em dashes in prose, frontmatter, tables, or authored code comments. Use a period, colon, comma, parentheses, or a shorter sentence.
- Capitalize proper nouns and official product names consistently, including Browserbase, Stagehand, and Playwright. Default to lowercase for generic terms.
- Never use "we," "us," or "our" for Browserbase. Write "Browserbase recommends" or "Browserbase provides." Direct quotes from customers or team members may use first-person plural.

## Voice

- Lead with the outcome or main information, then add details.
- Prefer explicit language over clever phrasing. Write like an engineer stating a fact, not a keynote speaker.
- Remove hollow introductions such as "in today's fast-paced world."
- Avoid artificial rule-of-three padding and constructions such as "it's not just X, it's Y."
- Describe documented behavior and outcomes precisely. Do not imply reliability, autonomy, intelligence, or certainty beyond what the documented feature supports.
- For MCP and integration descriptions, lead with what the reader can do rather than broad company positioning.

## Structure and formatting

- Make content easy to skim. Use short sections, bullets, images, videos, or tables when they materially improve comprehension.
- Headings should outline a clear structure and make sense on their own.
- Front-load keywords for scanning.
- Make user choices and next steps obvious.

## Review comments

- Comment only on an actionable prose violation introduced or modified by the PR.
- Quote the exact text, name the rule it violates, and provide a concrete rewrite.
- Lead with the most important issue. Do not invent minor nits when the prose already satisfies the guide.
- Keep comments concise and decisive. Do not hedge with phrases such as "you might consider."
- If no actionable prose violation exists, approve the prose without manufacturing feedback.
