import { asc, desc, eq } from "drizzle-orm";
import { StatusCodes } from "http-status-codes";

import { AppError } from "../errorHandler.js";
import { db } from "./index.js";
import { actions, type ActionRow } from "./schema.js";

export const getSessionActions = async (sessionId: string) => {
  const sessionActions = await db
    .select()
    .from(actions)
    .where(eq(actions.sessionId, sessionId))
    .orderBy(asc(actions.timestamp));

  return sessionActions;
};

export const getLatestAct = async (sessionId: string) => {
  const recentAction = await db
    .select()
    .from(actions)
    .where(eq(actions.sessionId, sessionId))
    .orderBy(desc(actions.timestamp))
    .limit(1);

  return recentAction[0];
};

export const updateActionXpath = async (actionId: string, xpath: string) => {
  await db
    .update(actions)
    .set({ [actions.xpath.name]: xpath })
    .where(eq(actions.id, actionId));
};

export const updateActionResult = async (actionId: string, result: object) => {
  await db
    .update(actions)
    .set({ [actions.result.name]: result })
    .where(eq(actions.id, actionId));
};

export const updateActionEndTime = async (actionId: string, endTime: Date) => {
  await db
    .update(actions)
    .set({ endTime: endTime })
    .where(eq(actions.id, actionId));
};

export const updateActionStartAndEndTime = async (
  actionId: string,
  startTime: Date,
  endTime: Date,
) => {
  await db
    .update(actions)
    .set({ startTime, endTime })
    .where(eq(actions.id, actionId));
};

export const createAction = async (action: ActionRow) => {
  const [createdAction] = await db.insert(actions).values(action).returning();

  if (!createdAction) {
    throw new AppError(
      "Failed to create action",
      StatusCodes.INTERNAL_SERVER_ERROR,
    );
  }

  return createdAction;
};

export const getAction = async (actionId: string) => {
  const action = await db
    .select()
    .from(actions)
    .where(eq(actions.id, actionId))
    .orderBy(desc(actions.timestamp));
  return action[0];
};
