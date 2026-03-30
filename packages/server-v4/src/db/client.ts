import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  type PgliteDatabase,
  drizzle as drizzlePglite,
} from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import {
  drizzle as drizzlePostgres,
  type PostgresJsDatabase,
} from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as relations from "./schema/relations.js";
import * as schema from "./schema/index.js";

export type DatabaseSchema = typeof schema;
export type DatabaseRelations = typeof relations.relations;
export type PostgresDatabaseClient = PostgresJsDatabase<
  DatabaseSchema,
  DatabaseRelations
>;
export type PgliteDatabaseClient = PgliteDatabase<
  DatabaseSchema,
  DatabaseRelations
>;
export type DatabaseClient = PostgresDatabaseClient | PgliteDatabaseClient;
export type DatabaseDriver = ReturnType<typeof postgres> | PGlite;
export type PostgresDatabaseTransaction = Parameters<
  Parameters<PostgresDatabaseClient["transaction"]>[0]
>[0];
export type PgliteDatabaseTransaction = Parameters<
  Parameters<PgliteDatabaseClient["transaction"]>[0]
>[0];
export type DatabaseExecutor =
  | DatabaseClient
  | PostgresDatabaseTransaction
  | PgliteDatabaseTransaction;

export type DatabaseRuntimeConfig =
  | {
      mode: "postgres";
      databaseUrl: string;
    }
  | {
      mode: "pglite";
      dataDir: string;
    };

interface BaseDatabaseConnection {
  client: DatabaseDriver;
  db: DatabaseClient;
  mode: DatabaseRuntimeConfig["mode"];
  migrate: () => Promise<void>;
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

export type DatabaseConnection =
  | (BaseDatabaseConnection & {
      mode: "postgres";
      client: ReturnType<typeof postgres>;
      db: PostgresDatabaseClient;
    })
  | (BaseDatabaseConnection & {
      mode: "pglite";
      client: PGlite;
      db: PgliteDatabaseClient;
    });

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export const createDatabaseConnection = async (
  config: DatabaseRuntimeConfig,
): Promise<DatabaseConnection> => {
  if (config.mode === "postgres") {
    // Supabase pooled Postgres connections do not support prepared statements.
    const client = postgres(config.databaseUrl, { prepare: false });
    const db = drizzlePostgres({
      client,
      schema,
      relations: relations.relations,
    });

    return {
      mode: "postgres",
      client,
      db,
      migrate: async () => {
        await migratePostgres(db, { migrationsFolder });
      },
      ping: async () => {
        await db.execute("select 1");
      },
      close: async () => {
        await client.end();
      },
    };
  }

  fs.mkdirSync(config.dataDir, { recursive: true });
  const client = new PGlite(config.dataDir);
  await client.waitReady;
  const db = drizzlePglite({ client, schema, relations: relations.relations });

  return {
    mode: "pglite",
    client,
    db,
    migrate: async () => {
      await migratePglite(db, { migrationsFolder });
    },
    ping: async () => {
      await db.execute("select 1");
    },
    close: async () => {
      await client.close();
    },
  };
};
