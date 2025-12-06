import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../env.js";
import { schema } from "./schema.js";

const { DB_HOSTNAME, DB_NAME, DB_PASSWORD, DB_PORT, DB_USERNAME } = env;

const connectionString = `postgres://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOSTNAME}:${DB_PORT}/${DB_NAME}`;

const client = postgres(connectionString, { prepare: false });

export const db = drizzle({
  client,
  schema,
});
