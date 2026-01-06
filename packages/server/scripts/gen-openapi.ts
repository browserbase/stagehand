import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import {
  fastifyZodOpenApiPlugin,
  fastifyZodOpenApiTransformers,
  serializerCompiler,
  validatorCompiler,
  type FastifyZodOpenApiTypeProvider,
} from "fastify-zod-openapi";
import { Api } from "@browserbasehq/stagehand";
import type { ZodOpenApiComponentsObject } from "zod-openapi";

// Routes
import actRoute from "../src/routes/v1/sessions/_id/act.js";
import agentExecuteRoute from "../src/routes/v1/sessions/_id/agentExecute.js";
import endRoute from "../src/routes/v1/sessions/_id/end.js";
import extractRoute from "../src/routes/v1/sessions/_id/extract.js";
import navigateRoute from "../src/routes/v1/sessions/_id/navigate.js";
import observeRoute from "../src/routes/v1/sessions/_id/observe.js";
import replayRoute from "../src/routes/v1/sessions/_id/replay.js";
import startRoute from "../src/routes/v1/sessions/start.js";
import healthcheckRoute from "../src/routes/healthcheck.js";
import readinessRoute from "../src/routes/readiness.js";

// @ts-expect-error - __dirname is not available in ES modules, using fileURLToPath workaround
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, "../openapi.v3.yaml");

