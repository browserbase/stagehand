import type {
  ActDriver,
  ActHandoff,
  ActResolution,
  ExtractDriver,
  ObserveDriver,
} from "./types.js";

const REASON_CHARS = 160;

export function actWithFallback(primary: ActDriver, secondary: ActDriver): ActDriver {
  return {
    name: `${primary.name}+${secondary.name}`,
    startsBeforeSettle: primary.startsBeforeSettle,
    prepare(request) {
      primary.prepare?.(request);
    },
    async resolve(request, handoff) {
      const first = await primary.resolve(request, handoff);
      if (first.kind === "resolved") return first;

      request.logger.info("Act driver abstained; continuing with the next driver", {
        category: "action",
        driver: primary.name,
        next: secondary.name,
        instruction: request.instruction,
        reason: first.reason,
      });
      const carried = mergeHandoffs(handoff, first.handoff);
      const second = await secondary.resolve(request, carried);
      if (second.kind === "abstained") {
        return { ...second, handoff: mergeHandoffs(first.handoff, second.handoff) };
      }
      return {
        kind: "resolved",
        result: withPriorActions(second.result, first.handoff.priorActions),
        path: `${primary.name}+${second.path}`,
        cacheable: second.cacheable && first.handoff.cacheable,
      };
    },
  };
}

export function actOrFail(driver: ActDriver): ActDriver {
  return {
    name: driver.name,
    startsBeforeSettle: driver.startsBeforeSettle,
    prepare(request) {
      driver.prepare?.(request);
    },
    async resolve(request, handoff) {
      const resolution = await driver.resolve(request, handoff);
      if (resolution.kind === "resolved") return resolution;
      return {
        kind: "resolved",
        result: {
          success: false,
          message: `Failed to perform act: the ${driver.name} driver abstained (${resolution.reason.slice(0, REASON_CHARS)})`,
          actionDescription: request.instruction,
          actions: [...resolution.handoff.priorActions],
        },
        path: driver.name,
        cacheable: false,
      };
    },
  };
}

export function observeWithFallback(
  primary: ObserveDriver,
  secondary: ObserveDriver,
): ObserveDriver {
  return {
    name: `${primary.name}+${secondary.name}`,
    async resolve(request) {
      const first = await primary.resolve(request);
      if (first.kind === "resolved") return first;
      request.logger.info("Observe driver abstained; continuing with the next driver", {
        category: "observation",
        driver: primary.name,
        next: secondary.name,
        reason: first.reason,
      });
      return await secondary.resolve(request);
    },
  };
}

export function observeOrFail(driver: ObserveDriver): ObserveDriver {
  return {
    name: driver.name,
    async resolve(request) {
      const resolution = await driver.resolve(request);
      if (resolution.kind === "resolved") return resolution;
      throw new Error(
        `observe() failed: the ${driver.name} driver abstained (${resolution.reason.slice(0, REASON_CHARS)})`,
      );
    },
  };
}

export function extractWithFallback(
  primary: ExtractDriver,
  secondary: ExtractDriver,
): ExtractDriver {
  return {
    name: `${primary.name}+${secondary.name}`,
    async resolve(request) {
      const first = await primary.resolve(request);
      if (first.kind === "resolved") return first;
      request.logger.info("Extract driver abstained; continuing with the next driver", {
        category: "extraction",
        driver: primary.name,
        next: secondary.name,
        instruction: request.instruction,
        reason: first.reason,
      });
      return await secondary.resolve(request);
    },
  };
}

export function extractOrFail(driver: ExtractDriver): ExtractDriver {
  return {
    name: driver.name,
    async resolve(request) {
      const resolution = await driver.resolve(request);
      if (resolution.kind === "resolved") return resolution;
      throw new Error(
        `extract() failed: the ${driver.name} driver abstained (${resolution.reason.slice(0, REASON_CHARS)})`,
      );
    },
  };
}

function mergeHandoffs(earlier: ActHandoff | undefined, later: ActHandoff): ActHandoff {
  if (!earlier) return later;
  return {
    priorActions: [...earlier.priorActions, ...later.priorActions],
    focus: later.focus ?? earlier.focus,
    cacheable: earlier.cacheable && later.cacheable,
  };
}

function withPriorActions(
  result: Extract<ActResolution, { kind: "resolved" }>["result"],
  priorActions: ActHandoff["priorActions"],
): Extract<ActResolution, { kind: "resolved" }>["result"] {
  if (priorActions.length === 0) return result;
  return { ...result, actions: [...priorActions, ...result.actions] };
}
