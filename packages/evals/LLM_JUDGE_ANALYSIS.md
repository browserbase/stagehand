# LLM-as-a-Judge Analysis

## Current Implementation Status

### ✅ Implementation Location
`tasks/agent/onlineMind2Web_skills_comparison.ts` (lines 82-142)

### How It Works

1. **Evaluator Setup** (lines 88-104):
   ```typescript
   const evaluator = new V3Evaluator(
     stubV3,
     "anthropic/claude-sonnet-4-20250514",
     { apiKey: process.env.ANTHROPIC_API_KEY }
   );
   ```

2. **Evaluation Call** (lines 113-118):
   ```typescript
   const evalResult = await evaluator.ask({
     question: `Did the agent successfully complete this task: "${params.confirmed_task}"?`,
     answer: metrics.reasoning || "No reasoning provided",
     screenshot: false,  // Text-only evaluation
     agentReasoning: metrics.reasoning,
   });
   ```

3. **Result Processing** (line 120):
   ```typescript
   evaluationSuccess = evalResult.evaluation === "YES";
   evaluationReasoning = evalResult.reasoning;
   ```

### Fields Logged to Braintrust

The eval function returns these fields (lines 144-162):

| Field | Type | Description |
|-------|------|-------------|
| `_success` | boolean | **Main success field** - LLM judge's yes/no verdict |
| `agent_completed` | boolean | Whether agent finished without hitting limits/errors |
| `evaluation_result` | boolean | Explicitly the LLM judge verdict (same as `_success`) |
| `evaluation_reasoning` | string | LLM judge's explanation for the verdict |
| `reasoning` | string | Agent's final reasoning/answer |
| `cost_usd` | number | Total cost in USD |
| `turn_count` | number | Number of agent turns |
| `duration_ms` | number | Duration in milliseconds |
| `skill` | string | Which skill was used |
| `agent_messages` | array | Full turn-by-turn traces from Agent SDK |

### Key Design Decisions

1. **Text-only evaluation**: Uses `screenshot: false` to avoid screenshot comparison
   - Faster and cheaper than visual evaluation
   - Works well for task completion verification
   - Relies on agent's reasoning output being accurate

2. **Fallback behavior**: If V3Evaluator fails, falls back to agent's success determination
   ```typescript
   evaluationSuccess = metrics.success;
   evaluationReasoning = `Evaluator failed: ${evalError}. Fallback to agent result`;
   ```

3. **Separate metrics**:
   - `agent_completed`: Did the agent finish without errors?
   - `evaluation_result`: Did the agent actually complete the task correctly?
   - These can differ if agent finishes but task isn't completed

### Potential Issues

1. **API Key Configuration**:
   - V3Evaluator expects ANTHROPIC_API_KEY in environment
   - With stub v3 instance, API key must be passed explicitly
   - **Need to verify**: Is the API key being loaded correctly?

2. **No Reasoning = Failure**:
   - Lines 138-142: If no reasoning output, marks as failure
   - This is correct but should be logged clearly

3. **LLM Judge Reliability**:
   - Depends on agent's reasoning being descriptive
   - Text-only evaluation may miss visual task completion
   - No validation that "Final Answer:" format is followed

## Verification Checklist

### ✅ Code Review Complete
- Implementation exists and looks correct
- All required fields are returned
- Error handling is in place

### ⚠️ Runtime Testing Needed
1. **Run a 2-task eval to verify**:
   ```bash
   cd ~/Developer/stagehand/packages/evals
   EVAL_MAX_K=2 EVAL_TRIAL_COUNT=1 EVAL_SKILLS="stagehand-cli,playwright-mcp" \
   npm run eval agent/onlineMind2Web_skills_comparison
   ```

2. **Check Braintrust logs**:
   - Go to https://www.braintrust.dev/app/Browserbase/p/stagehand-dev/
   - Look for experiment: `agent/onlineMind2Web_skills_comparison_*`
   - Download CSV and verify columns:
     - `_success` column exists
     - `evaluation_result` column exists
     - `evaluation_reasoning` column exists
     - Values are populated (not null/undefined)

3. **Verify API key loading**:
   ```bash
   cd ~/Developer/stagehand/packages/evals
   cat .env | grep ANTHROPIC_API_KEY
   # Should show: ANTHROPIC_API_KEY=sk-...
   ```

## Recommendations

### Short-term (Before Full Eval Run)

1. **Test with 2 tasks** to verify:
   - LLM judge is called successfully
   - Results are logged to Braintrust
   - API key is loaded correctly
   - Both success and failure cases work

2. **Add logging** to see LLM judge in action:
   - Already has: "Validating answer with V3Evaluator"
   - Already has: "V3Evaluator result: {YES/NO} - {reasoning}"
   - These should appear in console during eval

3. **Check for errors**:
   - Look for "V3Evaluator error:" in logs
   - If present, API key or model access issue

### Long-term Improvements

1. **Validate "Final Answer:" format**:
   - Check if agent's reasoning contains "Final Answer:"
   - Extract and use only the final answer for evaluation
   - Currently using full reasoning which may be verbose

2. **Add evaluation confidence**:
   - V3Evaluator might return confidence/uncertainty
   - Log this to help filter ambiguous cases

3. **Compare with agent's self-assessment**:
   - Currently logs both `agent_completed` and `evaluation_result`
   - Could flag cases where these disagree (agent thinks it succeeded but judge says no)

## Example Output

When working correctly, console should show:

```
[evaluation] Validating answer with V3Evaluator (anthropic/claude-sonnet-4-20250514)
[evaluator] creating chat completion
[evaluation] V3Evaluator result: YES - The agent successfully navigated to the website and completed the task as requested.
[evaluation] Skill stagehand-cli completed in 23400ms with 3 turns
```

Braintrust CSV should contain:

```csv
_success,evaluation_result,evaluation_reasoning,agent_completed,reasoning,cost_usd,turn_count,duration_ms,skill
true,true,"The agent successfully completed...",true,"I navigated to...",0.0234,3,23400,stagehand-cli
false,false,"The agent did not complete...",true,"I tried but...",0.0156,5,45600,playwright-mcp
```

## Next Steps

1. ✅ Run 2-task test eval with stagehand-cli and playwright-mcp
2. ✅ Verify Braintrust logging shows all LLM judge fields
3. ✅ Check console logs for V3Evaluator messages
4. ✅ If working, proceed with full eval
5. ✅ If not working, debug API key or V3Evaluator setup
