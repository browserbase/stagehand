import type {
  ActDriver,
  ActHandoff,
  ActResolution,
  ExtractDriver,
  ObserveDriver,
} from "./types.js";

/**
 * Composition of drivers. A chain is itself a driver, so services never know whether they were
 * handed one driver or several.
 */

const REASON_CHARS = 160;

/** `primary` first; when it abstains, `secondary` continues from what it left behind. */
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
        // Relative to this chain: the caller already holds the hand-off it passed in.
        return { ...second, handoff: mergeHandoffs(first.handoff, second.handoff) };
      }
      return {
        kind: "resolved",
        // Whatever the first driver already did changed the page, whether or not the act then
        // succeeded: it belongs in the result either way.
        result: withPriorActions(second.result, first.handoff.priorActions),
        path: `${primary.name}+${second.path}`,
        cacheable: second.cacheable && first.handoff.cacheable,
      };
    },
  };
}

/** `driver` alone: an abstention is a failed act the caller can see, not a silent hand-off. */
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

/** `driver` alone: an abstention throws rather than read as "nothing on the page". */
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
    // The most recent shortlist is the most informed one.
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
