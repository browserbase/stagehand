import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getCurrentDirPath } from "./runtimePaths.js";

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

const OUTPUT_PATH = path.resolve(getCurrentDirPath(), "../openapi.v3.yaml");

async function main() {
  const app = fastify({
    logger: false,
  }).withTypeProvider<FastifyZodOpenApiTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register all API schemas as components so fastify-zod-openapi can create $ref links
  const components = {
    schemas: {
      // Region support
      BrowserbaseRegion: Api.BrowserbaseRegionSchema,
      // Shared components
      LocalBrowserLaunchOptions: Api.LocalBrowserLaunchOptionsSchema,
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

  const yaml = app.swagger({ yaml: true });
  // Mintlify expects OpenAPI version fields to be strings, so quote them here.
  const fixedYaml = yaml
    .replace(/^openapi:\s*(?!['"])([^#\s]+)\s*$/m, 'openapi: "$1"')
    .replace(/^ {2}version:\s*(?!['"])([^#\s]+)\s*$/m, '  version: "$1"');

  await writeFile(OUTPUT_PATH, fixedYaml, "utf8");

  await app.close();
  console.log(`OpenAPI spec written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
