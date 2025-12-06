import type { AgentAction, AgentResult } from "stagehand-v3";
import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";

import { authMiddleware } from "../../../../lib/auth.js";
import { getSessionActions } from "../../../../lib/db/actions.js";
import { db } from "../../../../lib/db/index.js";
import { inference } from "../../../../lib/db/schema.js";
import { getSession } from "../../../../lib/db/sessions.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { error, success } from "../../../../lib/response.js";
import type {
  StagehandReplay,
  StagehandReplayPage,
} from "../../../../types/replay.js";

interface ReplayParams {
  id: string;
}

function getDomainFromUrl(url: string): string {
  const candidate = url.trim();
  if (!candidate) {
    return "about:blank";
  }
  try {
    const urlObj = new URL(candidate);
    return urlObj.hostname || "about:blank";
  } catch {
    return url;
  }
}

const replayRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return error(reply, "Unauthorized", StatusCodes.UNAUTHORIZED);
    }

    const { id: sessionId } = request.params as ReplayParams;

    const session = await getSession(sessionId);

    if (!session) {
      return error(reply, "Session not found", StatusCodes.NOT_FOUND);
    }

    const actions = await getSessionActions(sessionId);

    const sortedActions = actions
      .filter((action) => action.timestamp)
      .sort(
        (a, b) => (a.timestamp?.getTime() ?? 0) - (b.timestamp?.getTime() ?? 0),
      );

    const tokenUsage = await db
      .select()
      .from(inference)
      .where(
        inArray(
          inference.actionId,
          sortedActions.map((action) => action.id).filter(Boolean),
        ),
      );

    const tokenUsageMap = new Map(
      tokenUsage.map((usage) => [usage.actionId, usage]),
    );

    const pages: StagehandReplayPage[] = [];
    let currentPage: StagehandReplayPage | null = null;

    for (const action of sortedActions) {
      const timestamp = action.timestamp?.getTime() ?? 0;
      const domain = getDomainFromUrl(action.url ?? currentPage?.url ?? "");

      if (!currentPage || currentPage.url !== domain) {
        if (currentPage) {
          currentPage.duration = timestamp - currentPage.timestamp;
          pages.push(currentPage);
        }

        currentPage = {
          url: domain,
          timestamp,
          duration: 0,
          actions: [],
        };
      }

      const usage = tokenUsageMap.get(action.id);

      const parentAction = {
        method: action.method ?? "",
        parameters: action.options as Record<string, unknown>,
        result: action.result as Record<string, unknown>,
        timestamp,
        endTime: action.endTime?.getTime(),
        tokenUsage: usage
          ? {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              timeMs: usage.timeMs ?? 0,
            }
          : undefined,
      };

      // If this is an agentExecute action with nested actions that include pageUrl,
      // we'll 1) push the parent without the nested actions array (to prevent the frontend from having to process it)
      // and 2) expand nested actions into their own rows, grouping by pageUrl domain.
      const isAgentExecute = (action.method ?? "") === "agentExecute";
      const agentResult = (action.result ?? null) as AgentResult | null;
      const nested: AgentAction[] | null = Array.isArray(agentResult?.actions)
        ? agentResult.actions
        : null;

      if (isAgentExecute && agentResult && nested) {
        // Check if all nested actions have required fields (timestamp and pageUrl)
        // Skip the entire agentExecute action if any nested action is incomplete
        // (this happens with older versions that didn't include these fields)
        const allActionsComplete = nested.every(
          (sub) =>
            typeof sub.timestamp === "number" &&
            typeof sub.pageUrl === "string",
        );

        if (!allActionsComplete) {
          // Skip this entire agentExecute action - don't show incomplete data
          continue;
        }

        // Omit nested actions from parent result since we're expanding them below
        // destructuring the object normally would be ideal, but causes a lint error
        const parentResultWithoutNested: Partial<AgentResult> = {
          ...agentResult,
        };
        delete parentResultWithoutNested.actions;

        currentPage.actions.push({
          ...parentAction,
          result: parentResultWithoutNested as unknown as Record<
            string,
            unknown
          >,
        });

        // Expand nested actions and group by their pageUrl domains
        for (const sub of nested) {
          const childTimestamp = Number(sub.timestamp);
          const subPageUrl = String(sub.pageUrl);
          const childDomain = getDomainFromUrl(subPageUrl);

          if (currentPage.url !== childDomain) {
            currentPage.duration = childTimestamp - currentPage.timestamp;
            pages.push(currentPage);

            currentPage = {
              url: childDomain,
              timestamp: childTimestamp,
              duration: 0,
              actions: [],
            };
          }

          const subType = sub.type;

          const childResult: Record<string, unknown> = {};
          if (sub.reasoning) childResult.reasoning = sub.reasoning;
          if (sub.taskCompleted !== undefined)
            childResult.taskCompleted = sub.taskCompleted;

          currentPage.actions.push({
            method: `agent:${subType}`,
            parameters: sub,
            result: Object.keys(childResult).length > 0 ? childResult : {},
            timestamp: childTimestamp,
          });
        }
      } else {
        currentPage.actions.push(parentAction);
      }
    }

    if (currentPage) {
      const lastAction = sortedActions[sortedActions.length - 1];
      if (lastAction?.timestamp) {
        currentPage.duration =
          lastAction.timestamp.getTime() - currentPage.timestamp;
      }
      pages.push(currentPage);
    }

    const replay: StagehandReplay = {
      pages,
    };

    const requestLanguage = request.headers["x-language"] as string | undefined;
    if (requestLanguage && requestLanguage === "true") {
      replay.clientLanguage = session.clientLanguage ?? undefined;
    }

    return success(reply, replay);
  },
);

const replayRoute: RouteOptions = {
  method: "GET",
  url: "/sessions/:id/replay",
  handler: replayRouteHandler,
  schema: {
    params: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
};

export default replayRoute;
