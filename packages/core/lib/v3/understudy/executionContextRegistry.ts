import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp";

type FrameId = Protocol.Page.FrameId;
type ExecId = Protocol.Runtime.ExecutionContextId;

/** Internal name for our isolated world - not visible to page scripts */
const ISOLATED_WORLD_NAME = "__stagehand_isolated__";

export class ExecutionContextRegistry {
  private readonly byFrame = new WeakMap<
    CDPSessionLike,
    Map<FrameId, ExecId>
  >();
  private readonly byExec = new WeakMap<CDPSessionLike, Map<ExecId, FrameId>>();

  /** Tracks isolated worlds we've created per session+frame */
  private readonly isolatedByFrame = new WeakMap<
    CDPSessionLike,
    Map<FrameId, ExecId>
  >();

  /** Tracks which CDP domains are enabled per session to avoid redundant enables */
  private readonly enabledDomains = new WeakMap<CDPSessionLike, Set<string>>();

  /** Wire listeners for this session (optional - only for cleanup purposes). */
  attachSession(session: CDPSessionLike): void {
    const onDestroyed = (
      evt: Protocol.Runtime.ExecutionContextDestroyedEvent,
    ): void => {
      const rev = this.byExec.get(session);
      const fwd = this.byFrame.get(session);
      if (!rev || !fwd) return;
      const frameId = rev.get(evt.executionContextId);
      if (!frameId) return;
      rev.delete(evt.executionContextId);
      if (fwd.get(frameId) === evt.executionContextId) fwd.delete(frameId);

      // Also clean up isolated world if it matches
      const isolated = this.isolatedByFrame.get(session);
      if (isolated?.get(frameId) === evt.executionContextId) {
        isolated.delete(frameId);
      }
    };
    const onCleared = (): void => {
      this.byFrame.delete(session);
      this.byExec.delete(session);
      this.isolatedByFrame.delete(session);
      this.enabledDomains.delete(session);
    };

    // Note: We intentionally do NOT listen for Runtime.executionContextCreated
    // because that requires Runtime.enable which is detectable.
    // Instead, we get context IDs via Runtime.evaluate + objectId parsing (Patchright approach)
    session.on("Runtime.executionContextDestroyed", onDestroyed);
    session.on("Runtime.executionContextsCleared", onCleared);
  }

  getMainWorld(session: CDPSessionLike, frameId: FrameId): ExecId | null {
    return this.byFrame.get(session)?.get(frameId) ?? null;
  }

  /**
   * Get main world execution context ID WITHOUT using Runtime.enable.
   * evaluate globalThis and parse the objectId.
   * 
   * The objectId format includes the execution context ID, allowing us to
   * discover the main world context without triggering Runtime domain events.
   * 
   * For SPIFs (same-process iframes), we use DOM.resolveNode to get an objectId
   * in the frame's context, since Runtime.evaluate without contextId only works
   * for the main frame.
   */
  async getMainWorldStealth(
    session: CDPSessionLike,
    frameId: FrameId,
  ): Promise<ExecId> {
    // Check if this is the main frame or a SPIF
    try {
      const frameTree = await session
        .send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree")
        .catch((): null => null);

      const mainFrameId = frameTree?.frameTree?.frame?.id;

      if (mainFrameId && frameId === mainFrameId) {
        // Main frame - use simple Patchright approach
        return this.getMainWorldForMainFrame(session, frameId);
      }

      // For SPIFs, use DOM.resolveNode approach to get into their context
      return this.getMainWorldForSpif(session, frameId);
    } catch {
      // Fallback to simple approach if getFrameTree fails
      return this.getMainWorldForMainFrame(session, frameId);
    }
  }

