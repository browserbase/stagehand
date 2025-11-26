# Using Custom OpenAI-Compatible Endpoints with Evals

This guide explains how to configure the Stagehand evals system to use custom OpenAI-compatible inference endpoints, such as vLLM, Ollama, or other compatible servers.

## Overview

The evals system now supports custom OpenAI-compatible endpoints through the AI SDK's `createOpenAI` function. This allows you to:

- Use local vLLM servers for faster inference
- Connect to custom model deployments
- Test with Ollama or other OpenAI-compatible services
- Use self-hosted inference endpoints

## Configuration

Configure the custom endpoint using environment variables:

### Required Environment Variables

- `CUSTOM_OPENAI_BASE_URL`: The base URL for your custom endpoint
  - Example: `http://localhost:8000/v1`
  - Example: `http://your-vllm-server:8000/v1`

### Optional Environment Variables

- `CUSTOM_OPENAI_API_KEY`: API key for the endpoint (defaults to `"EMPTY"` if not set)

  - For vLLM: Use `"EMPTY"` or leave unset
  - For secured endpoints: Set your actual API key

- `CUSTOM_OPENAI_MODEL_NAME`: Override the model name to use
  - If not set, the model name from the eval configuration will be used
  - Useful when your endpoint expects a specific model identifier

## Usage Examples

### Example 1: Basic vLLM Setup

```bash
# Start your vLLM server (in a separate terminal)
vllm serve meta-llama/Llama-3.3-70B-Instruct \
  --host 0.0.0.0 \
  --port 8000

# Configure the evals to use the vLLM endpoint
export CUSTOM_OPENAI_BASE_URL="http://localhost:8000/v1"
export CUSTOM_OPENAI_API_KEY="EMPTY"
export CUSTOM_OPENAI_MODEL_NAME="meta-llama/Llama-3.3-70B-Instruct"

# Run your evals
cd packages/evals
pnpm run evals --eval your-eval-name
```

### Example 2: Remote vLLM Server

```bash
# Connect to a remote vLLM deployment
export CUSTOM_OPENAI_BASE_URL="http://192.168.1.100:8000/v1"
export CUSTOM_OPENAI_API_KEY="EMPTY"
export CUSTOM_OPENAI_MODEL_NAME="my-custom-model"

# Run evals
pnpm run evals --category act
```

### Example 3: Ollama

```bash
# Start Ollama with OpenAI-compatible API
ollama serve

# Configure for Ollama endpoint
export CUSTOM_OPENAI_BASE_URL="http://localhost:11434/v1"
export CUSTOM_OPENAI_API_KEY="EMPTY"
export CUSTOM_OPENAI_MODEL_NAME="llama3.3:70b"

# Run evals
pnpm run evals --eval my-task
```

### Example 4: Custom Secured Endpoint

```bash
# For endpoints requiring authentication
export CUSTOM_OPENAI_BASE_URL="https://api.your-inference-provider.com/v1"
export CUSTOM_OPENAI_API_KEY="your-actual-api-key-here"
export CUSTOM_OPENAI_MODEL_NAME="custom-model-v1"

# Run evals
pnpm run evals
```

## How It Works

When `CUSTOM_OPENAI_BASE_URL` is set, the eval system:

1. Creates a custom OpenAI provider using AI SDK's `createOpenAI` function
2. Points it to your specified base URL
3. Uses your configured API key (or "EMPTY" by default)
4. Wraps it in the existing `AISdkClientWrapped` class
5. Passes it to the V3 initialization for use in evals

The implementation automatically falls back to standard AI SDK providers when the custom endpoint is not configured.

## Compatibility

This feature works with any server that implements the OpenAI Chat Completions API, including:

- ✅ vLLM (recommended for production)
- ✅ Ollama
- ✅ LocalAI
- ✅ Text Generation Inference (TGI)
- ✅ LM Studio
- ✅ Any custom OpenAI-compatible server

## Troubleshooting

### Connection Issues

If you can't connect to your endpoint:

```bash
# Test the endpoint manually with curl
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer EMPTY" \
  -d '{
    "model": "your-model-name",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 10
  }'
```

### Model Name Mismatch

If you get model not found errors:

1. Check your vLLM server logs to see what model name it expects
2. Set `CUSTOM_OPENAI_MODEL_NAME` to match exactly
3. Ensure the model name matches what was loaded in vLLM

### API Key Issues

If you get authentication errors:

1. For vLLM, use `CUSTOM_OPENAI_API_KEY="EMPTY"`
2. For secured endpoints, ensure your API key is correct
3. Check if your endpoint requires a specific authorization header format

## Performance Tips

When using vLLM:

1. **Enable prefix caching** for better performance with similar prompts
2. **Use appropriate batch sizes** for your hardware
3. **Consider tensor parallelism** for larger models
4. **Monitor GPU memory** usage during eval runs

Example vLLM server configuration for optimal eval performance:

```bash
vllm serve your-model \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 2 \
  --enable-prefix-caching \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.9
```

## Integration with Verifiers Training Code

This implementation follows a similar pattern to the verifiers codebase, where vLLM is used for efficient inference:

```python
# Similar to verifiers approach
client_config = {
    "base_url": "http://localhost:8000/v1",
    "api_key": "EMPTY",
    "http_client_args": {
        "limits": {"max_connections": max_concurrent},
        "timeout": timeout,
    },
}
```

The Stagehand implementation uses the same OpenAI-compatible interface, making it easy to:

- Share vLLM servers between training and evaluation
- Use the same model configurations
- Maintain consistent inference behavior

## Additional Resources

- [AI SDK Documentation - Custom OpenAI Providers](https://ai-sdk.dev/providers/ai-sdk-providers/openai#provider-instance)
- [vLLM Documentation](https://docs.vllm.ai/)
- [Ollama Documentation](https://ollama.ai/docs)
