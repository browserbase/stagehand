module act_driver_lifecycle {
  pure val MAX_STEPS: int = 14

  type Phase =
    | Init
    | Settling
    | CacheLookup
    | CacheReplay
    | RouteSelect
    | WebMCPExec
    | LlmPlan
    | DomExec
    | RecoverOrRetry
    | Verify
    | CacheWrite
    | Done

  type Outcome =
    | Running
    | Success
    | Failed
    | TimedOut
    | Aborted

  type CacheStatus =
    | CacheNone
    | CacheHit
    | CacheMiss
    | CacheError

  type ExecRoute =
    | RouteNone
    | RouteCacheReplay
    | RouteWebMCP
    | RouteLlmDom

  type StopReason =
    | StopNone
    | StopTimeout
    | StopAbort

  var phase: Phase
  var outcome: Outcome
  var domSettled: bool
  var readinessReady: bool
  var cacheBypass: bool
  var cacheStatus: CacheStatus
  var webMcpToolAvailable: bool
  var execRoute: ExecRoute
  var hasCancelSource: bool
  var stopSignal: StopReason
  var effectsAtStop: int
  var webMcpInvocations: int
  var domClickEffects: int
  var verified: bool
  var recoveredOrRetried: bool
  var cacheEligible: bool
  var cacheWritten: bool
  var stepsTaken: int

  action init = {
    nondet cancelable = Set(true, false).oneOf()
    all {
      phase' = Init,
      outcome' = Running,
      domSettled' = false,
      readinessReady' = false,
      cacheBypass' = false,
      cacheStatus' = CacheNone,
      webMcpToolAvailable' = false,
      execRoute' = RouteNone,
      hasCancelSource' = cancelable,
      stopSignal' = StopNone,
      effectsAtStop' = -1,
      webMcpInvocations' = 0,
      domClickEffects' = 0,
      verified' = false,
      recoveredOrRetried' = false,
      cacheEligible' = false,
      cacheWritten' = false,
      stepsTaken' = 0,
    }
  }

  action startAct(bypass: bool, toolAvail: bool): bool = all {
    phase == Init,
    stopSignal == StopNone,
    phase' = Settling,
    outcome' = Running,
    domSettled' = false,
    readinessReady' = false,
    cacheBypass' = bypass,
    cacheStatus' = CacheNone,
    webMcpToolAvailable' = toolAvail,
    execRoute' = RouteNone,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = 0,
    domClickEffects' = 0,
    verified' = false,
    recoveredOrRetried' = false,
    cacheEligible' = not(bypass),
    cacheWritten' = false,
    stepsTaken' = stepsTaken + 1,
  }

  action domSettleCompletes: bool = all {
    phase == Settling,
    stopSignal == StopNone,
    not(domSettled),
    domSettled' = true,
    stepsTaken' = stepsTaken + 1,
    phase' = phase,
    outcome' = outcome,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action readinessCompletes: bool = all {
    phase == Settling,
    stopSignal == StopNone,
    not(readinessReady),
    readinessReady' = true,
    stepsTaken' = stepsTaken + 1,
    phase' = phase,
    outcome' = outcome,
    domSettled' = domSettled,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action advanceFromSettle: bool = all {
    phase == Settling,
    stopSignal == StopNone,
    domSettled,
    readinessReady,
    phase' = if (cacheBypass) RouteSelect else CacheLookup,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action cacheHit: bool = all {
    phase == CacheLookup,
    stopSignal == StopNone,
    phase' = CacheReplay,
    cacheStatus' = CacheHit,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action cacheMissOrError(status: CacheStatus): bool = all {
    phase == CacheLookup,
    stopSignal == StopNone,
    status == CacheMiss or status == CacheError,
    phase' = RouteSelect,
    cacheStatus' = status,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action cacheReplaySucceed: bool = all {
    phase == CacheReplay,
    stopSignal == StopNone,
    phase' = Done,
    outcome' = Success,
    execRoute' = RouteCacheReplay,
    domClickEffects' = domClickEffects + 1,
    verified' = true,
    stepsTaken' = stepsTaken + 1,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action cacheReplayPreCommitFail: bool = all {
    phase == CacheReplay,
    stopSignal == StopNone,
    phase' = RouteSelect,
    cacheStatus' = CacheMiss,
    recoveredOrRetried' = true,
    cacheEligible' = false,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    cacheWritten' = cacheWritten,
  }

  action selectWebMCPRoute: bool = all {
    phase == RouteSelect,
    stopSignal == StopNone,
    webMcpToolAvailable,
    phase' = WebMCPExec,
    execRoute' = RouteWebMCP,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action selectLlmDriverRoute: bool = all {
    phase == RouteSelect,
    stopSignal == StopNone,
    phase' = LlmPlan,
    execRoute' = RouteLlmDom,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action webMcpSucceed: bool = all {
    phase == WebMCPExec,
    stopSignal == StopNone,
    phase' = Verify,
    webMcpInvocations' = webMcpInvocations + 1,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action webMcpFailBeforeEffectFallbackToLlm: bool = all {
    phase == WebMCPExec,
    stopSignal == StopNone,
    phase' = LlmPlan,
    execRoute' = RouteLlmDom,
    recoveredOrRetried' = true,
    cacheEligible' = false,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    cacheWritten' = cacheWritten,
  }

  action webMcpFailAfterEffect: bool = all {
    phase == WebMCPExec,
    stopSignal == StopNone,
    phase' = Done,
    outcome' = Failed,
    webMcpInvocations' = webMcpInvocations + 1,
    verified' = false,
    cacheEligible' = false,
    stepsTaken' = stepsTaken + 1,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    domClickEffects' = domClickEffects,
    recoveredOrRetried' = recoveredOrRetried,
    cacheWritten' = cacheWritten,
  }

  action llmPlanActionFound: bool = all {
    phase == LlmPlan,
    stopSignal == StopNone,
    phase' = DomExec,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action llmPlanNoAction: bool = all {
    phase == LlmPlan,
    stopSignal == StopNone,
    phase' = Done,
    outcome' = Failed,
    verified' = false,
    cacheEligible' = false,
    stepsTaken' = stepsTaken + 1,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    recoveredOrRetried' = recoveredOrRetried,
    cacheWritten' = cacheWritten,
  }

  action domExecSucceed: bool = all {
    phase == DomExec,
    stopSignal == StopNone,
    phase' = Verify,
    domClickEffects' = domClickEffects + 1,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action domExecPreCommitFailToSelfHeal: bool = all {
    phase == DomExec,
    stopSignal == StopNone,
    not(recoveredOrRetried),
    phase' = RecoverOrRetry,
    recoveredOrRetried' = true,
    cacheEligible' = false,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    cacheWritten' = cacheWritten,
  }

  action domExecFailTerminal: bool = all {
    phase == DomExec,
    stopSignal == StopNone,
    phase' = Done,
    outcome' = Failed,
    verified' = false,
    cacheEligible' = false,
    stepsTaken' = stepsTaken + 1,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    recoveredOrRetried' = recoveredOrRetried,
    cacheWritten' = cacheWritten,
  }

  action selfHealSucceed: bool = all {
    phase == RecoverOrRetry,
    stopSignal == StopNone,
    phase' = Verify,
    domClickEffects' = domClickEffects + 1,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action selfHealFail: bool = all {
    phase == RecoverOrRetry,
    stopSignal == StopNone,
    phase' = Done,
    outcome' = Failed,
    verified' = false,
    cacheEligible' = false,
    stepsTaken' = stepsTaken + 1,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    recoveredOrRetried' = recoveredOrRetried,
    cacheWritten' = cacheWritten,
  }

  action verifyPassed: bool = all {
    phase == Verify,
    stopSignal == StopNone,
    phase' = CacheWrite,
    verified' = true,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action verifyUnverified: bool = all {
    phase == Verify,
    stopSignal == StopNone,
    phase' = CacheWrite,
    verified' = false,
    cacheEligible' = false,
    stepsTaken' = stepsTaken + 1,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    recoveredOrRetried' = recoveredOrRetried,
    cacheWritten' = cacheWritten,
  }

  action finishWithCacheWrite: bool = all {
    phase == CacheWrite,
    stopSignal == StopNone,
    cacheEligible,
    phase' = Done,
    outcome' = Success,
    cacheWritten' = true,
    stepsTaken' = stepsTaken + 1,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
  }

  action finishSkipCacheWrite: bool = all {
    phase == CacheWrite,
    stopSignal == StopNone,
    phase' = Done,
    outcome' = Success,
    cacheWritten' = false,
    stepsTaken' = stepsTaken + 1,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
  }

  action signalProgressStop(reason: StopReason): bool = all {
    phase != Done,
    hasCancelSource,
    stopSignal == StopNone,
    reason == StopTimeout or reason == StopAbort,
    stopSignal' = reason,
    effectsAtStop' = webMcpInvocations + domClickEffects,
    stepsTaken' = stepsTaken + 1,
    phase' = phase,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
  }

  action observeProgressStop: bool = all {
    phase != Done,
    stopSignal != StopNone,
    phase' = Done,
    outcome' = if (stopSignal == StopTimeout) TimedOut else Aborted,
    cacheEligible' = false,
    cacheWritten' = false,
    stepsTaken' = stepsTaken + 1,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
  }

  action stutterDone: bool = all {
    phase == Done,
    phase' = phase,
    outcome' = outcome,
    domSettled' = domSettled,
    readinessReady' = readinessReady,
    cacheBypass' = cacheBypass,
    cacheStatus' = cacheStatus,
    webMcpToolAvailable' = webMcpToolAvailable,
    execRoute' = execRoute,
    hasCancelSource' = hasCancelSource,
    stopSignal' = stopSignal,
    effectsAtStop' = effectsAtStop,
    webMcpInvocations' = webMcpInvocations,
    domClickEffects' = domClickEffects,
    verified' = verified,
    recoveredOrRetried' = recoveredOrRetried,
    cacheEligible' = cacheEligible,
    cacheWritten' = cacheWritten,
    stepsTaken' = stepsTaken,
  }

  action step = any {
    {
      nondet bypass = Set(true, false).oneOf()
      nondet toolAvail = Set(true, false).oneOf()
      startAct(bypass, toolAvail)
    },
    domSettleCompletes,
    readinessCompletes,
    advanceFromSettle,
    cacheHit,
    {
      nondet st = Set(CacheMiss, CacheError).oneOf()
      cacheMissOrError(st)
    },
    cacheReplaySucceed,
    cacheReplayPreCommitFail,
    selectWebMCPRoute,
    selectLlmDriverRoute,
    webMcpSucceed,
    webMcpFailBeforeEffectFallbackToLlm,
    webMcpFailAfterEffect,
    llmPlanActionFound,
    llmPlanNoAction,
    domExecSucceed,
    domExecPreCommitFailToSelfHeal,
    domExecFailTerminal,
    selfHealSucceed,
    selfHealFail,
    verifyPassed,
    verifyUnverified,
    finishWithCacheWrite,
    finishSkipCacheWrite,
    {
      nondet reason = Set(StopTimeout, StopAbort).oneOf()
      signalProgressStop(reason)
    },
    observeProgressStop,
    stutterDone,
  }

  val singleSideEffect: bool =
    webMcpInvocations + domClickEffects <= 1

  val neverBothToolAndDomClick: bool =
    not(webMcpInvocations > 0 and domClickEffects > 0)

  val noCacheOnRecovery: bool =
    cacheWritten implies and {
      verified,
      not(recoveredOrRetried),
      not(cacheBypass),
    }

  val cancellationPreventsDispatch: bool =
    (stopSignal != StopNone) implies and {
      webMcpInvocations + domClickEffects == effectsAtStop,
      not(cacheWritten),
    }

  val terminatesCleanly: bool = and {
    (phase == Done) iff (outcome != Running),
    (outcome == Failed or outcome == TimedOut or outcome == Aborted) implies not(cacheWritten),
    (outcome == Success) implies (webMcpInvocations + domClickEffects == 1),
    stepsTaken <= MAX_STEPS,
  }

  val allInvariants: bool = and {
    singleSideEffect,
    neverBothToolAndDomClick,
    noCacheOnRecovery,
    cancellationPreventsDispatch,
    terminatesCleanly,
  }
}
