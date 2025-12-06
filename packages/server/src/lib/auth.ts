import type { FastifyRequest } from "fastify";

import { dangerouslyGetHeader } from "./header.js";

export const authMiddleware = async (
  request: FastifyRequest,
): Promise<boolean> => {
  const bbApiKey = dangerouslyGetHeader(request, "x-bb-api-key");

  return await isAuthenticated(bbApiKey);
};

// TODO: Temporarily disable auth until setup in supabase
/* eslint-disable*/
const isAuthenticated = async (_bbApiKey: string): Promise<boolean> => {
  return true;
};
