import { LocatorChainSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type { LocatorChain, LocatorQuerySelector } from "@browserbasehq/stagehand-protocol/types";
import type { Protocol } from "devtools-protocol";
import type { FrameChainMatch } from "../dom/locatorScripts/createFrameChainScope.js";
import type { ElementChainResolution } from "../dom/locatorScripts/resolveElementChain.js";
import { isCdpClosedError, type CDPSessionLike } from "./cdp.js";
import type { ElementChainResult, ElementChainTarget } from "./elementChainResolver.js";
import { executionContexts, type ReadinessOptions } from "./executionContextRegistry.js";
import type { Frame } from "./frame.js";
import { findContentFrameId } from "./frameLocator.js";
import { buildLocatorInvocation } from "./locatorInvocation.js";
import type { Page } from "./page.js";
import { Progress, runWithProgress } from "./progress.js";

type ChainWorld = { session: CDPSessionLike; frameId: string; objectId: string; loaderId?: string };
type Match = FrameChainMatch & { world: ChainWorld };

/** Internal cross-frame orchestration; public locator wiring is a separate change. */
export class FrameChainResolver {
  constructor(
    readonly page: Page,
    readonly root: Frame = page.mainFrame(),
    private readonly readinessOptions: ReadinessOptions = {},
  ) {}

  resolve(
    chain: LocatorChain,
    resolution: ElementChainResolution,
    progress?: Progress,
  ): Promise<ElementChainResult> {
    return runWithProgress(
      progress ?? { name: "resolve frame chain", timeout: 0 },
      async (context) => {
        const validated = LocatorChainSchema.parse(chain);
        if (
          resolution.mode === "selected" &&
          (!Number.isSafeInteger(resolution.index) || resolution.index < 0)
        ) {
          throw new RangeError("Selected chain index must be a non-negative safe integer");
        }
        const operation = new FrameChainOperation(this.page, context, this.readinessOptions);
        try {
          return await operation.resolve(this.root, validated, resolution);
        } finally {
          await operation.dispose();
          context.throwIfStopped();
        }
      },
    );
  }
}

/** All remote state belongs to this call, including objects created by late replies. */
class FrameChainOperation {
  private readonly objectGroup = `stagehand-frame-chain-${crypto.randomUUID()}`;
  private readonly sessions = new Set<CDPSessionLike>();
  private readonly worlds = new Map<string, ChainWorld>();
  private finishing = false;

  constructor(
    private readonly page: Page,
    private readonly progress: Progress,
    private readonly readinessOptions: ReadinessOptions,
  ) {}

  async resolve(
    root: Frame,
    chain: LocatorChain,
    resolution: ElementChainResolution,
  ): Promise<ElementChainResult> {
    let matches: Match[] = [{ world: await this.world(root.frameId), id: 0, isFrame: false }];
    for (const step of chain.steps) {
      this.progress.throwIfStopped();
      if (!matches.length) break;
      if (step.type === "nth") {
        matches = matches[step.index] ? [matches[step.index]] : [];
        continue;
      }
      if (step.type === "frame" && matches.some((match) => !match.isFrame)) {
        throw new Error("Explicit frame hop requires an iframe or frame element");
      }
      const scopes = [...matches];
      // Only iframe hosts need intermediate backend IDs. Export them in one
      // batch per document, retaining their positions among ordinary scopes.
      for (const [world, entries] of groupByWorld(matches)) {
        const frames = entries.filter(({ match }) => match.isFrame);
        if (!frames.length) continue;
        const targets = await this.targets(
          world,
          frames.map(({ match }) => match.id),
        );
        for (const [index, entry] of frames.entries()) {
          scopes[entry.index] = {
            world: await this.childWorld(entry.match, targets[index].backendNodeId),
            id: 0,
            isFrame: false,
          };
        }
      }
      matches = await this.query(step.selector, scopes);
    }
    this.assertWorlds();
    if (resolution.mode === "count") return { mode: "count", count: matches.length };
    if (resolution.mode === "selected") {
      matches = matches[resolution.index] ? [matches[resolution.index]] : [];
    }
    const targets: ElementChainTarget[] = [];
    for (const [world, entries] of groupByWorld(matches)) {
      const resolved = await this.targets(
        world,
        entries.map(({ match }) => match.id),
      );
      entries.forEach(({ index }, i) => {
        targets[index] = resolved[i];
      });
    }
    this.assertWorlds();
    return { mode: resolution.mode, targets };
  }

  private async childWorld(match: Match, backendNodeId: number): Promise<ChainWorld> {
    const deadline = Number.isFinite(this.progress.remainingMs())
      ? Infinity
      : performance.now() + 1000;
    while (true) {
      this.assertWorld(match.world);
      const frameId = await this.progress.run("entering chain iframe", () =>
        findContentFrameId(this.page, match.world, backendNodeId, this.progress, 0),
      );
      this.assertWorld(match.world);
      if (frameId) return this.world(frameId);
      // A registered sibling is not evidence that this host's frame has been
      // discovered. Retry discovery, but stop immediately for a detached host.
      await this.call(match.world, "function(id) { this.elements([id]); }", [match.id], true);
      if (this.readinessOptions.readinessRetries === "none" || performance.now() >= deadline) {
        throw new Error(`Unable to obtain a content frame for backend node: ${backendNodeId}`);
      }
      await this.progress.delay(50);
    }
  }

  private assertAttached(frameId: string) {
    const frame = this.page.registry.frames.get(frameId);
    if (!frame) throw new Error(`Chain frame detached: ${frameId}`);
    return frame;
  }

  private assertWorld(world: ChainWorld) {
    this.progress.throwIfStopped();
    const frame = this.assertAttached(world.frameId);
    if (
      this.page.getSessionForFrame(world.frameId) !== world.session ||
      frame.lastSeen?.loaderId !== world.loaderId
    ) {
      throw new Error(`Chain frame changed during resolution: ${world.frameId}`);
    }
  }

  private assertWorlds() {
    for (const world of this.worlds.values()) this.assertWorld(world);
  }

  private async query(selector: LocatorQuerySelector, scopes: Match[]): Promise<Match[]> {
    const byScope: Match[][] = [];
    for (const [world, entries] of groupByWorld(scopes)) {
      const result = await this.call(
        world,
        "function(selector, scopes) { return this.query(selector, scopes); }",
        [selector, entries.map(({ match }) => match.id)],
        true,
      );
      const groups = result.value as FrameChainMatch[][];
      entries.forEach(({ index }, i) => {
        byScope[index] = groups[i].map((match) => ({ ...match, world }));
      });
    }
    const seen = new Map<ChainWorld, Set<number>>();
    return byScope.flat().filter(({ world, id }) => {
      let ids = seen.get(world);
      if (!ids) {
        ids = new Set();
        seen.set(world, ids);
      }
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    });
  }

  private async world(frameId: string): Promise<ChainWorld> {
    const cached = this.worlds.get(frameId);
    if (cached) {
      this.assertWorld(cached);
      return cached;
    }
    // Recheck ownership between attempts: an OOPIF may be adopted while its
    // isolated world is being installed. Deadline-less calls get one attempt.
    while (true) {
      this.progress.throwIfStopped();
      this.assertAttached(frameId);
      const session = this.page.getSessionForFrame(frameId);
      let contextId: number;
      try {
        ({ contextId } = await this.progress.run("waiting for chain locator world", () =>
          executionContexts.waitForLocatorWorld(session, frameId, 1000, this.progress, {
            readinessRetries: "none",
          }),
        ));
      } catch (error) {
        this.progress.throwIfStopped();
        this.assertAttached(frameId);
        if (
          (isCdpClosedError(error) &&
            (error.message.startsWith("CDP connection closed:") ||
              session === this.page.getSessionForFrame(frameId))) ||
          this.readinessOptions.readinessRetries === "none" ||
          !Number.isFinite(this.progress.remainingMs())
        )
          throw error;
        await this.progress.delay(50);
        continue;
      }
      if (session !== this.page.getSessionForFrame(frameId)) {
        if (
          this.readinessOptions.readinessRetries === "none" ||
          !Number.isFinite(this.progress.remainingMs())
        ) {
          throw new Error(`Chain frame changed during readiness: ${frameId}`);
        }
        await this.progress.delay(50);
        continue;
      }
      const loaderId = this.assertAttached(frameId).lastSeen?.loaderId;
      const response = await this.send<Protocol.Runtime.EvaluateResponse>(
        session,
        "Runtime.evaluate",
        {
          expression: buildLocatorInvocation("createFrameChainScope", []),
          contextId,
          objectGroup: this.objectGroup,
        },
      );
      throwException(response.exceptionDetails);
      if (!response.result.objectId) throw new Error("Missing frame chain scope handle");
      const world = { session, frameId, objectId: response.result.objectId, loaderId };
      this.assertWorld(world);
      this.worlds.set(frameId, world);
      return world;
    }
  }

  private async call(
    world: ChainWorld,
    functionDeclaration: string,
    args: unknown[],
    returnByValue = false,
  ) {
    this.assertWorld(world);
    const response = await this.send<Protocol.Runtime.CallFunctionOnResponse>(
      world.session,
      "Runtime.callFunctionOn",
      {
        objectId: world.objectId,
        functionDeclaration,
        arguments: args.map((value) => ({ value })),
        objectGroup: this.objectGroup,
        returnByValue,
      },
    );
    this.assertWorld(world);
    throwException(response.exceptionDetails);
    return response.result;
  }

  private async targets(world: ChainWorld, ids: number[]): Promise<ElementChainTarget[]> {
    const result = await this.call(world, "function(ids) { return this.elements(ids); }", [ids]);
    if (!result.objectId) throw new Error("Missing frame chain targets handle");
    const properties = await this.send<Protocol.Runtime.GetPropertiesResponse>(
      world.session,
      "Runtime.getProperties",
      {
        objectId: result.objectId,
        ownProperties: true,
      },
    );
    throwException(properties.exceptionDetails);
    const handles = properties.result
      .filter((property) => /^(0|[1-9]\d*)$/.test(property.name) && property.value?.objectId)
      .sort((a, b) => Number(a.name) - Number(b.name))
      .map((property) => property.value!.objectId!);
    const targets: ElementChainTarget[] = [];
    let next = 0;
    let stopped = false;
    try {
      await Promise.all(
        Array.from({ length: Math.min(4, handles.length) }, async () => {
          while (!stopped && next < handles.length) {
            const index = next++;
            try {
              const { node } = await this.send<Protocol.DOM.DescribeNodeResponse>(
                world.session,
                "DOM.describeNode",
                { objectId: handles[index] },
              );
              targets[index] = {
                session: world.session,
                frameId: world.frameId,
                backendNodeId: node.backendNodeId,
              };
            } catch (error) {
              stopped = true;
              throw error;
            }
          }
        }),
      );
    } finally {
      stopped = true;
    }
    return targets;
  }

  private send<T>(session: CDPSessionLike, method: string, params: object): Promise<T> {
    this.sessions.add(session);
    return this.progress.run(
      method,
      async () => {
        try {
          return await session.send<T>(method, params);
        } catch (error) {
          if (this.finishing) void this.release(session);
          throw error;
        }
      },
      () => this.release(session),
    );
  }

  private release(session: CDPSessionLike) {
    return this.progress.cleanup(() =>
      session.send("Runtime.releaseObjectGroup", { objectGroup: this.objectGroup }),
    );
  }

  async dispose() {
    this.finishing = true;
    await Promise.all([...this.sessions].map((session) => this.release(session)));
  }
}

function groupByWorld(matches: Match[]) {
  const groups = new Map<ChainWorld, { match: Match; index: number }[]>();
  matches.forEach((match, index) => {
    let entries = groups.get(match.world);
    if (!entries) {
      entries = [];
      groups.set(match.world, entries);
    }
    entries.push({ match, index });
  });
  return groups;
}

function throwException(details?: Protocol.Runtime.ExceptionDetails): void {
  if (details) throw new Error(details.exception?.description ?? details.text);
}