  /**
   * Get main world context for the main frame using Patchright's globalThis approach.
   */
  private async getMainWorldForMainFrame(
    session: CDPSessionLike,
    frameId: FrameId,
  ): Promise<ExecId> {
    try {
      //evaluate globalThis and extract context ID from objectId
      // When no contextId is specified, Runtime.evaluate runs in the main world
      const result = await session.send<{
        result: { objectId?: string };
        exceptionDetails?: unknown;
      }>("Runtime.evaluate", {
        expression: "globalThis",
        serializationOptions: { serialization: "idOnly" },
      });

      if (result.result?.objectId) {
        const contextId = this.parseContextIdFromObjectId(result.result.objectId);
        if (contextId !== null) {
          this.register(session, frameId, contextId);
          return contextId;
        }
      }
    } catch {
      // Fall through to throw
    }

    throw new Error(`Failed to get main world context for main frame ${frameId}`);
  }

  /**
   * Get main world context for a SPIF (same-process iframe) using DOM.resolveNode.
   * Since Runtime.evaluate without contextId only works for main frame,
   * we use DOM to get a reference to the frame's document and extract the contextId.
   */
  private async getMainWorldForSpif(
    session: CDPSessionLike,
    frameId: FrameId,
  ): Promise<ExecId> {
    await this.ensureDomainEnabled(session, "DOM");

    try {
      // Get the full DOM tree including iframe contents
      const { root } = await session.send<{ root: Protocol.DOM.Node }>(
        "DOM.getDocument",
        { depth: -1, pierce: true },
      );

      // Find a node that belongs to our target frame (not the IFRAME element itself)
      const frameDocNodeId = this.findFrameDocumentNodeId(root, frameId);

      if (!frameDocNodeId) {
        throw new Error(`Could not find document node for frame ${frameId}`);
      }

      // Resolve the node to get an objectId in the frame's context
      const { object } = await session.send<{ object: { objectId?: string } }>(
        "DOM.resolveNode",
        { nodeId: frameDocNodeId },
      );

      if (!object?.objectId) {
        throw new Error(`Could not resolve document for frame ${frameId}`);
      }

      // Parse the objectId to get the context ID
      const contextId = this.parseContextIdFromObjectId(object.objectId);
      if (contextId !== null) {
        this.register(session, frameId, contextId);
        return contextId;
      }
    } catch (e) {
      throw new Error(
        `Failed to get main world context for SPIF ${frameId}: ${e}`,
      );
    }

    throw new Error(`Could not parse contextId for frame ${frameId}`);
  }

  /**
   * Recursively find a node ID for a specific frame that we can use to get
   * into that frame's execution context via DOM.resolveNode.
   * 
   * Note: #document nodes don't have frameId set in CDP - the frameId is on
   * the HTML element inside the document. So we look for the HTML element
   * with the matching frameId.
   */
  private findFrameDocumentNodeId(
    node: Protocol.DOM.Node,
    targetFrameId: FrameId,
  ): Protocol.DOM.NodeId | null {
    // Check if this node has our target frameId
    // IMPORTANT: Skip IFRAME elements - they have the frameId but are in the PARENT frame's context
    // We need to find the HTML element INSIDE the iframe which is in the target frame's context
    if (
      node.frameId === targetFrameId &&
      node.nodeName !== "IFRAME" &&
      node.nodeName !== "FRAME"
    ) {
      // Return this node's ID - it belongs to the target frame's context
      return node.nodeId;
    }

    // Check children
    if (node.children) {
      for (const child of node.children) {
        const found = this.findFrameDocumentNodeId(child, targetFrameId);
        if (found !== null) return found;
      }
    }

    // Check shadow roots (for elements with shadow DOM)
    if (node.shadowRoots) {
      for (const shadowRoot of node.shadowRoots) {
        const found = this.findFrameDocumentNodeId(shadowRoot, targetFrameId);
        if (found !== null) return found;
      }
    }

    // Check contentDocument (for iframe elements) - this is where the actual frame content is
    if (node.contentDocument) {
      const found = this.findFrameDocumentNodeId(
        node.contentDocument,
        targetFrameId,
      );
      if (found !== null) return found;
    }

    return null;
  }

