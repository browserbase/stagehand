import type { FastifyRequest } from "fastify";

export const authMiddleware = async (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  request: FastifyRequest,
): Promise<boolean> => {
  // Authentication is currently disabled; we may re-enable when a real auth backend is wired up.
  return await isAuthenticated();
};

// TODO: Temporarily disable auth until setup in supabase
const isAuthenticated = async (): Promise<boolean> => {
  return true;
};
