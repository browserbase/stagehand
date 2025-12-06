import { eq } from "drizzle-orm";

import { db } from "./index.js";
import { sessions } from "./schema.js";

export const getSession = async (sessionId: string) => {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  return session;
};

export const createSession = async (session: typeof sessions.$inferInsert) => {
  const newSession = await db.insert(sessions).values(session).returning();

  return newSession;
};
