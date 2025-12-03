/**
 * Generate OpenAPI schema from Zod schemas
 *
 * Run: npx tsx scripts/generate-openapi.ts
 *
 * This script imports the actual Zod schemas from lib/v3/server/schemas.ts
 * to ensure the OpenAPI spec stays in sync with the implementation.
 */

import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

// Import actual schemas from server
import {
  actSchemaV3,
  extractSchemaV3,
  observeSchemaV3,
  agentExecuteSchemaV3,
  navigateSchemaV3,
} from '../lib/v3/server/schemas';

// Extend Zod with OpenAPI
extendZodWithOpenApi(z);

// Create registry
const registry = new OpenAPIRegistry();

// Register the schemas with OpenAPI names
registry.register('ActRequest', actSchemaV3);
registry.register('ExtractRequest', extractSchemaV3);
registry.register('ObserveRequest', observeSchemaV3);
registry.register('AgentExecuteRequest', agentExecuteSchemaV3);
registry.register('NavigateRequest', navigateSchemaV3);

// Response Schemas
const ActResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  actions: z.array(ActionSchema)
}).openapi('ActResult');

const ExtractResultSchema = z.unknown().openapi('ExtractResult', {
  description: 'Extracted data matching provided schema or default extraction object'
});

const ObserveResultSchema = z.array(ActionSchema).openapi('ObserveResult');

const AgentResultSchema = z.object({
  message: z.string().optional(),
  steps: z.array(z.unknown()).optional()
}).openapi('AgentResult');

const ErrorResponseSchema = z.object({
  error: z.string(),
  details: z.unknown().optional()
}).openapi('ErrorResponse');

// ============================================================================
// Register Routes
// ============================================================================

// POST /sessions/start
registry.registerPath({
  method: 'post',
  path: '/sessions/start',
  summary: 'Create a new browser session',
  description: 'Initializes a new Stagehand session with a browser instance. Returns a session ID that must be used for all subsequent requests.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: SessionConfigSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Session created successfully',
      content: {
        'application/json': {
          schema: z.object({
            sessionId: z.string().uuid(),
            available: z.boolean()
          })
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// Helper to create session-based route
function registerSessionRoute(
  path: string,
  summary: string,
  description: string,
  requestSchema: z.ZodTypeAny,
  responseSchema: z.ZodTypeAny
) {
  registry.registerPath({
    method: 'post',
    path: `/sessions/{sessionId}/${path}`,
    summary,
    description,
    request: {
      params: z.object({
        sessionId: z.string().uuid()
      }),
      headers: z.object({
        'x-stream-response': z.enum(['true', 'false']).optional()
      }).passthrough(),
      body: {
        content: {
          'application/json': {
            schema: requestSchema
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: responseSchema
          },
          'text/event-stream': {
            schema: z.string()
          }
        }
      },
      400: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      },
      404: {
        description: 'Session not found',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      },
      500: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: ErrorResponseSchema
          }
        }
      }
    }
  });
}

// Register all session routes using imported schemas
registerSessionRoute(
  'act',
  'Execute an action on the page',
  'Performs a browser action based on natural language instruction or a specific action object.',
  actSchemaV3,
  ActResultSchema
);

registerSessionRoute(
  'extract',
  'Extract structured data from the page',
  'Extracts data from the current page using natural language instructions and optional JSON schema.',
  extractSchemaV3,
  ExtractResultSchema
);

registerSessionRoute(
  'observe',
  'Observe possible actions on the page',
  'Returns a list of candidate actions that can be performed on the page.',
  observeSchemaV3,
  ObserveResultSchema
);

registerSessionRoute(
  'agentExecute',
  'Execute a multi-step agent task',
  'Runs an autonomous agent that can perform multiple actions to complete a complex task.',
  agentExecuteSchemaV3,
  AgentResultSchema
);

registerSessionRoute(
  'navigate',
  'Navigate to a URL',
  'Navigates the browser to the specified URL and waits for page load.',
  navigateSchemaV3,
  z.unknown()
);

// POST /sessions/{sessionId}/end
registry.registerPath({
  method: 'post',
  path: '/sessions/{sessionId}/end',
  summary: 'End the session and cleanup resources',
  description: 'Closes the browser and cleans up all resources associated with the session.',
  request: {
    params: z.object({
      sessionId: z.string().uuid()
    })
  },
  responses: {
    200: {
      description: 'Session ended',
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean()
          })
        }
      }
    },
    500: {
      description: 'Internal server error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema
        }
      }
    }
  }
});

// ============================================================================
// Generate OpenAPI Document
// ============================================================================

const generator = new OpenApiGeneratorV3(registry.definitions);

const openApiDocument = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'Stagehand P2P Server API',
    version: '3.0.0',
    description: `HTTP API for remote Stagehand browser automation. This API allows clients to connect to a Stagehand server and execute browser automation tasks remotely.

All endpoints except /sessions/start require an active session ID. Responses are streamed using Server-Sent Events (SSE) when the \`x-stream-response: true\` header is provided.`,
    contact: {
      name: 'Browserbase',
      url: 'https://browserbase.com'
    }
  },
  servers: [
    {
      url: 'http://localhost:3000/v1',
      description: 'Local P2P server'
    },
    {
      url: 'https://api.stagehand.browserbase.com/v1',
      description: 'Cloud API'
    }
  ]
});

// Write to file
const outputPath = path.join(__dirname, '..', 'openapi.yaml');
const yaml = require('yaml');
fs.writeFileSync(outputPath, yaml.stringify(openApiDocument));

console.log(`✓ OpenAPI schema generated at: ${outputPath}`);