  /**
   * Parse execution context ID from an objectId string.
   * objectId format is like "1234567890.1.2" where the second segment is contextId.
   */
  private parseContextIdFromObjectId(objectId: string): ExecId | null {
    const parts = objectId.split(".");
    if (parts.length >= 2) {
      const contextId = parseInt(parts[1], 10);
      if (!isNaN(contextId)) {
        return contextId as ExecId;
      }
    }
    return null;
  }

  /**
   * @deprecated Use getMainWorldStealth instead. This method uses Runtime.enable which is detectable.
   */
  async waitForMainWorld(
    session: CDPSessionLike,
    frameId: FrameId,
    _timeoutMs: number = 800,
  ): Promise<ExecId> {
    // Redirect to stealth implementation
    return this.getMainWorldStealth(session, frameId);
  }

  /**
   * Get or create an isolated world for the given frame.
   * Isolated worlds share the DOM with main world but have separate JS globals,
   * making automation code invisible to page-level detection scripts.
   */
  async getOrCreateIsolatedWorld(
    session: CDPSessionLike,
    frameId: FrameId,
  ): Promise<ExecId> {
    // Return cached isolated world if available
    const existing = this.isolatedByFrame.get(session)?.get(frameId);
    if (existing !== undefined) {
      return existing;
    }

    // Ensure Page domain is enabled (needed for createIsolatedWorld)
    await this.ensureDomainEnabled(session, "Page");

    // Create the isolated world
    const { executionContextId } = await session.send<{
      executionContextId: number;
    }>("Page.createIsolatedWorld", {
      frameId,
      worldName: ISOLATED_WORLD_NAME,
      grantUniversalAccess: true,
    });

    // Cache it
    let map = this.isolatedByFrame.get(session);
    if (!map) {
      map = new Map<FrameId, ExecId>();
      this.isolatedByFrame.set(session, map);
    }
    map.set(frameId, executionContextId as ExecId);

    return executionContextId as ExecId;
  }

  /**
   * Get the cached isolated world for a frame, if one exists.
   * Returns null if no isolated world has been created yet.
   */
  getIsolatedWorld(session: CDPSessionLike, frameId: FrameId): ExecId | null {
    return this.isolatedByFrame.get(session)?.get(frameId) ?? null;
  }

  /**
   * Ensure a CDP domain is enabled for the session.
   * Tracks enabled state to avoid redundant enable calls (reduces detection surface).
   * 
   * IMPORTANT: Runtime.enable is SKIPPED for stealth - it's the biggest detection vector.
   * Instead, we use Runtime.evaluate + objectId parsing to get context IDs (Patchright approach).
   */
  async ensureDomainEnabled(
    session: CDPSessionLike,
    domain: string,
  ): Promise<void> {
    // CRITICAL STEALTH: Never enable Runtime domain - it's highly detectable
    // We use Runtime.evaluate + objectId parsing instead (Patchright approach)
    if (domain === "Runtime") {
      return; // Intentionally skip - use getMainWorldStealth/getOrCreateIsolatedWorld instead
    }

    let domains = this.enabledDomains.get(session);
    if (!domains) {
      domains = new Set<string>();
      this.enabledDomains.set(session, domains);
    }

    if (domains.has(domain)) {
      return; // Already enabled
    }

    await session.send(`${domain}.enable`).catch(() => {});
    domains.add(domain);
  }

  /**
   * Check if a domain is currently enabled for the session.
   */
  isDomainEnabled(session: CDPSessionLike, domain: string): boolean {
    return this.enabledDomains.get(session)?.has(domain) ?? false;
  }

  private register(
    session: CDPSessionLike,
    frameId: FrameId,
    ctxId: ExecId,
  ): void {
    let fwd = this.byFrame.get(session);
    if (!fwd) {
      fwd = new Map<FrameId, ExecId>();
      this.byFrame.set(session, fwd);
    }
    let rev = this.byExec.get(session);
    if (!rev) {
      rev = new Map<ExecId, FrameId>();
      this.byExec.set(session, rev);
    }
    fwd.set(frameId, ctxId);
    rev.set(ctxId, frameId);
  }
}

export const executionContexts = new ExecutionContextRegistry();