async function main() {
  const app = fastify({
    logger: false,
  }).withTypeProvider<FastifyZodOpenApiTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register all API schemas as components so fastify-zod-openapi can create $ref links
  const components: ZodOpenApiComponentsObject = {
    schemas: {
      // Shared components
      LocalBrowserLaunchOptions: Api.LocalBrowserLaunchOptionsSchema,
      ModelName: Api.ModelNameSchema,
      ModelConfigObject: Api.ModelConfigObjectSchema,
      ModelConfig: Api.ModelConfigSchema,
      Action: Api.ActionSchema,
      SessionIdParams: Api.SessionIdParamsSchema,
      BrowserConfig: Api.BrowserConfigSchema,
      SessionHeaders: Api.SessionHeadersSchema,
      ErrorResponse: Api.ErrorResponseSchema,
      // Browserbase schemas
      BrowserbaseViewport: Api.BrowserbaseViewportSchema,
      BrowserbaseFingerprintScreen: Api.BrowserbaseFingerprintScreenSchema,
      BrowserbaseFingerprint: Api.BrowserbaseFingerprintSchema,
      BrowserbaseContext: Api.BrowserbaseContextSchema,
      BrowserbaseBrowserSettings: Api.BrowserbaseBrowserSettingsSchema,
      BrowserbaseProxyGeolocation: Api.BrowserbaseProxyGeolocationSchema,
      BrowserbaseProxyConfig: Api.BrowserbaseProxyConfigSchema,
      ExternalProxyConfig: Api.ExternalProxyConfigSchema,
      ProxyConfig: Api.ProxyConfigSchema,
      BrowserbaseSessionCreateParams: Api.BrowserbaseSessionCreateParamsSchema,
      // Session Start
      SessionStartRequest: Api.SessionStartRequestSchema,
      SessionStartResult: Api.SessionStartResultSchema,
      SessionStartResponse: Api.SessionStartResponseSchema,
      // Session End
      SessionEndRequest: Api.SessionEndRequestSchema,
      SessionEndResult: Api.SessionEndResultSchema,
      SessionEndResponse: Api.SessionEndResponseSchema,
      // Act
      ActOptions: Api.ActOptionsSchema,
      ActRequest: Api.ActRequestSchema,
      ActResultData: Api.ActResultDataSchema,
      ActResult: Api.ActResultSchema,
      ActResponse: Api.ActResponseSchema,
      // Extract
      ExtractOptions: Api.ExtractOptionsSchema,
      ExtractRequest: Api.ExtractRequestSchema,
      ExtractResult: Api.ExtractResultSchema,
      ExtractResponse: Api.ExtractResponseSchema,
      // Observe
      ObserveOptions: Api.ObserveOptionsSchema,
      ObserveRequest: Api.ObserveRequestSchema,
      ObserveResult: Api.ObserveResultSchema,
      ObserveResponse: Api.ObserveResponseSchema,
      // Agent Execute
      AgentConfig: Api.AgentConfigSchema,
      AgentAction: Api.AgentActionSchema,
      AgentUsage: Api.AgentUsageSchema,
      AgentResultData: Api.AgentResultDataSchema,
      AgentExecuteOptions: Api.AgentExecuteOptionsSchema,
      AgentExecuteRequest: Api.AgentExecuteRequestSchema,
      AgentExecuteResult: Api.AgentExecuteResultSchema,
      AgentExecuteResponse: Api.AgentExecuteResponseSchema,
      // Navigate
      NavigateOptions: Api.NavigateOptionsSchema,
      NavigateRequest: Api.NavigateRequestSchema,
      NavigateResult: Api.NavigateResultSchema,
      NavigateResponse: Api.NavigateResponseSchema,
      // Replay
      TokenUsage: Api.TokenUsageSchema,
      ReplayAction: Api.ReplayActionSchema,
      ReplayPage: Api.ReplayPageSchema,
      ReplayResult: Api.ReplayResultSchema,
      ReplayResponse: Api.ReplayResponseSchema,
      // SSE Stream Events
      StreamEventStatus: Api.StreamEventStatusSchema,
      StreamEventType: Api.StreamEventTypeSchema,
      StreamEventSystemData: Api.StreamEventSystemDataSchema,
      StreamEventLogData: Api.StreamEventLogDataSchema,
      StreamEvent: Api.StreamEventSchema,
    },
  };

  await app.register(fastifyZodOpenApiPlugin, { components });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Stagehand API",
        version: "3.1.0",
        description: `Stagehand SDK for AI browser automation [ALPHA]. This API allows clients to
execute browser automation tasks remotely on the Browserbase cloud.

All endpoints except /sessions/start require an active session ID.
Responses are streamed using Server-Sent Events (SSE) when the
\`x-stream-response: true\` header is provided.

This SDK is currently ALPHA software and is not production ready!
Please try it and give us your feedback, stay tuned for upcoming release announcements!`,
        contact: {
          name: "Browserbase",
          url: "https://browserbase.com",
        },
      },
      openapi: "3.1.0",
      servers: [
        {
          url: "https://api.stagehand.browserbase.com",
          description: "Production Browserbase Cloud API",
        },
      ],
      components: {
        securitySchemes: Api.openApiSecuritySchemes,
        links: Api.openApiLinks,
      },
      security: [
        { BrowserbaseApiKey: [], BrowserbaseProjectId: [], ModelApiKey: [] },
      ],
    },
    ...fastifyZodOpenApiTransformers,
  });

  await app.register(
    (instance, _opts, done) => {
      instance.route(actRoute);
      instance.route(endRoute);
      instance.route(extractRoute);
      instance.route(navigateRoute);
      instance.route(observeRoute);
      instance.route(replayRoute);
      instance.route(startRoute);
      instance.route(agentExecuteRoute);
      done();
    },
    { prefix: "/v1" },
  );

  app.route(healthcheckRoute);
  app.route(readinessRoute);

  await app.ready();

  let yaml = app.swagger({ yaml: true });

  // Post-process for Stainless compatibility:
  // 1. Replace `additionalProperties: {}` with `additionalProperties: true`
  yaml = yaml.replace(
    /additionalProperties: \{\}/g,
    "additionalProperties: true",
  );

  // 2. Remove `propertyNames` blocks (not supported by Stainless)
  // Matches propertyNames with its nested content (type: string)
  yaml = yaml.replace(/\n\s+propertyNames:\n\s+type: string/g, "");

  // 3. Fix z.unknown() fields to have explicit type: unknown
  // ExtractResult*.result and NavigateResult*.result
  yaml = yaml.replace(
    /(ExtractResult(?:Output)?:\s+type: object\s+properties:\s+result:\s+description: [^\n]+)\n(\s+actionId:)/g,
    "$1\n          type: unknown\n$2",
  );
  yaml = yaml.replace(
    /(NavigateResult(?:Output|Data|DataOutput)?:\s+type: object\s+properties:\s+result:\s+description: [^\n]+)\n\s+anyOf:\s+- \{\}\s+- type: "null"\n(\s+actionId:)/g,
    "$1\n          type: unknown\n$2",
  );

  // 4. Add title to proxies array schema for Stainless name inference
  // Matches the array inside proxies anyOf and adds a title
  yaml = yaml.replace(
    /(proxies:\s+anyOf:\s+- type: boolean\s+- )(type: array)/g,
    "$1title: ProxyConfigList\n              $2",
  );

  await writeFile(OUTPUT_PATH, yaml, "utf8");

  await app.close();
  console.log(`OpenAPI spec written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
