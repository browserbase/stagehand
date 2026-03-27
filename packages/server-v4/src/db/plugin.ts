import fp from "fastify-plugin";
import {
  type DatabaseRuntimeConfig,
  createDatabaseConnection,
} from "./client.js";

export interface DatabasePluginOptions {
  database: DatabaseRuntimeConfig;
  migrateOnStartup?: boolean;
}

export const databasePlugin = fp<DatabasePluginOptions>(
  async (app, { database, migrateOnStartup }) => {
    app.decorate("db", null);
    app.decorate("dbClient", null);
    app.decorate("hasDatabase", false);

    const connection = await createDatabaseConnection(database);

    if (migrateOnStartup) {
      await connection.migrate();
    }
    await connection.ping();

    app.db = connection.db;
    app.dbClient = connection.client;
    app.hasDatabase = true;

    app.addHook("onClose", async () => {
      await connection.close();
    });
  },
  {
    name: "database-plugin",
  },
);
