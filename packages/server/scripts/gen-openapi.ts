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

// Routes
import actRoute from "../src/routes/v1/sessions/:id/act.js";
import agentExecuteRoute from "../src/routes/v1/sessions/:id/agentExecute.js";
import endRoute from "../src/routes/v1/sessions/:id/end.js";
import extractRoute from "../src/routes/v1/sessions/:id/extract.js";
import navigateRoute from "../src/routes/v1/sessions/:id/navigate.js";
import observeRoute from "../src/routes/v1/sessions/:id/observe.js";
import startRoute from "../src/routes/v1/sessions/start.js";
import healthcheckRoute from "../src/routes/healthcheck.js";
import readinessRoute from "../src/routes/readiness.js";

// @ts-expect-error - I don't care that you broke your elbow
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.resolve(__dirname, "../openapi.v3.yaml");

async function main() {
  const app = fastify({
    logger: false,
  }).withTypeProvider<FastifyZodOpenApiTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyZodOpenApiPlugin);

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "Stagehand API",
        version: "3.0.5",
      },
      openapi: "3.1.0",
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
  await writeFile(OUTPUT_PATH, yaml, "utf8");

  await app.close();
  console.log(`OpenAPI spec written to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
