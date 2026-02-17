const { AzureOpenAI } = require("openai");
const { getBearerTokenProvider, AzureCliCredential, DefaultAzureCredential, ChainedTokenCredential } = require("@azure/identity");
const express = require("express");
const cors = require("cors");

/**
 * Minimal OAuth Proxy for Stagehand - Working Version
 * This creates a local server that Stagehand can use as an OpenAI-compatible endpoint
 */

async function createOAuthProxyServer(port = 3001) {
  console.log("🚀 Starting OAuth Proxy Server for Stagehand...");

  // Your OAuth setup (working from the test)
  const scope = "api://trapi/.default";
  const credential = getBearerTokenProvider(
    new ChainedTokenCredential(
      new AzureCliCredential(),
      new DefaultAzureCredential()  // Simplified - remove problematic exclude options
    ),
    scope
  );

  console.log("✅ OAuth credential provider created");

  const apiVersion = '2024-10-21';
  const responsesApiVersion = '2025-03-01-preview';  // Responses API requires newer version
  const instance = 'redmond/interactive';
  const endpoint = `https://trapi.research.microsoft.com/${instance}`;

  // Map of model names to Azure deployment names
  const deploymentMap = {
    'gpt-4o': 'gpt-4o_2024-11-20',
    'computer-use-preview': 'computer-use-preview_2025-03-11',
    'computer-use-preview-2025-03-11': 'computer-use-preview_2025-03-11',
  };
  const defaultDeployment = 'gpt-4o_2024-11-20';

  function resolveDeployment(requestedModel) {
    if (!requestedModel) return defaultDeployment;
    // Try direct match first
    if (deploymentMap[requestedModel]) return deploymentMap[requestedModel];
    // Try stripping provider prefix (e.g., "openai/gpt-4o" -> "gpt-4o")
    const stripped = requestedModel.includes('/') ? requestedModel.split('/').pop() : requestedModel;
    if (deploymentMap[stripped]) return deploymentMap[stripped];
    // Fallback
    console.warn(`⚠️  Unknown model "${requestedModel}", using default: ${defaultDeployment}`);
    return defaultDeployment;
  }

  // Chat Completions client (standard API version)
  const client = new AzureOpenAI({
    endpoint: endpoint,
    azureADTokenProvider: credential,
    apiVersion: apiVersion,
  });

  // Responses API client (requires newer API version)
  const responsesClient = new AzureOpenAI({
    endpoint: endpoint,
    azureADTokenProvider: credential,
    apiVersion: responsesApiVersion,
  });

  console.log(`📡 Using endpoint: ${endpoint}`);
  console.log(`🤖 Available deployments:`, Object.values(deploymentMap).join(', '));
  console.log(`📋 Chat API version: ${apiVersion}, Responses API version: ${responsesApiVersion}`);

  // Create Express app
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      deployments: deploymentMap,
      endpoint: endpoint 
    });
  });

  // Log ALL requests so we can debug what Stagehand is calling
  app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    next();
  });

  // OpenAI-compatible chat completions endpoint (used by act/extract/observe)
  app.post('/v1/chat/completions', async (req, res) => {
    try {
      const deployment = resolveDeployment(req.body.model);
      console.log('📞 Proxying chat completion request...');
      console.log('   Model requested:', req.body.model, '→ deployment:', deployment);
      console.log('   Messages count:', req.body.messages?.length);
      console.log('   Has tools:', !!req.body.tools);
      
      // Strip fields that Azure might not accept, and override model
      const { model, ...restBody } = req.body;
      const azureBody = {
        ...restBody,
        model: deployment,
      };

      const response = await client.chat.completions.create(azureBody);

      console.log('✅ Chat completion request successful');
      res.json(response);
      
    } catch (error) {
      console.error('❌ Chat completion proxy error:', error.message);
      console.error('   Status:', error.status);
      console.error('   Full error:', JSON.stringify(error.error || error, null, 2));
      res.status(error.status || 500).json({
        error: {
          message: error?.message || 'Unknown error',
          type: 'azure_oauth_error',
        }
      });
    }
  });

  // OpenAI Responses API endpoint (used by CUA agent)
  app.post('/v1/responses', async (req, res) => {
    try {
      const deployment = resolveDeployment(req.body.model);
      console.log('📞 Proxying responses API request...');
      console.log('   Model requested:', req.body.model, '→ deployment:', deployment);

      const response = await responsesClient.responses.create({
        ...req.body,
        model: deployment,
      });

      console.log('✅ Responses API request successful');
      res.json(response);

    } catch (error) {
      console.error('❌ Responses API proxy error:', error.message);
      res.status(error.status || 500).json({
        error: {
          message: error?.message || 'Unknown error',
          type: 'azure_oauth_error',
        }
      });
    }
  });

  // Catch-all for any unhandled paths (helps debug)
  app.all('*', (req, res) => {
    console.warn(`⚠️  Unhandled request: ${req.method} ${req.url}`);
    res.status(404).json({
      error: {
        message: `Proxy does not handle ${req.method} ${req.url}`,
        type: 'not_found',
      }
    });
  });

  // Start server
  const server = app.listen(port, () => {
    console.log(`🎉 OAuth Proxy running on http://localhost:${port}`);
    console.log(`📋 Health check: http://localhost:${port}/health`);
    console.log(`🔌 Stagehand endpoint: http://localhost:${port}/v1`);
    console.log(`\n📖 Usage with Stagehand:`);
    console.log(`const stagehand = new Stagehand({`);
    console.log(`  env: "LOCAL",`);
    console.log(`  model: {`);
    console.log(`    modelName: "openai/gpt-4o",`);
    console.log(`    apiKey: "oauth-dummy",`);
    console.log(`    baseURL: "http://localhost:${port}/v1"`);
    console.log(`  }`);
    console.log(`});`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use. Kill the old process or use a different port.`);
      console.error(`   Run: npx kill-port ${port}`);
      process.exit(1);
    }
    throw err;
  });

  return {
    server,
    url: `http://localhost:${port}`,
    stop: () => server.close(),
  };
}

module.exports = { createOAuthProxyServer };

// Run if executed directly
if (require.main === module) {
  createOAuthProxyServer()
    .then(proxy => {
      console.log("\n✨ Proxy server is ready!");
      console.log("🛑 Press Ctrl+C to stop the server");
      
      // Keep the server running
      process.on('SIGINT', () => {
        console.log('\n🛑 Shutting down proxy server...');
        proxy.stop();
        process.exit(0);
      });
    })
    .catch(error => {
      console.error("💥 Failed to start proxy server:", error.message);
      process.exit(1);
    });
}