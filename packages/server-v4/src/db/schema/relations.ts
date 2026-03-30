import { defineRelations } from "drizzle-orm";
import * as schema from "./index.js";

export const relations = defineRelations(schema, (r) => ({
  llmConfigs: {},
  llmSessions: {
    copiedTemplate: r.one.llmSessions({
      from: r.llmSessions.copiedTemplateId,
      to: r.llmSessions.id,
      alias: "copiedTemplate",
    }),
    forkedSession: r.one.llmSessions({
      from: r.llmSessions.forkedSessionId,
      to: r.llmSessions.id,
      alias: "forkedSession",
    }),
    browserSession: r.one.stagehandBrowserSessions({
      from: r.llmSessions.browserSessionId,
      to: r.stagehandBrowserSessions.id,
    }),
    calls: r.many.llmCalls({
      from: r.llmSessions.id,
      to: r.llmCalls.llmSessionId,
    }),
    childCopiedSessions: r.many.llmSessions({
      from: r.llmSessions.id,
      to: r.llmSessions.copiedTemplateId,
      alias: "copiedTemplate",
    }),
    childForkedSessions: r.many.llmSessions({
      from: r.llmSessions.id,
      to: r.llmSessions.forkedSessionId,
      alias: "forkedSession",
    }),
    stagehandStepsAsTemplate: r.many.stagehandSteps({
      from: r.llmSessions.id,
      to: r.stagehandSteps.llmTemplateId,
      alias: "llmTemplate",
    }),
    stagehandStepsAsSession: r.many.stagehandSteps({
      from: r.llmSessions.id,
      to: r.stagehandSteps.llmSessionId,
      alias: "llmSession",
    }),
    defaultBrowserSessions: r.many.stagehandBrowserSessions({
      from: r.llmSessions.id,
      to: r.stagehandBrowserSessions.defaultLLMSessionId,
    }),
  },
  llmCalls: {
    llmSession: r.one.llmSessions({
      from: r.llmCalls.llmSessionId,
      to: r.llmSessions.id,
    }),
  },
  stagehandBrowserSessions: {
    defaultLLMSession: r.one.llmSessions({
      from: r.stagehandBrowserSessions.defaultLLMSessionId,
      to: r.llmSessions.id,
    }),
    llmSessions: r.many.llmSessions({
      from: r.stagehandBrowserSessions.id,
      to: r.llmSessions.browserSessionId,
    }),
    steps: r.many.stagehandSteps({
      from: r.stagehandBrowserSessions.id,
      to: r.stagehandSteps.stagehandBrowserSessionId,
    }),
  },
  stagehandSteps: {
    browserSession: r.one.stagehandBrowserSessions({
      from: r.stagehandSteps.stagehandBrowserSessionId,
      to: r.stagehandBrowserSessions.id,
    }),
    llmTemplate: r.one.llmSessions({
      from: r.stagehandSteps.llmTemplateId,
      to: r.llmSessions.id,
      alias: "llmTemplate",
    }),
    llmSession: r.one.llmSessions({
      from: r.stagehandSteps.llmSessionId,
      to: r.llmSessions.id,
      alias: "llmSession",
    }),
  },
}));
