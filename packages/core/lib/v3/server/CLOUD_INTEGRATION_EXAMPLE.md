# Cloud Server Integration with Event-Based Architecture

This document shows how the cloud stagehand-api server can use the library's StagehandServer with event listeners to add cloud-only logic (database, LaunchDarkly, Sentry, etc.).

## Architecture Overview

The library `StagehandServer` emits 21 different event types at key lifecycle points. The cloud server can instantiate this server and add event listeners to hook into these events for cloud-specific operations.

## Event Types Available

### Server Lifecycle
- `StagehandServerStarted` - Server begins listening
- `StagehandServerReady` - Server fully initialized
- `StagehandServerShutdown` - Server is shutting down

### Session Lifecycle
- `StagehandSessionCreated` - New session created
- `StagehandSessionResumed` - Session retrieved (cache hit/miss)
- `StagehandSessionInitialized` - Stagehand instance initialized
- `StagehandSessionEnded` - Session cleanup complete

### Request Lifecycle
- `StagehandRequestReceived` - HTTP request received
- `StagehandRequestValidated` - Request body validated
- `StagehandRequestCompleted` - Response sent to client

### Action Lifecycle
- `StagehandActionStarted` - act/extract/observe/agentExecute/navigate begins
- `StagehandActionProgress` - Log message during execution
- `StagehandActionCompleted` - Action finished successfully
- `StagehandActionErrored` - Action failed with error

### Streaming Events
- `StagehandStreamStarted` - SSE connection opened
- `StagehandStreamMessageSent` - SSE message sent
- `StagehandStreamEnded` - SSE connection closed

### Cache Events
- `StagehandCacheHit` - Session found in cache
- `StagehandCacheMissed` - Session not in cache
- `StagehandCacheEvicted` - Session removed from cache

## Example: Cloud Server Implementation

