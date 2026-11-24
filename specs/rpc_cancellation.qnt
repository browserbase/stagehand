module rpc_cancellation {
  type ReqId = int

  type TransportState =
    | Connected
    | ClientReleased
    | Closed

  type CancelReason =
    | Timeout
    | Cancelled

  type SettlementOutcome =
    | Unallocated
    | Pending
    | Resolved
    | RejectedRpcError
    | RejectedDispatch
    | RejectedTimeout
    | RejectedCancel
    | RejectedClientReleased
    | RejectedClose

  type WireRequest = {
    id: ReqId,
  }

  type WireResponse = {
    id: ReqId,
    ok: bool,
  }

  type WireCancel = {
    id: ReqId,
    reason: CancelReason,
  }

  // Bounded pool of request IDs for tractable simulation & Apalache model checking.
  pure val REQ_IDS: Set[ReqId] = Set(1, 2, 3)

  var transport: TransportState
  var allocated: Set[ReqId]
  var callerPending: Set[ReqId]
  var dispatchInFlight: Set[ReqId]
  var dispatched: Set[ReqId]
  var deadlineExpired: Set[ReqId]
  var abortedLocal: Set[ReqId]
  var cancelSent: Set[ReqId]
  var settlementCount: ReqId -> int
  var settlementOutcome: ReqId -> SettlementOutcome
  var wireReq: Set[WireRequest]
  var wireResp: Set[WireResponse]
  var wireCancel: Set[WireCancel]
  var serverSeen: Set[ReqId]
  var serverActive: Set[ReqId]
  var serverCancelled: Set[ReqId]
  var serverResponded: Set[ReqId]

  action init = all {
    transport' = Connected,
    allocated' = Set(),
    callerPending' = Set(),
    dispatchInFlight' = Set(),
    dispatched' = Set(),
    deadlineExpired' = Set(),
    abortedLocal' = Set(),
    cancelSent' = Set(),
    settlementCount' = REQ_IDS.mapBy(_ => 0),
    settlementOutcome' = REQ_IDS.mapBy(_ => Unallocated),
    wireReq' = Set(),
    wireResp' = Set(),
    wireCancel' = Set(),
    serverSeen' = Set(),
    serverActive' = Set(),
    serverCancelled' = Set(),
    serverResponded' = Set(),
  }

  action startRequest(id: ReqId): bool = all {
    transport == Connected,
    id.in(REQ_IDS),
    not(id.in(allocated)),
    allocated' = allocated.union(Set(id)),
    callerPending' = callerPending.union(Set(id)),
    dispatchInFlight' = dispatchInFlight.union(Set(id)),
    settlementOutcome' = settlementOutcome.put(id, Pending),
    transport' = transport,
    dispatched' = dispatched,
    deadlineExpired' = deadlineExpired,
    abortedLocal' = abortedLocal,
    cancelSent' = cancelSent,
    settlementCount' = settlementCount,
    wireReq' = wireReq,
    wireResp' = wireResp,
    wireCancel' = wireCancel,
    serverSeen' = serverSeen,
    serverActive' = serverActive,
    serverCancelled' = serverCancelled,
    serverResponded' = serverResponded,
  }

  action completeDispatch(id: ReqId): bool = {
    val wasAborted = id.in(abortedLocal)
    val cancelReason = if (id.in(deadlineExpired)) Timeout else Cancelled
    all {
      transport != Closed,
      id.in(dispatchInFlight),
      dispatchInFlight' = dispatchInFlight.exclude(Set(id)),
      dispatched' = dispatched.union(Set(id)),
      wireReq' = wireReq.union(Set({ id: id })),
      cancelSent' = if (wasAborted) cancelSent.union(Set(id)) else cancelSent,
      wireCancel' = if (wasAborted)
        wireCancel.union(Set({ id: id, reason: cancelReason }))
      else
        wireCancel,
      transport' = transport,
      allocated' = allocated,
      callerPending' = callerPending,
      deadlineExpired' = deadlineExpired,
      abortedLocal' = abortedLocal,
      settlementCount' = settlementCount,
      settlementOutcome' = settlementOutcome,
      wireResp' = wireResp,
      serverSeen' = serverSeen,
      serverActive' = serverActive,
      serverCancelled' = serverCancelled,
      serverResponded' = serverResponded,
    }
  }

  action failDispatch(id: ReqId): bool = {
    val stillPending = id.in(callerPending)
    all {
      transport != Closed,
      id.in(dispatchInFlight),
      dispatchInFlight' = dispatchInFlight.exclude(Set(id)),
      callerPending' = callerPending.exclude(Set(id)),
      settlementCount' = if (stillPending)
        settlementCount.put(id, settlementCount.get(id) + 1)
      else
        settlementCount,
      settlementOutcome' = if (stillPending)
        settlementOutcome.put(id, RejectedDispatch)
      else
        settlementOutcome,
      transport' = transport,
      allocated' = allocated,
      dispatched' = dispatched,
      deadlineExpired' = deadlineExpired,
      abortedLocal' = abortedLocal,
      cancelSent' = cancelSent,
      wireReq' = wireReq,
      wireResp' = wireResp,
      wireCancel' = wireCancel,
      serverSeen' = serverSeen,
      serverActive' = serverActive,
      serverCancelled' = serverCancelled,
      serverResponded' = serverResponded,
    }
  }

  action deliverRequest(req: WireRequest): bool = all {
    transport != Closed,
    req.in(wireReq),
    wireReq' = wireReq.exclude(Set(req)),
    serverSeen' = serverSeen.union(Set(req.id)),
    serverActive' = serverActive.union(Set(req.id)),
    transport' = transport,
    allocated' = allocated,
    callerPending' = callerPending,
    dispatchInFlight' = dispatchInFlight,
    dispatched' = dispatched,
    deadlineExpired' = deadlineExpired,
    abortedLocal' = abortedLocal,
    cancelSent' = cancelSent,
    settlementCount' = settlementCount,
    settlementOutcome' = settlementOutcome,
    wireResp' = wireResp,
    wireCancel' = wireCancel,
    serverCancelled' = serverCancelled,
    serverResponded' = serverResponded,
  }

  action serverRespond(id: ReqId, ok: bool): bool = all {
    transport != Closed,
    id.in(serverActive),
    serverActive' = serverActive.exclude(Set(id)),
    serverResponded' = serverResponded.union(Set(id)),
    wireResp' = wireResp.union(Set({ id: id, ok: ok })),
    transport' = transport,
    allocated' = allocated,
    callerPending' = callerPending,
    dispatchInFlight' = dispatchInFlight,
    dispatched' = dispatched,
    deadlineExpired' = deadlineExpired,
    abortedLocal' = abortedLocal,
    cancelSent' = cancelSent,
    settlementCount' = settlementCount,
    settlementOutcome' = settlementOutcome,
    wireReq' = wireReq,
    wireCancel' = wireCancel,
    serverSeen' = serverSeen,
    serverCancelled' = serverCancelled,
  }

  action deliverResponse(resp: WireResponse): bool = {
    val stillPending = resp.id.in(callerPending)
    val nextOutcome = if (resp.ok) Resolved else RejectedRpcError
    all {
      transport != Closed,
      resp.in(wireResp),
      wireResp' = wireResp.exclude(Set(resp)),
      callerPending' = callerPending.exclude(Set(resp.id)),
      settlementCount' = if (stillPending)
        settlementCount.put(resp.id, settlementCount.get(resp.id) + 1)
      else
        settlementCount,
      settlementOutcome' = if (stillPending)
        settlementOutcome.put(resp.id, nextOutcome)
      else
        settlementOutcome,
      transport' = transport,
      allocated' = allocated,
      dispatchInFlight' = dispatchInFlight,
      dispatched' = dispatched,
      deadlineExpired' = deadlineExpired,
      abortedLocal' = abortedLocal,
      cancelSent' = cancelSent,
      wireReq' = wireReq,
      wireCancel' = wireCancel,
      serverSeen' = serverSeen,
      serverActive' = serverActive,
      serverCancelled' = serverCancelled,
      serverResponded' = serverResponded,
    }
  }

  action progressDeadlineExpires(id: ReqId): bool = {
    val alreadyDispatched = id.in(dispatched)
    all {
      transport != Closed,
      id.in(callerPending),
      callerPending' = callerPending.exclude(Set(id)),
      deadlineExpired' = deadlineExpired.union(Set(id)),
      abortedLocal' = abortedLocal.union(Set(id)),
      settlementCount' = settlementCount.put(id, settlementCount.get(id) + 1),
      settlementOutcome' = settlementOutcome.put(id, RejectedTimeout),
      cancelSent' = if (alreadyDispatched) cancelSent.union(Set(id)) else cancelSent,
      wireCancel' = if (alreadyDispatched)
        wireCancel.union(Set({ id: id, reason: Timeout }))
      else
        wireCancel,
      transport' = transport,
      allocated' = allocated,
      dispatchInFlight' = dispatchInFlight,
      dispatched' = dispatched,
      wireReq' = wireReq,
      wireResp' = wireResp,
      serverSeen' = serverSeen,
      serverActive' = serverActive,
      serverCancelled' = serverCancelled,
      serverResponded' = serverResponded,
    }
  }

  action explicitCancel(id: ReqId): bool = {
    val alreadyDispatched = id.in(dispatched)
    all {
      transport != Closed,
      id.in(callerPending),
      callerPending' = callerPending.exclude(Set(id)),
      abortedLocal' = abortedLocal.union(Set(id)),
      settlementCount' = settlementCount.put(id, settlementCount.get(id) + 1),
      settlementOutcome' = settlementOutcome.put(id, RejectedCancel),
      cancelSent' = if (alreadyDispatched) cancelSent.union(Set(id)) else cancelSent,
      wireCancel' = if (alreadyDispatched)
        wireCancel.union(Set({ id: id, reason: Cancelled }))
      else
        wireCancel,
      transport' = transport,
      allocated' = allocated,
      dispatchInFlight' = dispatchInFlight,
      dispatched' = dispatched,
      deadlineExpired' = deadlineExpired,
      wireReq' = wireReq,
      wireResp' = wireResp,
      serverSeen' = serverSeen,
      serverActive' = serverActive,
      serverCancelled' = serverCancelled,
      serverResponded' = serverResponded,
    }
  }

  action deliverCancel(c: WireCancel): bool = all {
    transport != Closed,
    c.in(wireCancel),
    c.id.in(serverSeen),
    wireCancel' = wireCancel.exclude(Set(c)),
    serverActive' = serverActive.exclude(Set(c.id)),
    serverCancelled' = serverCancelled.union(Set(c.id)),
    transport' = transport,
    allocated' = allocated,
    callerPending' = callerPending,
    dispatchInFlight' = dispatchInFlight,
    dispatched' = dispatched,
    deadlineExpired' = deadlineExpired,
    abortedLocal' = abortedLocal,
    cancelSent' = cancelSent,
    settlementCount' = settlementCount,
    settlementOutcome' = settlementOutcome,
    wireReq' = wireReq,
    wireResp' = wireResp,
    serverSeen' = serverSeen,
    serverResponded' = serverResponded,
  }

  action releaseClient: bool = all {
    transport == Connected,
    transport' = ClientReleased,
    settlementCount' = REQ_IDS.mapBy(id =>
      if (id.in(callerPending)) settlementCount.get(id) + 1 else settlementCount.get(id)
    ),
    settlementOutcome' = REQ_IDS.mapBy(id =>
      if (id.in(callerPending)) RejectedClientReleased else settlementOutcome.get(id)
    ),
    callerPending' = Set(),
    allocated' = allocated,
    dispatchInFlight' = dispatchInFlight,
    dispatched' = dispatched,
    deadlineExpired' = deadlineExpired,
    abortedLocal' = abortedLocal,
    cancelSent' = cancelSent,
    wireReq' = wireReq,
    wireResp' = wireResp,
    wireCancel' = wireCancel,
    serverSeen' = serverSeen,
    serverActive' = serverActive,
    serverCancelled' = serverCancelled,
    serverResponded' = serverResponded,
  }

  action acceptClient: bool = all {
    transport == ClientReleased,
    transport' = Connected,
    allocated' = allocated,
    callerPending' = callerPending,
    dispatchInFlight' = dispatchInFlight,
    dispatched' = dispatched,
    deadlineExpired' = deadlineExpired,
    abortedLocal' = abortedLocal,
    cancelSent' = cancelSent,
    settlementCount' = settlementCount,
    settlementOutcome' = settlementOutcome,
    wireReq' = wireReq,
    wireResp' = wireResp,
    wireCancel' = wireCancel,
    serverSeen' = serverSeen,
    serverActive' = serverActive,
    serverCancelled' = serverCancelled,
    serverResponded' = serverResponded,
  }

  action closeWebSocket: bool = all {
    transport != Closed,
    transport' = Closed,
    settlementCount' = REQ_IDS.mapBy(id =>
      if (id.in(callerPending)) settlementCount.get(id) + 1 else settlementCount.get(id)
    ),
    settlementOutcome' = REQ_IDS.mapBy(id =>
      if (id.in(callerPending)) RejectedClose else settlementOutcome.get(id)
    ),
    callerPending' = Set(),
    dispatchInFlight' = Set(),
    wireReq' = Set(),
    wireResp' = Set(),
    wireCancel' = Set(),
    serverCancelled' = serverCancelled.union(serverActive),
    serverActive' = Set(),
    allocated' = allocated,
    dispatched' = dispatched,
    deadlineExpired' = deadlineExpired,
    abortedLocal' = abortedLocal,
    cancelSent' = cancelSent,
    serverSeen' = serverSeen,
    serverResponded' = serverResponded,
  }

  action stutterClosed: bool = all {
    transport == Closed,
    transport' = transport,
    allocated' = allocated,
    callerPending' = callerPending,
    dispatchInFlight' = dispatchInFlight,
    dispatched' = dispatched,
    deadlineExpired' = deadlineExpired,
    abortedLocal' = abortedLocal,
    cancelSent' = cancelSent,
    settlementCount' = settlementCount,
    settlementOutcome' = settlementOutcome,
    wireReq' = wireReq,
    wireResp' = wireResp,
    wireCancel' = wireCancel,
    serverSeen' = serverSeen,
    serverActive' = serverActive,
    serverCancelled' = serverCancelled,
    serverResponded' = serverResponded,
  }

  action step = any {
    {
      val freeIds = REQ_IDS.exclude(allocated)
      all {
        freeIds != Set(),
        {
          nondet id = freeIds.oneOf()
          startRequest(id)
        },
      }
    },
    all {
      dispatchInFlight != Set(),
      {
        nondet id = dispatchInFlight.oneOf()
        any {
          completeDispatch(id),
          failDispatch(id),
        }
      },
    },
    all {
      wireReq != Set(),
      {
        nondet req = wireReq.oneOf()
        deliverRequest(req)
      },
    },
    all {
      serverActive != Set(),
      {
        nondet id = serverActive.oneOf()
        nondet ok = Set(true, false).oneOf()
        serverRespond(id, ok)
      },
    },
    all {
      wireResp != Set(),
      {
        nondet resp = wireResp.oneOf()
        deliverResponse(resp)
      },
    },
    all {
      callerPending != Set(),
      {
        nondet id = callerPending.oneOf()
        any {
          progressDeadlineExpires(id),
          explicitCancel(id),
        }
      },
    },
    {
      val deliverable = wireCancel.filter(c => c.id.in(serverSeen))
      all {
        deliverable != Set(),
        {
          nondet c = deliverable.oneOf()
          deliverCancel(c)
        },
      }
    },
    releaseClient,
    acceptClient,
    closeWebSocket,
    stutterClosed,
  }

  val noOrphanedPendingAfterClose: bool =
    transport == Closed implies and {
      callerPending == Set(),
      serverActive == Set(),
      dispatchInFlight == Set(),
    }

  val exactOnceSettlement: bool = and {
    REQ_IDS.forall(id => settlementCount.get(id) <= 1),
    allocated.forall(id => id.in(callerPending) iff settlementCount.get(id) == 0),
    REQ_IDS.exclude(allocated).forall(id =>
      settlementCount.get(id) == 0 and not(id.in(callerPending))
    ),
  }

  val cancelDeliveredOnDeadline: bool =
    transport != Closed implies
      deadlineExpired.forall(id =>
        id.in(dispatched) implies (
          id.in(cancelSent) and (
            wireCancel.exists(c => c.id == id and c.reason == Timeout) or
            id.in(serverCancelled) or
            id.in(serverResponded)
          )
        )
      )

  val noDeadlock: bool = and {
    callerPending.forall(id =>
      transport == Connected and (
        id.in(dispatchInFlight) or
        wireReq.exists(r => r.id == id) or
        id.in(serverActive) or
        wireResp.exists(r => r.id == id)
      )
    ),
    serverActive.forall(id => transport != Closed and id.in(serverSeen)),
  }

  val allInvariants: bool = and {
    noOrphanedPendingAfterClose,
    exactOnceSettlement,
    cancelDeliveredOnDeadline,
    noDeadlock,
  }
}
