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
import { browserSessionOpenApiComponents } from "../src/schemas/v4/browserSession.js";
import { pageOpenApiComponents } from "../src/schemas/v4/page.js";
import { browserSessionRoutes } from "../src/routes/v4/browsersession/routes.js";
import { pageRoutes } from "../src/routes/v4/page/routes.js";

// Routes
import healthcheckRoute from "../src/routes/healthcheck.js";
import readinessRoute from "../src/routes/readiness.js";

const OUTPUT_PATH = path.resolve(getCurrentDirPath(), "../openapi.v4.yaml");

async function main() {
  const app = fastify({
    logger: false,
  }).withTypeProvider<FastifyZodOpenApiTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Register all API schemas as components so fastify-zod-openapi can create $ref links
  const components = {
    schemas: {
      ...browserSessionOpenApiComponents.schemas,
      ...pageOpenApiComponents.schemas,
    },
  };

  await app.register(fastifyZodOpenApiPlugin, { components });

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Stagehand API v4",
        version: "4.0.0",
        description: `Stagehand SDK for AI browser automation [ALPHA]. This API allows clients to
execute browser automation tasks remotely on the Browserbase cloud.
Create a browser session with /browsersession, then use that id with page routes.
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
      for (const route of browserSessionRoutes) {
        instance.route(route);
      }
      for (const route of pageRoutes) {
        instance.route(route);
      }
      done();
    },
    { prefix: "/v4" },
  );

  app.route(healthcheckRoute);
  app.route(readinessRoute);

  await app.ready();

  const yaml = app.swagger({ yaml: true });
  // Mintlify expects OpenAPI version fields to be strings, so quote them here.
  const fixedYaml = yaml
    .replace(/^openapi:\s*(?!['"])([^#\s]+)\s*$/m, 'openapi: "$1"')
    .replace(/^ {2}version:\s*(?!['"])([^#\s]+)\s*$/m, '  version: "$1"')
    .replace(
      "description: Wait for captcha solves (deprecated, v2 only)",
      "description: Wait for captcha solves",
    )
    .replace(
      "description: Timeout in ms for act operations (deprecated, v2 only)",
      "description: Timeout in ms for act operations",
    );

  await writeFile(OUTPUT_PATH, fixedYaml, "utf8");

  await app.close();
  console.log(`OpenAPI spec written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