```typescript
// core/apps/stagehand-api/src/cloud-server.ts

import { StagehandServer } from '@browserbasehq/stagehand/server';
import type {
  StagehandActionStartedEvent,
  StagehandActionCompletedEvent,
  StagehandActionErroredEvent,
  StagehandSessionCreatedEvent,
} from '@browserbasehq/stagehand/server';
import { db } from './lib/db';
import {
  createAction,
  updateActionResult,
  createInference,
  updateActionStartAndEndTime,
  createSession as createDbSession,
} from './lib/db/actions';
import * as Sentry from '@sentry/node';
import { Browserbase } from '@browserbase/sdk';
import { LaunchDarklyClient } from './lib/launchdarkly';

export class CloudStagehandServer {
  private stagehandServer: StagehandServer;
  private launchdarkly: LaunchDarklyClient;
  private browserbase: Browserbase;

  constructor() {
    // Instantiate the library server
    this.stagehandServer = new StagehandServer({
      port: 3000,
      host: '0.0.0.0',
      sessionTTL: 300000, // 5 minutes
    });

    this.launchdarkly = new LaunchDarklyClient();
    this.browserbase = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY! });

    // Register all cloud-specific event listeners
    this.registerEventListeners();
  }

  private registerEventListeners() {
    // ===== SERVER LIFECYCLE =====

    this.stagehandServer.on('StagehandServerReady', async (event) => {
      console.log(`Cloud Stagehand API ready on port ${event.port}`);
      // Initialize LaunchDarkly, connect to DB, etc.
      await this.launchdarkly.initialize();
    });

    this.stagehandServer.on('StagehandServerShutdown', async (event) => {
      console.log('Shutting down cloud services...');
      await this.launchdarkly.close();
      // Cleanup cloud resources
    });

    // ===== SESSION LIFECYCLE =====

    this.stagehandServer.on('StagehandSessionCreated', async (event: StagehandSessionCreatedEvent) => {
      console.log(`Session created: ${event.sessionId}`);

      // Check LaunchDarkly rollout
      const isAvailable = await this.launchdarkly.getFlagValue(
        'stagehand-api-ga-rollout',
        { key: event.sessionId },
        false
      );

      if (!isAvailable) {
        throw new Error('API not available for this user');
      }

      // Create Browserbase session
      const bbSession = await this.browserbase.sessions.create({
        projectId: event.config.browserbase?.projectId,
        keepAlive: true,
        userMetadata: { stagehand: 'true' },
      });

      // Store in database
      await createDbSession({
        id: bbSession.id,
        browserbaseApiKey: process.env.BROWSERBASE_API_KEY!,
        browserbaseProjectId: event.config.browserbase?.projectId!,
        modelName: event.config.model?.modelName || 'gpt-4o',
        domSettleTimeoutMs: event.config.domSettleTimeoutMs,
        verbose: event.config.verbose,
        systemPrompt: event.config.systemPrompt,
        selfHeal: event.config.selfHeal,
      });
    });

    // ===== REQUEST LIFECYCLE =====

    this.stagehandServer.on('StagehandRequestReceived', async (event) => {
      console.log(`Request received: ${event.method} ${event.path}`);

      // Authenticate (if needed)
      const apiKey = event.headers['x-bb-api-key'];
      if (apiKey && !await this.validateApiKey(apiKey)) {
        throw new Error('Invalid API key');
      }

      // Check if session exists in DB
      if (event.sessionId) {
        const session = await db.sessions.findById(event.sessionId);
        if (!session) {
          throw new Error('Session not found in database');
        }
      }
    });

    // ===== ACTION LIFECYCLE =====

    this.stagehandServer.on('StagehandActionStarted', async (event: StagehandActionStartedEvent) => {
      console.log(`Action started: ${event.actionType} for session ${event.sessionId}`);

      // Create action record in database
      const action = await createAction({
        sessionId: event.sessionId,
        method: event.actionType,
        xpath: '',
        options: event.options,
        url: event.url,
      });

      // IMPORTANT: Set actionId on event so other listeners can use it
      event.actionId = action.id;
    });

    this.stagehandServer.on('StagehandActionCompleted', async (event: StagehandActionCompletedEvent) => {
      console.log(`Action completed: ${event.actionType} (${event.durationMs}ms)`);

      if (!event.actionId) {
        console.warn('No actionId found on ActionCompleted event');
        return;
      }

      // Update action result in database
      await updateActionResult(event.actionId, event.result);

      // Log token usage metrics
      if (event.metrics) {
        await createInference(event.actionId, {
          inputTokens: event.metrics.promptTokens,
          outputTokens: event.metrics.completionTokens,
          timeMs: event.metrics.inferenceTimeMs,
        });
      }

      // Update timing
      const sentAt = new Date(Date.now() - event.durationMs);
      await updateActionStartAndEndTime(event.actionId, sentAt, new Date());
    });

    this.stagehandServer.on('StagehandActionErrored', async (event: StagehandActionErroredEvent) => {
      console.error(`Action failed: ${event.actionType} - ${event.error.message}`);

      // Send error to Sentry
      Sentry.captureException(new Error(event.error.message), {
        tags: {
          sessionId: event.sessionId,
          actionType: event.actionType,
          actionId: event.actionId,
        },
        extra: {
          stack: event.error.stack,
          durationMs: event.durationMs,
        },
      });

      // Update database with error
      if (event.actionId) {
        await updateActionResult(event.actionId, {
          error: event.error.message,
          success: false,
        });
      }
    });

    // ===== PROGRESS LOGGING =====

    this.stagehandServer.on('StagehandActionProgress', async (event) => {
      // Could stream to external logging service (DataDog, CloudWatch, etc.)
      // console.log(`[${event.sessionId}] ${event.message.message}`);
    });
  }

  private async validateApiKey(apiKey: string): Promise<boolean> {
    // Implement API key validation
    return apiKey.startsWith('bb_');
  }

  async start() {
    await this.stagehandServer.listen();
  }

  async stop() {
    await this.stagehandServer.close();
  }

  // Expose the underlying server for direct access if needed
  getServer(): StagehandServer {
    return this.stagehandServer;
  }
}

// Usage
const cloudServer = new CloudStagehandServer();
await cloudServer.start();
```

## Key Patterns

### 1. Mutating Events for Communication

Cloud listeners can set properties on events to communicate data back to the library:

```typescript
stagehandServer.on('StagehandActionStarted', async (event) => {
  const action = await createAction({...});
  event.actionId = action.id; // Set actionId for downstream listeners
});
```

### 2. Async Listeners

All event listeners are awaited, so you can perform async operations:

```typescript
stagehandServer.on('StagehandSessionCreated', async (event) => {
  await db.sessions.create({...}); // Waits for DB write
});
```

### 3. Error Handling in Listeners

Errors in listeners will propagate and fail the request:

```typescript
stagehandServer.on('StagehandRequestReceived', async (event) => {
  const session = await db.sessions.findById(event.sessionId);
  if (!session) {
    throw new Error('Session not found'); // Request fails with 500
  }
});
```

