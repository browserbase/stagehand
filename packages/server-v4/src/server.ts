import { buildApp } from "./app.js";
import { env } from "./env.js";
import { setReady, setUnready } from "./routes/readiness.js";

let app: Awaited<ReturnType<typeof buildApp>> | null = null;

const start = async () => {
  try {
    app = await buildApp();
    await app.ready();

    await app.listen({
      host: "0.0.0.0",
      port: env.PORT,
    });
    setReady();
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

const shutdown = async () => {
  setUnready();
  if (app) {
    await app.close();
  }
  process.exit(0);
};

process.on("SIGTERM", () => {
  shutdown().catch((err: unknown) => {
    console.error("Failed to shut down cleanly:", err);
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  shutdown().catch((err: unknown) => {
    console.error("Failed to shut down cleanly:", err);
    process.exit(1);
  });
});

start().catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
