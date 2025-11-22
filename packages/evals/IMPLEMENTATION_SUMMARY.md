# Custom vLLM Endpoint Implementation - Summary

## Overview

Successfully implemented support for custom OpenAI-compatible inference endpoints (like vLLM) in the Stagehand evals system. This allows users to configure and use custom inference servers instead of standard cloud-based providers.

## Implementation Date

November 19, 2025

## Changes Made

### 1. Environment Configuration (`packages/evals/env.ts`)

**Added:**

- `customOpenAIConfig` object containing:
  - `baseURL`: Base URL for custom endpoint (from `CUSTOM_OPENAI_BASE_URL`)
  - `apiKey`: API key (from `CUSTOM_OPENAI_API_KEY`, defaults to "EMPTY")
  - `modelName`: Model name override (from `CUSTOM_OPENAI_MODEL_NAME`)

### 2. Eval Runner Updates (`packages/evals/index.eval.ts`)

**Modified:**

- Added import for `createOpenAI` from `@ai-sdk/openai`
- Added import for `customOpenAIConfig` from `./env`
- Updated LLM client initialization logic (lines 349-384) to:
  - Detect when `CUSTOM_OPENAI_BASE_URL` is set
  - Create custom OpenAI provider using `createOpenAI()`
  - Pass custom provider to `AISdkClientWrapped`
  - Fall back to standard providers when custom endpoint is not configured

### 3. Dependencies (`packages/evals/package.json`)

**Added:**

- `@ai-sdk/openai` version `^2.0.53` to dependencies

### 4. Documentation (`packages/evals/taskConfig.ts`)

**Updated:**

- Added documentation comment explaining custom endpoint configuration
- Referenced `CUSTOM_ENDPOINT_USAGE.md` for detailed instructions

### 5. User Documentation

**Created `CUSTOM_ENDPOINT_USAGE.md`:**

- Comprehensive guide on using custom endpoints
- Configuration instructions
- Usage examples for:
  - Local vLLM server
  - Remote vLLM deployment
  - Ollama
  - Secured custom endpoints
- Troubleshooting section
- Performance tips
- Compatibility information

### 6. Examples

**Created `examples/custom_vllm_endpoint.sh`:**

- Shell script demonstrating how to run evals with custom endpoint
- Includes connectivity check
- Configurable via environment variables
- Made executable with proper permissions

**Created `examples/custom_endpoint_example.ts`:**

- TypeScript example showing internal integration
- Demonstrates custom provider setup
- Shows configuration patterns
- Includes fallback behavior explanation

## Technical Approach

The implementation leverages AI SDK's `createOpenAI` function with custom `baseURL` parameter:

```typescript
const customOpenAI = createOpenAI({
  baseURL: process.env.CUSTOM_OPENAI_BASE_URL,
  apiKey: process.env.CUSTOM_OPENAI_API_KEY || "EMPTY",
});

const model = customOpenAI(modelName);
const llmClient = new AISdkClientWrapped({ model });
```

This approach:

- ✅ Works seamlessly with existing `AISdkClientWrapped` class
- ✅ Requires no changes to downstream code
- ✅ Maintains backward compatibility
- ✅ Supports any OpenAI-compatible endpoint
- ✅ Simple environment variable configuration

## Usage

To use a custom vLLM endpoint:

```bash
# Set environment variables
export CUSTOM_OPENAI_BASE_URL="http://localhost:8000/v1"
export CUSTOM_OPENAI_API_KEY="EMPTY"
export CUSTOM_OPENAI_MODEL_NAME="meta-llama/Llama-3.3-70B-Instruct"

# Run evals as normal
cd packages/evals
pnpm run evals --eval your-eval-name
```

## Testing

- ✅ Code compiles successfully (typecheck passed)
- ✅ Dependencies installed correctly
- ✅ Integration tested with existing eval infrastructure
- ✅ Example scripts created and validated
- ✅ Documentation verified

## Benefits

1. **Cost Efficiency**: Use self-hosted models instead of paid APIs
2. **Performance**: Lower latency with local/dedicated servers
3. **Flexibility**: Test with any OpenAI-compatible endpoint
4. **Privacy**: Keep data on-premises
5. **Experimentation**: Easy testing with custom model deployments

## Compatibility

Compatible with:

- vLLM (primary use case)
- Ollama
- LocalAI
- Text Generation Inference (TGI)
- LM Studio
- Any OpenAI-compatible server

## Migration from Standard Providers

No migration needed! The feature:

- Works alongside existing provider configurations
- Only activates when `CUSTOM_OPENAI_BASE_URL` is set
- Falls back to standard providers otherwise
- Requires no changes to existing eval configurations

## Files Modified

1. `packages/evals/env.ts` - Added configuration
2. `packages/evals/index.eval.ts` - Updated client initialization
3. `packages/evals/package.json` - Added dependency
4. `packages/evals/taskConfig.ts` - Added documentation

## Files Created

1. `packages/evals/CUSTOM_ENDPOINT_USAGE.md` - User documentation
2. `packages/evals/examples/custom_vllm_endpoint.sh` - Shell example
3. `packages/evals/examples/custom_endpoint_example.ts` - TypeScript example
4. `packages/evals/IMPLEMENTATION_SUMMARY.md` - This file

## Future Enhancements

Potential improvements:

- Support for multiple concurrent endpoints
- Endpoint health monitoring
- Automatic failover between endpoints
- Endpoint performance metrics
- Configuration profiles for common setups

## References

- [AI SDK Documentation - Custom OpenAI Providers](https://ai-sdk.dev/providers/ai-sdk-providers/openai#provider-instance)
- [vLLM Documentation](https://docs.vllm.ai/)
- Inspired by verifiers codebase pattern for vLLM integration

## Notes

- The implementation uses the same OpenAI-compatible interface pattern as the verifiers training code
- Environment variables chosen for consistency with common vLLM usage patterns
- Defaults (like "EMPTY" for API key) match vLLM server expectations
- Documentation includes extensive examples and troubleshooting guidance
