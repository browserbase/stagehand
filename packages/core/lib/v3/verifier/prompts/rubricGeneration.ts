/**
 * Rubric generation prompt — Step 0a of the rubric verifier pipeline.
 *
 * Used when a task has no precomputed_rubric (i.e., everything except
 * upstream WebTailBench). The LLM generates a structured rubric of criteria
 * from the task description alone, which gets cached to disk per task id.
 *
 * Variables:
 *   - task_id           — the task instruction string
 *   - init_url_context  — optional "Starting URL: ..." appendix (use buildInitUrlContext)
 *
 * Note on `$$`: Python's `string.Template` treats `$$` as a literal `$`.
 * The renderPrompt() helper preserves that semantics — `$$200` in the
 * template renders as `$200` in the final prompt sent to the model.
 */
export const RUBRIC_GENERATION_PROMPT = `Task: $task_id$init_url_context
    You are an expert tasked with analyzing a given task to identify the key points and sub-goals explicitly stated in the task description to create a rubric for evaluation.

    **Objective**: Carefully analyze the task and extract the critical elements/goals/success criteria **explicitly** mentioned in the task for achieving its goal. Output a set of criteria that can be used to evaluate how well an Agent completed the task, along with descriptions of how to award points for each criterion.

    **Critical Point Definition**
    NOTE: The rubric should **not** contain criteria that violate a "Critical Point" or penalize scores for not crossing a Critical Point. A Critical Point, e.g. involving 'Checkout', 'Book', 'Purchase', 'Call', 'Email', etc, is a binding transaction/agreement that would require the user's permission to use personal or sensitive information (name, email, credit card, address, email, resume, etc) in order to complete a transaction (purchase, reservation, etc) or enter into a communication that a human would be expected to do (e.g. call or email).
    - For example, when purchasing a product, it is acceptable have a criterion to "Add to Cart", or select the desired timeslot to book a reservation, but it **NOT** acceptable to propose a criteria to actually complete the checkout process (requiring entering the user's name, address, credit card, or sign into their account, etc unless specified in the Task). Stopping on the "Customer Details" is generally acceptable. If some stores/restaurants require a location before showing the product or reservation, the agent can enter a location (e.g. city) if known, but should not enter any personal information (e.g. name, email, phone number, etc).
    - For example, if the task is to "call a restaurant to make a reservation," the success criteria should not say to make the call but rather to **find** the phone number.
    - Similarly, if the task is to "order new size 12 running shoes" the criteria should not say place the order but instead find the right shoes and add them to the cart.
    - If the task contains user information like name/email/address/etc, make a criterion stating that **other** user information not provided in the task is not "made up", and only what is given is reflected accurately in e.g. the checkout process.

    **Controllable vs. Uncontrollable Factors** (Critical for Fair Evaluation):
    When creating rubric criteria, distinguish between factors within and outside the agent's control. The agent should receive full credit for accurately identifying and reporting uncontrollable blockers, OR for achieving the primary intent through reasonable alternatives when specified methods fail.

    **UNCONTROLLABLE FACTORS** (Full credit for identifying/reporting these):
    1. **Platform/Infrastructure Issues**: Website down, blocked by CAPTCHA, login walls (without credentials), server errors, missing functionality
    2. **Entity Non-Existence**: Restaurant/business closed or doesn't exist, product discontinued, service no longer available, person/entity not in directory
    3. **Availability/Inventory Constraints**: No reservations/flights on requested date, out of stock, sold out, seasonal unavailability
    4. **Search Result Limitations**: No exact match exists, requested attribute combination impossible, empty result sets
    5. **Platform Capability Limitations**: Platform doesn't list the entity, platform doesn't support required action, platform requires critical point crossing to proceed, but perhaps another platform does.
    6. **Information Accuracy Issues Beyond Agent Control**: Third-party data outdated, price/availability changed during browsing, conflicting information across sources

    **CONTROLLABLE FACTORS** (Should be penalized):
    1. **Primary Intent Violations**: Wrong entity (restaurant/product name), wrong critical attributes (date/location) when correct ones available, ignoring explicit constraints when alternatives exist
    2. **Navigation and Search Errors**: Not attempting specified platform when accessible, poor search strategy, not using available filters
    3. **Execution Errors**: Incorrect data entry, skipping required steps, wrong selections from available options
    4. **Communication Failures**: Not reporting blockers encountered, hallucinations (claiming success without evidence), incomplete reporting, false unavailability claims
    5. **Insufficient Effort**: Premature abandonment after single attempt, not trying alternatives when appropriate, immediately using alternatives without attempting specified approach
    6. **Misunderstanding Task Requirements**: Crossing critical points unnecessarily, adding unrequested steps, ignoring task scope

    **Interpret Task Verbs Charitably (Do NOT Over-Literalize)**:
    Many tasks use casual, everyday language. Interpret task verbs as a reasonable user would intend them, NOT in an overly literal or academic sense. The agent is a web navigation assistant — the user wants the agent to find things, navigate to pages, and report back useful information. They are NOT asking for formal academic outputs unless explicitly stated.

    Common examples of verbs and similar subjective terms that should be interpreted charitably:
    - **"Locate"**, **"find"**, **"pull up"**, **"look up"**, **"check"**: Navigate to the relevant page/content and report the key information. Do NOT require the agent to output a URL unless explicitly asked.
    - **"Review"**, **"read"**, **"look at"**, **"go through"**: Navigate to the content and provide a reasonable summary or overview of what was found. Do NOT require a formal structured review, literary critique, or exhaustive analysis. A brief summary of the key points visible on the page is sufficient.
    - **"Show me"**, **"get me"**: Find and present the relevant information. The user wants to see the content, not a URL.
    - **"Research"**, **"explore"**: Browse relevant sources and report findings. Do NOT require academic-level depth unless explicitly stated.

    When creating rubric criteria for these or similar kinds of subjective verbs, the success criteria should focus on whether the agent **found the right content and reported useful information**, NOT on the depth, format, or presentation style of the output.

    **SubGoal Definition**:
    A **subgoal** is a critical element, condition, or step **explicitly** mentioned in the task description required for success.
    - Do not infer or add any unstated subgoals or criteria, e.g. if the task is "what standard length of vinyl outside corner trim does HomeDepot sell?", do NOT add a criterion requiring the URL of the product, because it was not asked.
    - **Intermediate Discovery vs. Required Output**: Criteria may verify that the agent *found, viewed, or interacted with* the correct intermediate results during navigation (e.g., "searched for and reviewed relevant Azure courses on Coursera"), but should NOT require the agent to *output or list* those intermediate results unless the task explicitly asks for them. For example, if the task is "find which Azure course on Coursera has the most flexible schedule," the agent should receive credit for browsing and reviewing multiple Azure courses (visible in screenshots/actions), but should NOT be penalized for only reporting the most flexible one in its final answer — that is all the task asked for.
    - Do not make redundant or overlapping criteria (e.g. for the task "book a flight on air asia", do NOT make separate criteria for "access airasia.com" and "ensure AirAsia as the booking platform" since they are redundant)
    - Separate **what** the subgoals are from **how** to evaluate them

    **CRITICAL: Handling Conditional Criteria**:

    Some tasks contain **conditional requirements** that only apply when specific conditions are met. These must be modeled explicitly using a "condition" field.

    **When to create a conditional criterion**:
    - Task contains phrases like "if...", "let me know if...", "report any issues", "in case of unavailability"
    - The requirement only applies when a specific trigger condition occurs
    - Examples:
      * "Add flour to cart. Let me know if there are availability issues." → Reporting is conditional on encountering issues
      * "Book a direct flight, or if none available, book a one-stop flight." → One-stop criterion is conditional on no direct flights existing
      * "Buy organic blueberries, or if unavailable, buy non-organic." → Non-organic criterion is conditional on organic being unavailable

    **How to structure conditional criteria**:
    1. Add a "condition" field (string) that describes the triggering condition
    2. In the "description" field, explain both the condition AND how to score if condition is met
    3. Make it clear that points are ONLY counted if the condition is met

    **Schema for conditional criteria**:
    {{
        "criterion": "Brief name of what's being evaluated",
        "condition": "Clear description of when this criterion applies (e.g., 'Only applies if organic blueberries are unavailable')",
        "task_span": "Verbatim substring of the original task that THIS criterion is evaluating (e.g., 'organic blueberries')",
        "description": "What to evaluate and how to score IF the condition is met. Full credit for..., partial credit for...",
        "max_points": N,
        "justification": "",
        "earned_points": ""
    }}

    **Schema for non-conditional criteria** (most criteria):
    {{
        "criterion": "Brief name of what's being evaluated",
        "task_span": "Verbatim substring of the original task that THIS criterion is evaluating (e.g., 'add flour to cart')",
        "description": "What to evaluate and how to score. Full credit for..., partial credit for...",
        "max_points": N,
        "justification": "",
        "earned_points": ""
    }}
    (Note: No "condition" field means the criterion always applies)

    **task_span — ANTI-HALLUCINATION ANCHOR (REQUIRED)**:
    Every criterion **must** include a "task_span" field whose value is a **verbatim substring** of the original task description (the text after "Task:" above). This is the literal phrase from the task that justifies including this criterion.
    - If you cannot copy a contiguous substring of the task that justifies the criterion, **the criterion does not belong in the rubric** — the task did not ask for it. Drop it.
    - Substrings shorter than 3 words are not enough — pick a span that makes the connection unambiguous.
    - Do NOT paraphrase, summarize, or normalize the span. Copy it character-for-character so a downstream check can verify it is a substring of the task.
    - For setup/platform criteria implied by the task's specified platform, copy the platform name verbatim (e.g., task_span: "drugssquare.com").
    - For Critical Point boundary criteria, you may use the special token "<critical-point>" — this is the ONE permitted non-substring value, since the Critical Point rule is supplied by these instructions, not the task text.

    **Important**: Do NOT create conditional criteria for requirements that are implicitly satisfied by successful task completion.
    - Example: "Add flour to cart. Let me know if unavailable."
      * WRONG: Separate conditional criterion "Report unavailability (condition: flour unavailable)"
      * RIGHT: Single criterion "Add flour to cart" with description: "Full credit if flour added to cart successfully OR if flour is unavailable and agent reports this"
    - Why? Because successful addition implies availability, and we want to avoid the agent needing to explicitly state the obvious.

    **When TO create a conditional criterion**:
    - When the task explicitly requests an alternative action or fallback behavior
    - When you have mutually exclusive options (only one should be counted based on circumstances)

    **IMPORTANT: Mutually Exclusive Conditionals**:
    When a task has mutually exclusive alternatives (only one should apply), make ALL alternatives conditional with opposite conditions. This ensures only ONE is counted.

    Common pattern example: "do X, or if X unavailable, do Y"
    - Make BOTH X and Y conditional with opposite conditions
    - Only the applicable one will be counted during scoring

    Concrete example: "Buy organic blueberries, or if unavailable, buy non-organic"
    - Criterion 1: "Buy organic blueberries" (condition: "Only applies if organic blueberries are available")
    - Criterion 2: "Buy non-organic blueberries" (condition: "Only applies if organic blueberries are unavailable")
    - During scoring: Only ONE will have is_condition_met=true, so only ONE is counted

    **Examples**:

    Example 1: "Add flour and vegetable oil to cart at Ralphs. Let me know if there are availability issues."
    - Criterion 1: Add flour to cart [no condition field] - Description includes: "Full credit if flour added OR if unavailable and agent reports this"
    - Criterion 2: Add vegetable oil to cart [no condition field] - Description includes: "Full credit if oil added OR if unavailable and agent reports this"
    - Do NOT create separate conditional criteria for reporting, since successful addition implies availability

    Example 2: "Buy organic blueberries at Whole Foods. If they don't have organic, buy non-organic ones. If they don't have any blueberries at all, let me know."
    - Criterion 1: Buy organic blueberries [condition: "Only applies if organic blueberries are available"]
    - Criterion 2: Buy non-organic blueberries [condition: "Only applies if organic blueberries are unavailable but non-organic are available"]
    - Criterion 3: Report complete unavailability [condition: "Only applies if neither organic nor non-organic blueberries are available"]
    - Note: Exactly ONE of these three criteria will have is_condition_met=true during scoring

    **Ensure Criterion Disjointness (Avoid Double-Penalty Structures)**:
    Make criteria as disjoint and non-overlapping as possible to avoid penalizing the same mistake multiple times.

    **Key Principle**: If criterion A penalizes for not using platform/method X, then other criteria should evaluate task completion aspects (finding entities, making selections, progressing workflows) **independently** of whether platform/method X was used.

    **Pattern to AVOID** (Double-penalty):
    - Criterion 1: "Identify a Mexican restaurant on gayot.com"
    - Criterion 2: "Reach reservation interface on gayot.com"
    - Problem: Both penalize for not using gayot.com → agent loses points twice for same mistake

    **Pattern to FOLLOW** (Disjoint):
    - Criterion 1: "Attempt gayot.com as the specified platform" (evaluates platform usage)
    - Criterion 2: "Identify a Mexican restaurant in Chicago's Northside" (evaluates entity identification, independent of platform)
    - Criterion 3: "Reach a reservation booking interface for the restaurant" (evaluates workflow progress, independent of platform)
    - Result: If gayot.com fails, agent only loses points on Criterion 1, not on 2 and 3

    **Do Not Create Duplicate Criteria**:
    Do NOT create multiple criteria that penalize the same mistake. Duplicate criteria create "double jeopardy" — the agent is unfairly penalized twice for a single error, which distorts scores. If two candidate criteria would both deduct points for the same failure, either combine them into a single criterion or restructure them so each evaluates a truly independent aspect.

    **Examples of duplicates to avoid**:
    - "Progress booking flow up to Critical Point" + "Respect Critical Point and avoid personal info"
      → Instead, create ONE criterion: "Progress booking flow up to (but not beyond) the Critical Point, stopping before entering personal/payment information"
    - "Add product to cart" + "Do not complete checkout"
      → Instead, create ONE criterion: "Add product to cart and stop before entering personal/payment details"
    - "Add the liquid ingredients to the Target cart" + "Ensure only liquid ingredients are added to the cart"
      → Instead, create ONE criterion: "Add only the liquid ingredients to the Target cart" — the action and the constraint evaluate the same thing: whether the correct items (and only the correct items) were added. Adding a wrong item should be penalized once, not twice.
    - "Identify suitable online purchase options for each listed spice/seasoning" + "Limit purchasing scope to spices/seasonings only"
      → Instead, create ONE criterion: "Identify suitable online purchase options for only the listed spices/seasonings" — the scope constraint is already implicit in the action: if the agent correctly identifies options for each listed spice, it has necessarily limited scope to spices.

    **Test for duplication**: Ask yourself: "If the agent makes mistake X, would it lose points in multiple criteria?" If YES, either combine those criteria into one or restructure them so each criterion evaluates a genuinely independent aspect of the task.

    **Decompose List-Style Tasks into Per-Item Criteria**:
    When a task contains a "laundry list" of items to perform the same action on (e.g., "add ground beef, onion, garlic, black beans, corn, tomato sauce, chili powder, cumin, cheddar cheese, and cornbread mix to my cart"), create a **separate criterion for each item** rather than a single criterion for all items combined.

    **When to apply this rule**:
    - The task lists 3 or more items/entities that all require the same type of action (e.g., add to cart, search for, book, find, look up, etc.)
    - The items are independently actionable (success/failure on one item does not inherently depend on another)

    **Why**: Each item may have independent failure modes (out of stock, not found, wrong product selected, different availability). A single combined criterion cannot fairly award partial credit when some items succeed and others fail. Separate criteria allow precise, per-item scoring.

    **How**: Create one criterion per item, each with its own max_points and description including item-specific partial credit guidance (e.g., out of stock, wrong variant selected, not found after reasonable search).

    **Example**: Task: "Add ground beef, onion, garlic, black beans, and corn to my cart on Stop & Shop"
    - WRONG: Single criterion "Add all grocery items to cart" [10 points]
    - RIGHT: Separate criteria:
      * "Add ground beef to cart" [2 points] — Full credit if added, or if unavailable and agent reports this. Partial credit for wrong cut/variant when correct one is available.
      * "Add onion to cart" [2 points] — Full credit if added, or if unavailable and agent reports this.
      * "Add garlic to cart" [2 points] — Full credit if added, or if unavailable and agent reports this.
      * "Add black beans to cart" [2 points] — Full credit if added, or if unavailable and agent reports this.
      * "Add corn to cart" [2 points] — Full credit if added, or if unavailable and agent reports this.

    **Note**: You may still have additional criteria for platform access (e.g., "Access the Stop & Shop website") or Critical Point boundaries, separate from the per-item criteria.

    **Partial Credit Guidance** (to be incorporated into the "description" field of each criterion):
    Each criterion's "description" field must specify how to handle both successful completion AND common failure modes caused by external factors. Use the framework below:

    **1. Primary Intent vs. Secondary Constraints**:
    - **Primary intent**: The core objective that defines task success (e.g., "book reservation at Restaurant X on date Z")
    - **Secondary constraints**: Preferred methods/platforms (e.g., "using platform Y")
    - Award **FULL credit** if primary intent is achieved through reasonable alternatives when secondary constraints are impossible due to uncontrollable factors
    - Award **PARTIAL credit** if secondary constraints are ignored without attempting them first, but primary intent is still achieved
    - Award **NO credit** if primary intent is violated (e.g., booking wrong restaurant name or wrong date when correct ones are available)

    **2. Entity Non-Existence Scenarios**:
    - If a specified entity (restaurant, product, business, service) no longer exists or cannot be found after reasonable search, award **FULL credit** for clearly reporting this finding
    - If an entity doesn't exist, award **FULL credit** for either: (a) reporting non-existence OR (b) identifying a reasonable alternative that matches the primary intent
    - Examples: Restaurant closed permanently, product discontinued, airline no longer operates that route, person not in directory

    **3. Availability and Inventory Constraints**:
    - For time-sensitive requests (dates, times, reservation slots), award **FULL credit** for accurately reporting unavailability when the requested option genuinely doesn't exist
    - Award **FULL credit** for either: (a) clearly stating unavailability OR (b) selecting the best available alternative that matches primary intent
    - Examples: No direct flights on requested date, restaurant fully booked, product out of stock, hotel no vacancy

    **4. Platform Capability Limitations**:
    - If a specified platform cannot support the required action (e.g., platform doesn't list the entity, platform blocks access, platform requires critical point crossing), award **FULL credit** for either: (a) reporting this limitation OR (b) achieving the goal through an alternative platform
    - Do NOT penalize for using alternative platforms when the specified platform is genuinely incapable or inaccessible
    - Example: Platform Y doesn't have Restaurant X listed → full credit for booking Restaurant X on Platform Z instead

    **5. Search Results and Filtering Constraints**:
    - When a task involves multiple filtering criteria but no result satisfies them all, award **FULL credit** if the agent: (a) identifies the best available option matching the **primary intent**, OR (b) states that no exact match exists, OR (c) both
    - For subjective tasks (e.g., "find the best new sushi restaurant"), award **FULL credit** for consulting authoritative sources and making reasonable selections
    - Example: Task requests "100% cotton Power Rangers hoodie" but only polyester hoodie exists → full credit for recommending the hoodie OR stating no exact match

    **6. Reasonable Effort Requirements**:
    - Award **FULL credit** only if the agent demonstrates reasonable effort before resorting to alternatives (attempting the specified approach, encountering genuine blocker, THEN reporting/finding alternative)
    - Award **PARTIAL credit** if agent immediately defaults to alternatives without attempting the specified approach when it was accessible
    - Award **NO credit** for premature abandonment without reasonable attempt

    **Instructions**:
    1. Read the task description carefully.
    2. Identify and extract **subgoals** directly stated in the task, and describe how to evaluate each subgoal, including how to award partial credit for common failure modes or external dependencies outside the agent's control.
    3. Output a minimal rubric to grade how well an Agent completed the subgoals. You will format your output as a rubric with the following elements/fields

    The rubric must be:
    1. Formatted as json dictionary of a (possibly nested) list of "items"
    2. Each Item in the rubric must contain the following fields IN ORDER:
       - For CONDITIONAL criteria: ["criterion", "condition", "task_span", "description", "max_points", "justification", "earned_points"]
       - For NON-CONDITIONAL criteria: ["criterion", "task_span", "description", "max_points", "justification", "earned_points"]
       - The "condition" field should ONLY be present for conditional criteria (criteria that only apply when specific conditions are met)
       - The "task_span" field is REQUIRED on every criterion (verbatim substring of the task, or "<critical-point>" for Critical Point boundary criteria only)
    3. Choose the "max_points" judiciously to account for possible failure modes that could earn partial credit: goals that would have more failure modes deserve higher max_points.
    4. The "description" should explain *what* goal the criteria is evaluating and *how* partial credit could be awarded to fairly penalize the agent's mistakes while accounting for external dependencies outside the agent's control.
    5. For conditional criteria, the "condition" field must clearly state when the criterion applies (e.g., "Only applies if organic blueberries are unavailable")
    6. Leave the "earned_points" and "justification" fields **empty** (since this rubric isn't being evaluated right now).
    7. Do not make criteria for formatting/style unless stated explicitly in the Task.
    8. Keep the rubric simple, following ONLY the main keypoints the task required. Do not overcomplicate the criteria or include optional items that were not explicitly mentioned.

    **ANTI-PATTERN — Over-Specification / Hallucinated Sub-Goals**:
    A common failure mode is inventing criteria that the task never asked for. If a criterion's task_span isn't a substring of the original task description (and it isn't the Critical Point boundary), the criterion is over-specifying.

    Anti-example task: "Find the citation page for the City of Vancouver."
    - WRONG criterion: "Display the citation number, fine amount, and payment due date" — the task did not ask for any of these specific fields. There is no "citation number" or "fine amount" in the task text.
      * task_span: <none possible> → drop.
    - WRONG criterion: "Provide instructions for paying the citation online" — the task did not ask for payment instructions.
      * task_span: <none possible> → drop.
    - RIGHT criterion: "Locate the citation page on the City of Vancouver site" [3 points]
      * task_span: "citation page for the City of Vancouver"
      * Description: Full credit if agent navigates to the citation/ticket page on the official cityofvancouver site, or if no such page exists and agent reports this. Partial credit for finding an unrelated city services page.

    Anti-example task: "Search arXiv for the most recent paper on retrieval-augmented generation."
    - WRONG criterion: "Output the abstract and author list of the paper" — task didn't ask for abstract or author list. The agent just needs to identify and report the paper.
      * task_span: <none possible> → drop.
    - RIGHT criterion: "Identify the most recent arXiv paper on retrieval-augmented generation" [4 points]
      * task_span: "most recent paper on retrieval-augmented generation"

    **The test**: For each criterion you draft, ask: "Can I copy a contiguous substring of the task that this criterion is evaluating?" If no, the criterion is over-specifying and must be dropped.

    ==================
    Example 1 (high level): "Book a reservation at a Mexican restaurant in the Northside of Chicago on 09/29/2025 for 2:45 PM at gayot.com."
    High level rubric:
        - Start on gayot.com as the specified platform [2 points] //Full credit if: (a) agent attempts gayot.com but it's blocked/unavailable and clearly reports this, OR (b) agent successfully completes the booking through an alternative platform after determining gayot.com cannot complete the booking
        - Identify a Mexican restaurant in Chicago's Northside [3 points] //Full credit for correct identification. Partial credit if restaurant location is ambiguous or not clearly in Northside. No credit if wrong cuisine type when Mexican options exist
        - Reach a reservation booking interface for the restaurant [2 points] //Full credit for ANY reservation booking interface (decoupled from platform criterion to avoid double-penalizing). Full credit if restaurant doesn't offer online booking and agent reports this
        - Attempt date/time selection for 09/29/2025 at 2:45 PM [3 points] //Full credit if: (a) correct date/time selected, OR (b) that date/time is unavailable and agent clearly indicates this, OR (c) agent selects closest available alternative and explains why. No credit if wrong date selected when correct date is available
        - Respect Critical Point boundaries (no personal info or final booking) [2 points] //Full credit for stopping before entering personal information. Deduct if agent unnecessarily crosses critical point

    Takeaway: Make criteria as disjoint and non-overlapping as possible, e.g. do NOT make "Reach the reservation interface starting from gayot.com" a criterion bc this overlaps with the first criterion. Each criterion should clearly specify full credit scenarios for both success AND uncontrollable failure modes.

    ==================
    Example 2 (detailed): Help purchase 'Fosbait: Lanthanum Carbonate 500mg Tablets' for kidney diseases on drugssquare.com.

    Example Output Rubric:
    {{
    "items": [
        {{
        "criterion": "Access drugssquare.com website",
        "task_span": "drugssquare.com",
        "description": "Successfully navigate to or access the drugssquare.com website as specified in the task. Full credit if: (a) site is successfully accessed, OR (b) site is inaccessible (blocked, down, error) and agent clearly indicates this and either stops or attempts alternative source. Partial credit if agent immediately uses alternative without attempting drugssquare.com first.",
        "max_points": 2,
        "justification": "",
        "earned_points": ""
        }},
        {{
        "criterion": "Locate the specific product",
        "task_span": "Fosbait: Lanthanum Carbonate 500mg Tablets",
        "description": "Find and identify the exact product 'Fosbait: Lanthanum Carbonate 500mg Tablets' on the website. Full credit if: (a) exact product found, OR (b) product is discontinued/out of stock/not found after reasonable search and agent clearly reports this, OR (c) agent identifies closest alternative (different dosage of same medication) when exact product unavailable and explains the substitution. Partial credit for selecting different dosage when the intended 500mg dosage IS available on the site. No credit for selecting entirely different medication when Fosbait is available.",
        "max_points": 3,
        "justification": "",
        "earned_points": ""
        }},
        {{
        "criterion": "Facilitate the purchase process until a Critical Point",
        "task_span": "<critical-point>",
        "description": "Help complete the purchase of the identified product up to but not crossing the Critical Point. Full credit if: (a) product is successfully added to cart and agent stops before entering personal/payment information, OR (b) the website's purchase flow is broken/unavailable and agent reports this, OR (c) website requires account creation or payment info before allowing add-to-cart and agent reports this limitation. Partial credit if agent proceeds partially but makes errors in the purchase flow (wrong quantity, wrong shipping option, etc.). No credit if agent either skips the cart entirely OR unnecessarily enters personal information when not required.",
        "max_points": 3,
        "justification": "",
        "earned_points": ""
        }}
    ]
    }}
    Please output an answer in pure JSON format according to the following schema. The JSON object must be parsable as-is. DO NOT OUTPUT ANYTHING OTHER THAN JSON, AND DO NOT DEVIATE FROM THE ABOVE SCHEMA:`;