### 4. Conditional Logic Based on Events

```typescript
stagehandServer.on('StagehandSessionResumed', async (event) => {
  if (event.fromCache) {
    console.log('Cache hit!');
    // No need to recreate Stagehand instance
  } else {
    console.log('Cache miss - initializing new instance');
    // Fetch from DB, connect to Browserbase, etc.
  }
});
```

## Benefits of Event-Based Architecture

1. **Zero Code Duplication**: Library contains all core logic, cloud adds hooks
2. **Clean Separation**: Cloud concerns (DB, monitoring, etc.) isolated in listeners
3. **Easy Testing**: Test library and cloud independently
4. **Flexible**: Add new cloud features by adding new listeners
5. **Version Independence**: Library and cloud can evolve separately
6. **Type Safety**: All events are fully typed with TypeScript

## Migration Path for Existing Cloud Server

1. **Phase 1**: Instantiate `StagehandServer` in cloud server
2. **Phase 2**: Add event listeners for all DB operations
3. **Phase 3**: Remove duplicated route handlers from cloud server
4. **Phase 4**: Delete ~2,100 lines of duplicated code
5. **Result**: Cloud server becomes pure event orchestrator (~500 lines)

## Complete Event Listener Template

```typescript
private registerAllEvents() {
  // Server
  this.stagehandServer.on('StagehandServerStarted', async (event) => {});
  this.stagehandServer.on('StagehandServerReady', async (event) => {});
  this.stagehandServer.on('StagehandServerShutdown', async (event) => {});

  // Session
  this.stagehandServer.on('StagehandSessionCreated', async (event) => {});
  this.stagehandServer.on('StagehandSessionResumed', async (event) => {});
  this.stagehandServer.on('StagehandSessionInitialized', async (event) => {});
  this.stagehandServer.on('StagehandSessionEnded', async (event) => {});

  // Request
  this.stagehandServer.on('StagehandRequestReceived', async (event) => {});
  this.stagehandServer.on('StagehandRequestValidated', async (event) => {});
  this.stagehandServer.on('StagehandRequestCompleted', async (event) => {});

  // Action
  this.stagehandServer.on('StagehandActionStarted', async (event) => {});
  this.stagehandServer.on('StagehandActionProgress', async (event) => {});
  this.stagehandServer.on('StagehandActionCompleted', async (event) => {});
  this.stagehandServer.on('StagehandActionErrored', async (event) => {});

  // Stream
  this.stagehandServer.on('StagehandStreamStarted', async (event) => {});
  this.stagehandServer.on('StagehandStreamMessageSent', async (event) => {});
  this.stagehandServer.on('StagehandStreamEnded', async (event) => {});

  // Cache (optional - mostly for cloud with multi-session support)
  this.stagehandServer.on('StagehandCacheHit', async (event) => {});
  this.stagehandServer.on('StagehandCacheMissed', async (event) => {});
  this.stagehandServer.on('StagehandCacheEvicted', async (event) => {});
}
```

## Testing Event Listeners

```typescript
import { StagehandServer } from '@browserbasehq/stagehand/server';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Cloud Server Event Listeners', () => {
  let server: StagehandServer;
  let events: any[] = [];

  beforeEach(async () => {
    server = new StagehandServer({ port: 3001 });

    // Capture all events
    server.on('StagehandActionStarted', (event) => {
      events.push(event);
    });

    await server.listen();
  });

  afterEach(async () => {
    await server.close();
    events = [];
  });

  it('should emit ActionStarted event when act is called', async () => {
    // Create session and call act endpoint
    // ...

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('StagehandActionStarted');
    expect(events[0].actionType).toBe('act');
  });
});
```

## Next Steps

1. Import `StagehandServer` and event types in cloud server
2. Create `CloudStagehandServer` wrapper class
3. Register event listeners for all DB, LaunchDarkly, Sentry operations
4. Test that cloud server works with event-based architecture
5. Remove old route handler files from cloud server
6. Deploy and verify in production

## Result

- **Library Server**: 946 lines (pure logic, zero cloud dependencies)
- **Cloud Server**: ~500 lines (event orchestration + cloud integrations)
- **Code Reduction**: 81% (from 2,661 to 500 lines in cloud server)
- **Maintainability**: Single source of truth for all route logic
- **Flexibility**: Easy to add new cloud features via new listeners
