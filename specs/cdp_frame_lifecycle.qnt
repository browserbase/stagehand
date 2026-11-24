module cdp_frame_lifecycle {
  type FrameId = str
  type SessionId = str
  type ExecId = int
  type OpId = str

  type OpStatus =
    | OpIdle
    | OpRunning
    | OpReleasing

  type ExecContext = {
    execId: ExecId,
    session: SessionId,
    frame: FrameId,
    isDefault: bool,
  }

  type OpState = {
    status: OpStatus,
    session: SessionId,
    frame: FrameId,
    execId: ExecId,
    groupId: int,
  }

  type InFlightCmd = {
    op: OpId,
    session: SessionId,
    groupId: int,
    cmdId: int,
  }

  type RemoteHandle = {
    op: OpId,
    session: SessionId,
    groupId: int,
    handleId: int,
  }

  type TraceEvent = {
    kind: str,
    frameId: FrameId,
    parentId: FrameId,
    sessionId: SessionId,
    reason: str,
  }

  pure val NONE: str = ""
  pure val FRAME_IDS: Set[FrameId] = Set("f0", "f1", "f2", "f3")
  pure val SESSION_IDS: Set[SessionId] = Set("s_main", "s_oopif1", "s_oopif2")
  pure val EXEC_IDS: Set[ExecId] = Set(1, 2, 3, 4)
  pure val OP_IDS: Set[OpId] = Set("op1", "op2")

  var frames: Set[FrameId]
  var rootFrame: FrameId
  var parentOf: FrameId -> FrameId
  var childrenOf: FrameId -> Set[FrameId]
  var ownerSession: FrameId -> SessionId
  var framesBySession: SessionId -> Set[FrameId]
  var loaderGen: FrameId -> int
  var execCtxs: Set[ExecContext]
  var opState: OpId -> OpState
  var inFlightCmds: Set[InFlightCmd]
  var liveHandles: Set[RemoteHandle]
  var nextGroupId: int
  var nextCmdId: int
  var nextHandleId: int
  var lastAction: TraceEvent

  // Graph traversals are bounded to |FRAME_IDS| = 4 for Apalache compatibility.
  pure def stepParent(f: FrameId, pMap: FrameId -> FrameId): Set[FrameId] =
    if (f == NONE) Set()
    else {
      val p = pMap.get(f)
      if (p == NONE) Set() else Set(p)
    }

  pure def ancestors(f: FrameId, pMap: FrameId -> FrameId): Set[FrameId] = {
    val d1 = stepParent(f, pMap)
    val d2 = d1.fold(Set(), (acc, x) => acc.union(stepParent(x, pMap)))
    val d3 = d2.fold(Set(), (acc, x) => acc.union(stepParent(x, pMap)))
    val d4 = d3.fold(Set(), (acc, x) => acc.union(stepParent(x, pMap)))
    d1.union(d2).union(d3).union(d4)
  }

  pure def expandKids(nodes: Set[FrameId], cMap: FrameId -> Set[FrameId]): Set[FrameId] =
    nodes.fold(Set(), (acc, x) => acc.union(cMap.get(x)))

  pure def subtree(f: FrameId, cMap: FrameId -> Set[FrameId]): Set[FrameId] = {
    val l0 = Set(f)
    val l1 = expandKids(l0, cMap)
    val l2 = expandKids(l1, cMap)
    val l3 = expandKids(l2, cMap)
    l0.union(l1).union(l2).union(l3)
  }

  pure def updateFramesBySessionForOwner(
    f: FrameId,
    oldSess: SessionId,
    newSess: SessionId,
    bySess: SessionId -> Set[FrameId]
  ): SessionId -> Set[FrameId] =
    SESSION_IDS.mapBy(s => {
      val withoutOld = if (s == oldSess) bySess.get(s).exclude(Set(f)) else bySess.get(s)
      if (s == newSess and newSess != NONE) withoutOld.union(Set(f)) else withoutOld
    })

  pure def renameParentMap(
    oldId: FrameId,
    newId: FrameId,
    pMap: FrameId -> FrameId
  ): FrameId -> FrameId =
    FRAME_IDS.mapBy(f =>
      if (f == oldId) NONE
      else if (f == newId) pMap.get(oldId)
      else if (pMap.get(f) == oldId) newId
      else pMap.get(f)
    )

  pure def renameChildrenMap(
    oldId: FrameId,
    newId: FrameId,
    cMap: FrameId -> Set[FrameId]
  ): FrameId -> Set[FrameId] =
    FRAME_IDS.mapBy(f =>
      if (f == oldId) Set()
      else if (f == newId) cMap.get(oldId)
      else if (cMap.get(f).contains(oldId)) cMap.get(f).exclude(Set(oldId)).union(Set(newId))
      else cMap.get(f)
    )

  pure def renameOwnerMap(
    oldId: FrameId,
    newId: FrameId,
    newSess: SessionId,
    oMap: FrameId -> SessionId
  ): FrameId -> SessionId =
    FRAME_IDS.mapBy(f =>
      if (f == oldId) NONE
      else if (f == newId) newSess
      else oMap.get(f)
    )

  pure def renameBySessionMap(
    oldId: FrameId,
    newId: FrameId,
    oldSess: SessionId,
    newSess: SessionId,
    bySess: SessionId -> Set[FrameId]
  ): SessionId -> Set[FrameId] =
    SESSION_IDS.mapBy(s => {
      val cleaned = if (s == oldSess) bySess.get(s).exclude(Set(oldId)) else bySess.get(s)
      if (s == newSess and newSess != NONE) cleaned.union(Set(newId)) else cleaned
    })

  pure val IDLE_OP: OpState = {
    status: OpIdle,
    session: NONE,
    frame: NONE,
    execId: 0,
    groupId: 0,
  }

  action init = all {
    frames' = Set("f0"),
    rootFrame' = "f0",
    parentOf' = FRAME_IDS.mapBy(_ => NONE),
    childrenOf' = FRAME_IDS.mapBy(_ => Set()),
    ownerSession' = FRAME_IDS.mapBy(f => if (f == "f0") "s_main" else NONE),
    framesBySession' = SESSION_IDS.mapBy(s => if (s == "s_main") Set("f0") else Set()),
    loaderGen' = FRAME_IDS.mapBy(f => if (f == "f0") 1 else 0),
    execCtxs' = Set(),
    opState' = OP_IDS.mapBy(_ => IDLE_OP),
    inFlightCmds' = Set(),
    liveHandles' = Set(),
    nextGroupId' = 1,
    nextCmdId' = 1,
    nextHandleId' = 1,
    lastAction' = {
      kind: "init",
      frameId: "f0",
      parentId: NONE,
      sessionId: "s_main",
      reason: "",
    },
  }

  // In Chrome CDP, a root swap allocates a fresh frameId not already in the tree.
  action frameAttachedRootSwap(newRoot: FrameId, sessionId: SessionId): bool = {
    val oldRoot = rootFrame
    val oldSess = ownerSession.get(oldRoot)
    all {
      newRoot.in(FRAME_IDS),
      not(newRoot.in(frames)),
      sessionId.in(SESSION_IDS),
      frames' = frames.exclude(Set(oldRoot)).union(Set(newRoot)),
      rootFrame' = newRoot,
      parentOf' = renameParentMap(oldRoot, newRoot, parentOf),
      childrenOf' = renameChildrenMap(oldRoot, newRoot, childrenOf),
      ownerSession' = renameOwnerMap(oldRoot, newRoot, sessionId, ownerSession),
      framesBySession' = renameBySessionMap(oldRoot, newRoot, oldSess, sessionId, framesBySession),
      loaderGen' = loaderGen.put(oldRoot, 0).put(newRoot, loaderGen.get(oldRoot)),
      execCtxs' = execCtxs,
      opState' = opState,
      inFlightCmds' = inFlightCmds,
      liveHandles' = liveHandles,
      nextGroupId' = nextGroupId,
      nextCmdId' = nextCmdId,
      nextHandleId' = nextHandleId,
      lastAction' = {
        kind: "frameAttached",
        frameId: newRoot,
        parentId: NONE,
        sessionId: sessionId,
        reason: "",
      },
    }
  }

  // Chrome may deliver a grandchild frameAttached before its parent, creating a shell
  // parent node that is later wired beneath its own parent when that event arrives.
  action frameAttachedChild(fid: FrameId, pid: FrameId, sessionId: SessionId): bool = {
    val oldSess = ownerSession.get(fid)
    all {
      fid.in(FRAME_IDS),
      pid.in(FRAME_IDS),
      sessionId.in(SESSION_IDS),
      fid != pid,
      fid != rootFrame,
      not(fid.in(frames)) or (parentOf.get(fid) == NONE and not(pid.in(subtree(fid, childrenOf)))),
      frames' = frames.union(Set(fid, pid)),
      rootFrame' = rootFrame,
      parentOf' = parentOf.put(fid, pid),
      childrenOf' = childrenOf.put(pid, childrenOf.get(pid).union(Set(fid))),
      ownerSession' = ownerSession.put(fid, sessionId),
      framesBySession' = updateFramesBySessionForOwner(fid, oldSess, sessionId, framesBySession),
      loaderGen' = loaderGen,
      execCtxs' = execCtxs,
      opState' = opState,
      inFlightCmds' = inFlightCmds,
      liveHandles' = liveHandles,
      nextGroupId' = nextGroupId,
      nextCmdId' = nextCmdId,
      nextHandleId' = nextHandleId,
      lastAction' = {
        kind: "frameAttached",
        frameId: fid,
        parentId: pid,
        sessionId: sessionId,
        reason: "",
      },
    }
  }

  action frameNavigatedExisting(fid: FrameId, sessionId: SessionId): bool = {
    val oldSess = ownerSession.get(fid)
    all {
      fid.in(frames),
      sessionId.in(SESSION_IDS),
      // Non-root frames carry parentId in CDP; skip shell parents until their own frameAttached arrives.
      fid == rootFrame or parentOf.get(fid) != NONE,
      frames' = frames,
      rootFrame' = rootFrame,
      parentOf' = parentOf,
      childrenOf' = childrenOf,
      ownerSession' = ownerSession.put(fid, sessionId),
      framesBySession' = updateFramesBySessionForOwner(fid, oldSess, sessionId, framesBySession),
      loaderGen' = loaderGen.put(fid, loaderGen.get(fid) + 1),
      execCtxs' = execCtxs,
      opState' = opState,
      inFlightCmds' = inFlightCmds,
      liveHandles' = liveHandles,
      nextGroupId' = nextGroupId,
      nextCmdId' = nextCmdId,
      nextHandleId' = nextHandleId,
      lastAction' = {
        kind: "frameNavigated",
        frameId: fid,
        parentId: parentOf.get(fid),
        sessionId: sessionId,
        reason: "",
      },
    }
  }

  action frameNavigatedRootSwap(newRoot: FrameId): bool = {
    val oldRoot = rootFrame
    val sess = ownerSession.get(oldRoot)
    all {
      newRoot.in(FRAME_IDS),
      not(newRoot.in(frames)),
      sess != NONE,
      frames' = frames.exclude(Set(oldRoot)).union(Set(newRoot)),
      rootFrame' = newRoot,
      parentOf' = renameParentMap(oldRoot, newRoot, parentOf),
      childrenOf' = renameChildrenMap(oldRoot, newRoot, childrenOf),
      ownerSession' = renameOwnerMap(oldRoot, newRoot, sess, ownerSession),
      framesBySession' = renameBySessionMap(oldRoot, newRoot, sess, sess, framesBySession),
      loaderGen' = loaderGen.put(oldRoot, 0).put(newRoot, loaderGen.get(oldRoot) + 1),
      execCtxs' = execCtxs,
      opState' = opState,
      inFlightCmds' = inFlightCmds,
      liveHandles' = liveHandles,
      nextGroupId' = nextGroupId,
      nextCmdId' = nextCmdId,
      nextHandleId' = nextHandleId,
      lastAction' = {
        kind: "frameNavigated",
        frameId: newRoot,
        parentId: NONE,
        sessionId: sess,
        reason: "",
      },
    }
  }

  action frameDetachedRemove(fid: FrameId): bool = {
    val sub = subtree(fid, childrenOf)
    val p = parentOf.get(fid)
    all {
      fid.in(frames),
      fid != rootFrame,
      frames' = frames.exclude(sub),
      rootFrame' = rootFrame,
      parentOf' = FRAME_IDS.mapBy(f => if (f.in(sub)) NONE else parentOf.get(f)),
      childrenOf' = FRAME_IDS.mapBy(f =>
        if (f.in(sub)) Set()
        else if (f == p) childrenOf.get(f).exclude(Set(fid))
        else childrenOf.get(f)
      ),
      ownerSession' = FRAME_IDS.mapBy(f => if (f.in(sub)) NONE else ownerSession.get(f)),
      framesBySession' = SESSION_IDS.mapBy(s => framesBySession.get(s).exclude(sub)),
      loaderGen' = FRAME_IDS.mapBy(f => if (f.in(sub)) 0 else loaderGen.get(f)),
      execCtxs' = execCtxs,
      opState' = opState,
      inFlightCmds' = inFlightCmds,
      liveHandles' = liveHandles,
      nextGroupId' = nextGroupId,
      nextCmdId' = nextCmdId,
      nextHandleId' = nextHandleId,
      lastAction' = {
        kind: "frameDetached",
        frameId: fid,
        parentId: NONE,
        sessionId: NONE,
        reason: "remove",
      },
    }
  }

  action frameDetachedSwap(fid: FrameId): bool = all {
    fid.in(frames),
    frames' = frames,
    rootFrame' = rootFrame,
    parentOf' = parentOf,
    childrenOf' = childrenOf,
    ownerSession' = ownerSession,
    framesBySession' = framesBySession,
    loaderGen' = loaderGen,
    execCtxs' = execCtxs,
    opState' = opState,
    inFlightCmds' = inFlightCmds,
    liveHandles' = liveHandles,
    nextGroupId' = nextGroupId,
    nextCmdId' = nextCmdId,
    nextHandleId' = nextHandleId,
    lastAction' = {
      kind: "frameDetached",
      frameId: fid,
      parentId: NONE,
      sessionId: NONE,
      reason: "swap",
    },
  }

  action adoptChildSession(childSessionId: SessionId, childFrameId: FrameId): bool = {
    val oldSess = ownerSession.get(childFrameId)
    all {
      childFrameId.in(frames),
      childFrameId != rootFrame,
      childSessionId.in(SESSION_IDS),
      childSessionId != oldSess,
      frames' = frames,
      rootFrame' = rootFrame,
      parentOf' = parentOf,
      childrenOf' = childrenOf,
      ownerSession' = ownerSession.put(childFrameId, childSessionId),
      framesBySession' = updateFramesBySessionForOwner(
        childFrameId, oldSess, childSessionId, framesBySession
      ),
      loaderGen' = loaderGen,
      execCtxs' = execCtxs,
      opState' = opState,
      inFlightCmds' = inFlightCmds,
      liveHandles' = liveHandles,
      nextGroupId' = nextGroupId,
      nextCmdId' = nextCmdId,
      nextHandleId' = nextHandleId,
      lastAction' = {
        kind: "adoptChildSession",
        frameId: childFrameId,
        parentId: NONE,
        sessionId: childSessionId,
        reason: "",
      },
    }
  }

  action execContextCreated(
    execId: ExecId,
    sessionId: SessionId,
    frameId: FrameId,
    isDefault: bool
  ): bool = all {
    execId.in(EXEC_IDS),
    frameId.in(frames),
    ownerSession.get(frameId) == sessionId,
    not(execCtxs.exists(c => c.session == sessionId and c.execId == execId)),
    execCtxs' = execCtxs.union(Set({
      execId: execId,
      session: sessionId,
      frame: frameId,
      isDefault: isDefault,
    })),
    frames' = frames,
    rootFrame' = rootFrame,
    parentOf' = parentOf,
    childrenOf' = childrenOf,
    ownerSession' = ownerSession,
    framesBySession' = framesBySession,
    loaderGen' = loaderGen,
    opState' = opState,
    inFlightCmds' = inFlightCmds,
    liveHandles' = liveHandles,
    nextGroupId' = nextGroupId,
    nextCmdId' = nextCmdId,
    nextHandleId' = nextHandleId,
    lastAction' = {
      kind: "execCreated",
      frameId: frameId,
      parentId: NONE,
      sessionId: sessionId,
      reason: "",
    },
  }

  action execContextDestroyed(ctx: ExecContext): bool = all {
    ctx.in(execCtxs),
    execCtxs' = execCtxs.exclude(Set(ctx)),
    frames' = frames,
    rootFrame' = rootFrame,
    parentOf' = parentOf,
    childrenOf' = childrenOf,
    ownerSession' = ownerSession,
    framesBySession' = framesBySession,
    loaderGen' = loaderGen,
    opState' = opState,
    inFlightCmds' = inFlightCmds,
    liveHandles' = liveHandles,
    nextGroupId' = nextGroupId,
    nextCmdId' = nextCmdId,
    nextHandleId' = nextHandleId,
    lastAction' = {
      kind: "execDestroyed",
      frameId: ctx.frame,
      parentId: NONE,
      sessionId: ctx.session,
      reason: "",
    },
  }

  action execContextsCleared(sessionId: SessionId): bool = all {
    sessionId.in(SESSION_IDS),
    execCtxs.exists(c => c.session == sessionId),
    execCtxs' = execCtxs.filter(c => c.session != sessionId),
    frames' = frames,
    rootFrame' = rootFrame,
    parentOf' = parentOf,
    childrenOf' = childrenOf,
    ownerSession' = ownerSession,
    framesBySession' = framesBySession,
    loaderGen' = loaderGen,
    opState' = opState,
    inFlightCmds' = inFlightCmds,
    liveHandles' = liveHandles,
    nextGroupId' = nextGroupId,
    nextCmdId' = nextCmdId,
    nextHandleId' = nextHandleId,
    lastAction' = {
      kind: "execCleared",
      frameId: NONE,
      parentId: NONE,
      sessionId: sessionId,
      reason: "",
    },
  }

  // Operations pin (session, frameId, execId, objectGroup) up front; commands and
  // Runtime.releaseObjectGroup stay on the captured session even across OOPIF adoption.
  action opStart(opId: OpId, ctx: ExecContext): bool = all {
    opId.in(OP_IDS),
    opState.get(opId).status == OpIdle,
    ctx.in(execCtxs),
    ctx.frame.in(frames),
    ownerSession.get(ctx.frame) == ctx.session,
    opState' = opState.put(opId, {
      status: OpRunning,
      session: ctx.session,
      frame: ctx.frame,
      execId: ctx.execId,
      groupId: nextGroupId,
    }),
    nextGroupId' = nextGroupId + 1,
    frames' = frames,
    rootFrame' = rootFrame,
    parentOf' = parentOf,
    childrenOf' = childrenOf,
    ownerSession' = ownerSession,
    framesBySession' = framesBySession,
    loaderGen' = loaderGen,
    execCtxs' = execCtxs,
    inFlightCmds' = inFlightCmds,
    liveHandles' = liveHandles,
    nextCmdId' = nextCmdId,
    nextHandleId' = nextHandleId,
    lastAction' = {
      kind: "opStart",
      frameId: ctx.frame,
      parentId: NONE,
      sessionId: ctx.session,
      reason: opId,
    },
  }

  action opDispatchCmd(opId: OpId): bool = {
    val op = opState.get(opId)
    all {
      opId.in(OP_IDS),
      op.status == OpRunning,
      inFlightCmds.filter(c => c.op == opId).size() < 2,
      inFlightCmds' = inFlightCmds.union(Set({
        op: opId,
        session: op.session,
        groupId: op.groupId,
        cmdId: nextCmdId,
      })),
      nextCmdId' = nextCmdId + 1,
      frames' = frames,
      rootFrame' = rootFrame,
      parentOf' = parentOf,
      childrenOf' = childrenOf,
      ownerSession' = ownerSession,
      framesBySession' = framesBySession,
      loaderGen' = loaderGen,
      execCtxs' = execCtxs,
      opState' = opState,
      liveHandles' = liveHandles,
      nextGroupId' = nextGroupId,
      nextHandleId' = nextHandleId,
      lastAction' = {
        kind: "opDispatchCmd",
        frameId: op.frame,
        parentId: NONE,
        sessionId: op.session,
        reason: opId,
      },
    }
  }

  action opCmdReply(cmd: InFlightCmd): bool = {
    val op = opState.get(cmd.op)
    all {
      cmd.in(inFlightCmds),
      op.status == OpRunning,
      inFlightCmds' = inFlightCmds.exclude(Set(cmd)),
      liveHandles' = liveHandles.union(Set({
        op: cmd.op,
        session: cmd.session,
        groupId: cmd.groupId,
        handleId: nextHandleId,
      })),
      nextHandleId' = nextHandleId + 1,
      frames' = frames,
      rootFrame' = rootFrame,
      parentOf' = parentOf,
      childrenOf' = childrenOf,
      ownerSession' = ownerSession,
      framesBySession' = framesBySession,
      loaderGen' = loaderGen,
      execCtxs' = execCtxs,
      opState' = opState,
      nextGroupId' = nextGroupId,
      nextCmdId' = nextCmdId,
      lastAction' = {
        kind: "opCmdReply",
        frameId: op.frame,
        parentId: NONE,
        sessionId: cmd.session,
        reason: cmd.op,
      },
    }
  }

  action opBeginFinish(opId: OpId): bool = {
    val op = opState.get(opId)
    all {
      opId.in(OP_IDS),
      op.status == OpRunning,
      opState' = opState.put(opId, { ...op, status: OpReleasing }),
      liveHandles' = liveHandles.filter(h => not(
        h.session == op.session and h.groupId == op.groupId
      )),
      frames' = frames,
      rootFrame' = rootFrame,
      parentOf' = parentOf,
      childrenOf' = childrenOf,
      ownerSession' = ownerSession,
      framesBySession' = framesBySession,
      loaderGen' = loaderGen,
      execCtxs' = execCtxs,
      inFlightCmds' = inFlightCmds,
      nextGroupId' = nextGroupId,
      nextCmdId' = nextCmdId,
      nextHandleId' = nextHandleId,
      lastAction' = {
        kind: "opBeginFinish",
        frameId: op.frame,
        parentId: NONE,
        sessionId: op.session,
        reason: opId,
      },
    }
  }

  action opLateCmdReply(cmd: InFlightCmd): bool = {
    val op = opState.get(cmd.op)
    all {
      cmd.in(inFlightCmds),
      op.status == OpReleasing,
      inFlightCmds' = inFlightCmds.exclude(Set(cmd)),
      liveHandles' = liveHandles.union(Set({
        op: cmd.op,
        session: cmd.session,
        groupId: cmd.groupId,
        handleId: nextHandleId,
      })),
      nextHandleId' = nextHandleId + 1,
      frames' = frames,
      rootFrame' = rootFrame,
      parentOf' = parentOf,
      childrenOf' = childrenOf,
      ownerSession' = ownerSession,
      framesBySession' = framesBySession,
      loaderGen' = loaderGen,
      execCtxs' = execCtxs,
      opState' = opState,
      nextGroupId' = nextGroupId,
      nextCmdId' = nextCmdId,
      lastAction' = {
        kind: "opLateCmdReply",
        frameId: op.frame,
        parentId: NONE,
        sessionId: cmd.session,
        reason: cmd.op,
      },
    }
  }

  action opReleaseAndIdle(opId: OpId): bool = {
    val op = opState.get(opId)
    all {
      opId.in(OP_IDS),
      op.status == OpReleasing,
      not(inFlightCmds.exists(c => c.op == opId)),
      liveHandles' = liveHandles.filter(h => not(
        h.session == op.session and h.groupId == op.groupId
      )),
      opState' = opState.put(opId, IDLE_OP),
      frames' = frames,
      rootFrame' = rootFrame,
      parentOf' = parentOf,
      childrenOf' = childrenOf,
      ownerSession' = ownerSession,
      framesBySession' = framesBySession,
      loaderGen' = loaderGen,
      execCtxs' = execCtxs,
      inFlightCmds' = inFlightCmds,
      nextGroupId' = nextGroupId,
      nextCmdId' = nextCmdId,
      nextHandleId' = nextHandleId,
      lastAction' = {
        kind: "opReleaseAndIdle",
        frameId: op.frame,
        parentId: NONE,
        sessionId: op.session,
        reason: opId,
      },
    }
  }

  action execStep = any {
    all {
      frames != Set(),
      {
        nondet fid = frames.oneOf()
        nondet execId = EXEC_IDS.oneOf()
        nondet isDef = Set(true, false).oneOf()
        val sess = ownerSession.get(fid)
        all {
          sess != NONE,
          execContextCreated(execId, sess, fid, isDef),
        }
      },
    },
    all {
      execCtxs != Set(),
      {
        nondet ctx = execCtxs.oneOf()
        execContextDestroyed(ctx)
      },
    },
    {
      nondet sess = SESSION_IDS.oneOf()
      execContextsCleared(sess)
    },
  }

  action handleStep = any {
    all {
      execCtxs != Set(),
      {
        nondet opId = OP_IDS.oneOf()
        nondet ctx = execCtxs.oneOf()
        opStart(opId, ctx)
      },
    },
    {
      nondet opId = OP_IDS.oneOf()
      opDispatchCmd(opId)
    },
    all {
      inFlightCmds != Set(),
      {
        nondet cmd = inFlightCmds.oneOf()
        any {
          opCmdReply(cmd),
          opLateCmdReply(cmd),
        }
      },
    },
    {
      nondet opId = OP_IDS.oneOf()
      opBeginFinish(opId)
    },
    {
      nondet opId = OP_IDS.oneOf()
      opReleaseAndIdle(opId)
    },
  }

  action step = any {
    {
      val fresh = FRAME_IDS.exclude(frames)
      all {
        fresh != Set(),
        {
          nondet newRoot = fresh.oneOf()
          nondet sess = SESSION_IDS.oneOf()
          frameAttachedRootSwap(newRoot, sess)
        },
      }
    },
    {
      nondet fid = FRAME_IDS.oneOf()
      nondet pid = FRAME_IDS.oneOf()
      nondet sess = SESSION_IDS.oneOf()
      frameAttachedChild(fid, pid, sess)
    },
    all {
      frames != Set(),
      {
        nondet fid = frames.oneOf()
        nondet sess = SESSION_IDS.oneOf()
        frameNavigatedExisting(fid, sess)
      },
    },
    {
      val fresh = FRAME_IDS.exclude(frames)
      all {
        fresh != Set(),
        {
          nondet newRoot = fresh.oneOf()
          frameNavigatedRootSwap(newRoot)
        },
      }
    },
    {
      val detachable = frames.exclude(Set(rootFrame))
      all {
        detachable != Set(),
        {
          nondet fid = detachable.oneOf()
          frameDetachedRemove(fid)
        },
      }
    },
    all {
      frames != Set(),
      {
        nondet fid = frames.oneOf()
        frameDetachedSwap(fid)
      },
    },
    {
      val nonRoot = frames.exclude(Set(rootFrame))
      all {
        nonRoot != Set(),
        {
          nondet fid = nonRoot.oneOf()
          nondet sess = SESSION_IDS.oneOf()
          adoptChildSession(sess, fid)
        },
      }
    },
    execStep,
    handleStep,
  }

  val treeIsAcyclic: bool = and {
    rootFrame.in(frames),
    parentOf.get(rootFrame) == NONE,
    frames.forall(f => not(f.in(ancestors(f, parentOf)))),
    FRAME_IDS.forall(f => not(childrenOf.get(f).contains(f))),
  }

  val parentChildSymmetric: bool = and {
    frames.forall(f =>
      parentOf.get(f) == NONE or parentOf.get(f).in(frames)
    ),
    frames.forall(f => childrenOf.get(f).subseteq(frames)),
    FRAME_IDS.exclude(frames).forall(f =>
      parentOf.get(f) == NONE and childrenOf.get(f) == Set()
    ),
    frames.forall(p =>
      frames.forall(c =>
        childrenOf.get(p).contains(c) iff parentOf.get(c) == p
      )
    ),
  }

  val sessionMapBijective: bool = and {
    SESSION_IDS.forall(s =>
      FRAME_IDS.forall(f =>
        framesBySession.get(s).contains(f) iff (f.in(frames) and ownerSession.get(f) == s)
      )
    ),
    FRAME_IDS.exclude(frames).forall(f => ownerSession.get(f) == NONE),
  }

  val noCrossSessionHandleMix: bool = and {
    liveHandles.forall(h =>
      opState.get(h.op).status != OpIdle and
      h.session == opState.get(h.op).session and
      h.groupId == opState.get(h.op).groupId
    ),
    inFlightCmds.forall(c =>
      opState.get(c.op).status != OpIdle and
      c.session == opState.get(c.op).session and
      c.groupId == opState.get(c.op).groupId
    ),
    liveHandles.forall(h1 =>
      liveHandles.forall(h2 =>
        (h1.op == h2.op) implies (h1.session == h2.session and h1.groupId == h2.groupId)
      )
    ),
  }

  val noLeakedHandlesWhenIdle: bool =
    OP_IDS.forall(opId =>
      opState.get(opId).status == OpIdle implies and {
        not(liveHandles.exists(h => h.op == opId)),
        not(inFlightCmds.exists(c => c.op == opId)),
      }
    )

  val allInvariants: bool = and {
    treeIsAcyclic,
    parentChildSymmetric,
    sessionMapBijective,
    noCrossSessionHandleMix,
    noLeakedHandlesWhenIdle,
  }
}
