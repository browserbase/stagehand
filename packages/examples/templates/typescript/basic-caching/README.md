# Stagehand + Browserbase: Basic Caching

## AT A GLANCE

- Goal: Demonstrate how Stagehand's caching feature dramatically reduces cost and latency by reusing previously computed actions instead of calling the LLM every time.
- Runs the same observation twice and verifies the second result is a Browserbase Cache hit.
- Reads cache status and saved-token data from the V4 result metadata.
- Docs → https://docs.stagehand.dev/v4/best-practices/caching#caching-actions

## GLOSSARY

- caching: Stagehand can cache action results based on instruction text and page context, eliminating redundant LLM calls
  Docs → https://docs.stagehand.dev/v4/best-practices/caching#caching-actions
- act: execute actions on web pages using natural language instructions
  Docs → https://docs.stagehand.dev/v4/basics/act

## QUICKSTART

1. pnpm install
2. cp .env.example .env
3. Add your Browserbase API key to .env
4. pnpm start

## EXPECTED OUTPUT

- The first observation is normally a cache miss and primes the managed cache.
- The repeated observation is verified as a `HIT`.
- Output includes each operation's cache status, duration, and saved-token metadata.

## HOW CACHING WORKS

**Cache Key Generation:**

- Based on instruction text
- Based on page context
- Automatically computed

**When Cache is Used:**

- ✅ Same instruction
- ✅ Same page structure
- ✅ Cache file exists
- ❌ Different instruction
- ❌ Page structure changed significantly

**Cache Storage:**

- Browserbase manages the cache server-side.
- There are no local cache files or directories to maintain.
- `result.metadata.cache.status` reports `HIT`, `MISS`, or `DISABLED`.

## BENEFITS FOR REPEATED WORKFLOWS

**Example Scenario: 1,000 customers × 10 portals = 10,000 payment flows**

**Without caching:**

- 10,000 workflows × 5 actions = 50,000 LLM calls
- Cost: ~$500-2,500
- Latency: 2-3s per action × 5 = 10-15s per payment

**With caching:**

- First payment per portal: 5 LLM calls (populate cache)
- Next 999 payments: 0 LLM calls (use cache)
- Total: 10 portals × 5 actions = 50 LLM calls
- Cost: ~$0.50-2.50 (99.9% savings!)
- Latency: <100ms per action × 5 = <0.5s per payment

**Key Insight:**
Payment portals rarely change → Cache actions once → Reuse for thousands of payments → Massive cost + latency reduction

## COMMON PITFALLS

- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- Cache not working: check that the instruction and page content match exactly
- First observation slower: expected behavior—the first result primes the managed cache
- Find more information on your Browserbase dashboard -> https://www.browserbase.com/sign-in

## USE CASES

• Payment processing: Cache form-filling actions for payment portals that don't change frequently, processing thousands of payments with minimal LLM calls.
• Data entry automation: Reuse actions for repetitive data entry tasks across similar forms or interfaces.
• Testing workflows: Cache test actions to speed up regression testing and reduce API costs during development.

## BEST PRACTICES

- ✅ Enable caching in production for repeated workflows
- ✅ Keep the page environment and instruction stable
- ✅ Tune `cache.threshold` for the workflow's tolerance for change
- ✅ Monitor cache hit rate to optimize cache effectiveness
- ✅ Warm cache with test runs before production deployment

## NEXT STEPS

• Tune the cache threshold per instance or per operation.
• Scope operations to a stable selector when the surrounding page changes frequently.
• Monitor `metadata.cache` to measure hit rates and token savings.

## TRY IT YOURSELF

1. Change the instruction text and run again to observe a miss followed by a hit.

2. Change `cache: { threshold: 1 }` to a higher threshold and compare warm-up behavior.

3. Print the complete `metadata.cache` object to inspect miss reasons and token savings.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
