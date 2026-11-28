namespace StagehandProofs.RpcCancellation

abbrev ReqId := Nat

inductive Outcome where
  | resolved
  | rejectedError
  | rejectedTimeout
  | rejectedAbort
  | rejectedDisconnected
  | rejectedDispatchFailed
  deriving DecidableEq, Repr

inductive DispatchState where
  | inFlight
  | dispatched
  | dispatchFailed
  deriving DecidableEq, Repr

structure ClientReq where
  dispatch : DispatchState
  aborted : Bool
  cancelNotified : Bool
  deriving DecidableEq, Repr

inductive ServerReqState where
  | active
  | aborted
  | completed
  deriving DecidableEq, Repr

structure RpcState where
  nextId : ReqId
  closed : Bool
  clientConnected : Bool
  pending : List (ReqId × ClientReq)
  inFlight : List (ReqId × Bool)
  settled : List (ReqId × Outcome)
  settlementCount : ReqId → Nat
  cancelQueue : List ReqId
  serverActive : List (ReqId × ServerReqState)
  serverDisposed : Bool

inductive RpcEvent where
  | clientSend (preAborted : Bool)
  | dispatchSuccess (id : ReqId)
  | dispatchFail (id : ReqId)
  | clientAbort (id : ReqId) (isTimeout : Bool)
  | dropCancel (id : ReqId)
  | serverReceiveRequest (id : ReqId)
  | serverReceiveCancel (id : ReqId)
  | serverRespond (id : ReqId) (isError : Bool)
  | releaseClient
  | acceptClient
  | serverDispose
  | transportClose
  deriving DecidableEq, Repr

def initState : RpcState where
  nextId := 1
  closed := false
  clientConnected := true
  pending := []
  inFlight := []
  settled := []
  settlementCount := fun _ => 0
  cancelQueue := []
  serverActive := []
  serverDisposed := false

def lookupAssoc {α : Type} (id : ReqId) : List (ReqId × α) → Option α
  | [] => none
  | (k, v) :: rest => if k == id then some v else lookupAssoc id rest

def hasKey {α : Type} (xs : List (ReqId × α)) (id : ReqId) : Bool :=
  (lookupAssoc id xs).isSome

def removeKey {α : Type} (id : ReqId) : List (ReqId × α) → List (ReqId × α)
  | [] => []
  | (k, v) :: rest => if k == id then removeKey id rest else (k, v) :: removeKey id rest

def updateKey {α : Type} (id : ReqId) (f : α → α) : List (ReqId × α) → List (ReqId × α)
  | [] => []
  | (k, v) :: rest => if k == id then (k, f v) :: rest else (k, v) :: updateKey id f rest

def incCount (f : ReqId → Nat) (id : ReqId) : ReqId → Nat :=
  fun k => if k == id then f k + 1 else f k

def settleOne (s : RpcState) (id : ReqId) (out : Outcome) : RpcState :=
  match lookupAssoc id s.pending with
  | none => s
  | some _ =>
    { s with
      pending := removeKey id s.pending
      settled := (id, out) :: s.settled
      settlementCount := incCount s.settlementCount id }

def settleAllPending (out : Outcome) :
    List (ReqId × ClientReq) → List (ReqId × Outcome) → (ReqId → Nat) →
    (List (ReqId × Outcome) × (ReqId → Nat))
  | [], settled, counts => (settled, counts)
  | (id, _) :: rest, settled, counts =>
    settleAllPending out rest ((id, out) :: settled) (incCount counts id)

def removeFirst (id : ReqId) : List ReqId → List ReqId
  | [] => []
  | x :: xs => if x == id then xs else x :: removeFirst id xs

def step (s : RpcState) : RpcEvent → RpcState
  | .clientSend preAborted =>
    if s.closed || !s.clientConnected then
      s
    else if preAborted then
      s
    else
      let id := s.nextId
      { s with
        nextId := id + 1
        pending := (id, { dispatch := .inFlight, aborted := false, cancelNotified := false }) :: s.pending
        inFlight := (id, false) :: s.inFlight }
  | .dispatchSuccess id =>
    match lookupAssoc id s.inFlight with
    | none => s
    | some wasAborted =>
      { s with
        inFlight := removeKey id s.inFlight
        pending := updateKey id
          (fun req => { req with dispatch := .dispatched, cancelNotified := req.cancelNotified || (wasAborted && !s.closed) })
          s.pending
        cancelQueue := if wasAborted && !s.closed then id :: s.cancelQueue else s.cancelQueue }
  | .dispatchFail id =>
    match lookupAssoc id s.inFlight with
    | none => s
    | some _ =>
      settleOne { s with inFlight := removeKey id s.inFlight } id .rejectedDispatchFailed
  | .clientAbort id isTimeout =>
    match lookupAssoc id s.pending with
    | none => s
    | some req =>
      let out := if isTimeout then Outcome.rejectedTimeout else Outcome.rejectedAbort
      let s1 := settleOne s id out
      if req.dispatch == .dispatched && !s.closed then
        { s1 with cancelQueue := id :: s1.cancelQueue }
      else if req.dispatch == .inFlight then
        { s1 with inFlight := updateKey id (fun _ => true) s1.inFlight }
      else
        s1
  | .dropCancel id =>
    { s with cancelQueue := removeFirst id s.cancelQueue }
  | .serverReceiveRequest id =>
    if s.closed || s.serverDisposed || hasKey s.serverActive id then
      s
    else
      { s with serverActive := (id, .active) :: s.serverActive }
  | .serverReceiveCancel id =>
    { s with
      cancelQueue := removeFirst id s.cancelQueue
      serverActive := updateKey id (fun st => if st == .active then .aborted else st) s.serverActive }
  | .serverRespond id isError =>
    if s.closed then
      s
    else
      let s1 := { s with serverActive := removeKey id s.serverActive }
      let out := if isError then Outcome.rejectedError else Outcome.resolved
      settleOne s1 id out
  | .releaseClient =>
    let (settled', counts') := settleAllPending .rejectedDisconnected s.pending s.settled s.settlementCount
    { s with
      clientConnected := false
      pending := []
      settled := settled'
      settlementCount := counts' }
  | .acceptClient =>
    if s.closed then s else { s with clientConnected := true }
  | .serverDispose =>
    { s with
      serverDisposed := true
      serverActive := [] }
  | .transportClose =>
    if s.closed then
      s
    else
      let (settled', counts') := settleAllPending .rejectedDisconnected s.pending s.settled s.settlementCount
      { s with
        closed := true
        clientConnected := false
        pending := []
        settled := settled'
        settlementCount := counts'
        serverActive := [] }

def runTrace (s : RpcState) (trace : List RpcEvent) : RpcState :=
  trace.foldl step s

structure WellFormed (s : RpcState) : Prop where
  pendingNodup : (s.pending.map Prod.fst).Nodup
  settledNodup : (s.settled.map Prod.fst).Nodup
  pendingBound : ∀ id, hasKey s.pending id = true → id < s.nextId
  settledBound : ∀ id, hasKey s.settled id = true → id < s.nextId
  disjoint : ∀ id, ¬(hasKey s.pending id = true ∧ hasKey s.settled id = true)
  countSettled : ∀ id, hasKey s.settled id = true → s.settlementCount id = 1
  countUnsettled : ∀ id, hasKey s.settled id = false → s.settlementCount id = 0
  closedEmpty : s.closed = true → s.pending = []
  disconnectedEmpty : s.clientConnected = false → s.pending = []

private theorem hasKey_iff_mem_keys {α : Type} {xs : List (ReqId × α)} {id : ReqId} :
    hasKey xs id = true ↔ id ∈ xs.map Prod.fst := by
  induction xs with
  | nil => simp [hasKey, lookupAssoc]
  | cons hd tl ih =>
    cases hd with
    | mk k v =>
      simp only [hasKey, lookupAssoc, List.map_cons, List.mem_cons]
      by_cases hk : k = id
      · subst hk; simp
      · have hne : (k == id) = false := beq_false_of_ne hk
        simp only [hne, Bool.false_eq_true, ↓reduceIte]
        constructor
        · intro h; exact Or.inr (ih.mp h)
        · rintro (rfl | h)
          · exact absurd rfl hk
          · exact ih.mpr h

private theorem hasKey_removeKey {α : Type} (xs : List (ReqId × α)) (id k : ReqId) :
    hasKey (removeKey id xs) k = if k == id then false else hasKey xs k := by
  induction xs with
  | nil =>
    by_cases h : k = id <;> simp [removeKey, hasKey, lookupAssoc, h]
  | cons hd tl ih =>
    cases hd with
    | mk k' v' =>
      simp only [removeKey]
      by_cases hkid : k' = id
      · subst hkid
        simp only [beq_self_eq_true, ↓reduceIte, ih]
        by_cases hkk : k = k'
        · subst hkk; simp
        · have h1 : (k == k') = false := beq_false_of_ne hkk
          have h2 : (k' == k) = false := beq_false_of_ne (Ne.symm hkk)
          simp [hasKey, lookupAssoc, h1, h2]
      · have h1 : (k' == id) = false := beq_false_of_ne hkid
        simp only [h1, Bool.false_eq_true, ↓reduceIte]
        by_cases hkk' : k' = k
        · subst hkk'
          have h2 : (k' == id) = false := h1
          simp [hasKey, lookupAssoc, h2]
        · have h2 : (k' == k) = false := beq_false_of_ne hkk'
          simp only [hasKey, lookupAssoc, h2, Bool.false_eq_true, ↓reduceIte]
          exact ih

private theorem map_fst_removeKey_subset {α : Type} (xs : List (ReqId × α)) (id k : ReqId) :
    k ∈ (removeKey id xs).map Prod.fst → k ∈ xs.map Prod.fst := by
  intro h
  have hk := hasKey_iff_mem_keys.mpr h
  rw [hasKey_removeKey] at hk
  split at hk
  · cases hk
  · exact hasKey_iff_mem_keys.mp hk

private theorem nodup_removeKey {α : Type} {xs : List (ReqId × α)} (id : ReqId)
    (h : (xs.map Prod.fst).Nodup) : ((removeKey id xs).map Prod.fst).Nodup := by
  induction xs with
  | nil => simp [removeKey]
  | cons hd tl ih =>
    cases hd with
    | mk k v =>
      simp only [List.map_cons, List.nodup_cons] at h
      simp only [removeKey]
      split
      · exact ih h.2
      · simp only [List.map_cons, List.nodup_cons]
        exact ⟨fun hm => h.1 (map_fst_removeKey_subset tl id k hm), ih h.2⟩

private theorem map_fst_updateKey {α : Type} (xs : List (ReqId × α)) (id : ReqId) (f : α → α) :
    (updateKey id f xs).map Prod.fst = xs.map Prod.fst := by
  induction xs with
  | nil => rfl
  | cons hd tl ih =>
    cases hd with
    | mk k v =>
      simp only [updateKey]
      split
      · rfl
      · simp only [List.map_cons, ih]

private theorem hasKey_updateKey {α : Type} (xs : List (ReqId × α)) (id k : ReqId) (f : α → α) :
    hasKey (updateKey id f xs) k = hasKey xs k := by
  cases h : hasKey xs k with
  | true =>
    apply hasKey_iff_mem_keys.mpr
    rw [map_fst_updateKey]
    exact hasKey_iff_mem_keys.mp h
  | false =>
    cases h' : hasKey (updateKey id f xs) k with
    | false => rfl
    | true =>
      have hm := hasKey_iff_mem_keys.mp h'
      rw [map_fst_updateKey] at hm
      have ht := hasKey_iff_mem_keys.mpr hm
      rw [ht] at h
      cases h

private theorem not_mem_keys_of_hasKey_false {α : Type} {xs : List (ReqId × α)} {id : ReqId}
    (h : hasKey xs id = false) : id ∉ xs.map Prod.fst := by
  intro hm
  rw [hasKey_iff_mem_keys.mpr hm] at h
  cases h

private theorem settleOne_preserves_wellFormed (s : RpcState) (id : ReqId) (out : Outcome)
    (hwf : WellFormed s) : WellFormed (settleOne s id out) := by
  unfold settleOne
  cases hlp : lookupAssoc id s.pending with
  | none => exact hwf
  | some req =>
    have hpend_id : hasKey s.pending id = true := by simp [hasKey, hlp]
    have hnot_settled_id : hasKey s.settled id = false := by
      cases hs : hasKey s.settled id with
      | false => rfl
      | true => exact absurd ⟨hpend_id, hs⟩ (hwf.disjoint id)
    refine ⟨?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_, ?_⟩
    · exact nodup_removeKey id hwf.pendingNodup
    · simp only [List.map_cons, List.nodup_cons]
      exact ⟨not_mem_keys_of_hasKey_false hnot_settled_id, hwf.settledNodup⟩
    · intro k hk
      rw [hasKey_removeKey] at hk
      split at hk
      · cases hk
      · exact hwf.pendingBound k hk
    · intro k hk
      simp only [hasKey, lookupAssoc] at hk
      by_cases hki : id = k
      · subst hki; exact hwf.pendingBound id hpend_id
      · have hne : (id == k) = false := beq_false_of_ne hki
        simp only [hne, Bool.false_eq_true, ↓reduceIte] at hk
        exact hwf.settledBound k hk
    · intro k ⟨hp, hs⟩
      rw [hasKey_removeKey] at hp
      by_cases hki : k = id
      · subst hki; simp at hp
      · have h1 : (k == id) = false := beq_false_of_ne hki
        have h2 : (id == k) = false := beq_false_of_ne (Ne.symm hki)
        simp only [h1, Bool.false_eq_true, ↓reduceIte] at hp
        simp only [hasKey, lookupAssoc, h2, Bool.false_eq_true, ↓reduceIte] at hs
        exact hwf.disjoint k ⟨hp, hs⟩
    · intro k hk
      unfold incCount
      by_cases hki : k = id
      · subst hki
        simp [hwf.countUnsettled k hnot_settled_id]
      · have h1 : (k == id) = false := beq_false_of_ne hki
        have h2 : (id == k) = false := beq_false_of_ne (Ne.symm hki)
        simp only [h1, Bool.false_eq_true, ↓reduceIte]
        simp only [hasKey, lookupAssoc, h2, Bool.false_eq_true, ↓reduceIte] at hk
        exact hwf.countSettled k hk
    · intro k hk
      unfold incCount
      by_cases hki : k = id
      · subst hki
        simp [hasKey, lookupAssoc] at hk
      · have h1 : (k == id) = false := beq_false_of_ne hki
        have h2 : (id == k) = false := beq_false_of_ne (Ne.symm hki)
        simp only [h1, Bool.false_eq_true, ↓reduceIte]
        simp only [hasKey, lookupAssoc, h2, Bool.false_eq_true, ↓reduceIte] at hk
        exact hwf.countUnsettled k hk
    · intro hcl
      rw [hwf.closedEmpty hcl] at hlp
      simp [lookupAssoc] at hlp
    · intro hdisc
      rw [hwf.disconnectedEmpty hdisc] at hlp
      simp [lookupAssoc] at hlp

private theorem settleAllPending_spec (out : Outcome) :
    ∀ (pend : List (ReqId × ClientReq)) (settled : List (ReqId × Outcome))
      (counts : ReqId → Nat) (nextId : ReqId),
      (pend.map Prod.fst).Nodup →
      (settled.map Prod.fst).Nodup →
      (∀ id, hasKey pend id = true → id < nextId) →
      (∀ id, hasKey settled id = true → id < nextId) →
      (∀ id, ¬(hasKey pend id = true ∧ hasKey settled id = true)) →
      (∀ id, hasKey settled id = true → counts id = 1) →
      (∀ id, hasKey settled id = false → counts id = 0) →
      let res := settleAllPending out pend settled counts
      (res.1.map Prod.fst).Nodup ∧
      (∀ id, hasKey res.1 id = true → id < nextId) ∧
      (∀ id, hasKey res.1 id = true → res.2 id = 1) ∧
      (∀ id, hasKey res.1 id = false → res.2 id = 0) ∧
      (∀ id o, lookupAssoc id settled = some o → lookupAssoc id res.1 = some o) := by
  intro pend
  induction pend with
  | nil =>
    intro settled counts nextId _ hsnd _ hsb _ hcs hcu
    exact ⟨hsnd, hsb, hcs, hcu, fun _ _ h => h⟩
  | cons hd tl ih =>
    cases hd with
    | mk id req =>
      intro settled counts nextId hpnd hsnd hpb hsb hdisj hcs hcu
      simp only [List.map_cons, List.nodup_cons] at hpnd
      have hid_not_tl : hasKey tl id = false := by
        cases h : hasKey tl id with
        | false => rfl
        | true => exact absurd (hasKey_iff_mem_keys.mp h) hpnd.1
      have hid_not_s : hasKey settled id = false := by
        cases h : hasKey settled id with
        | false => rfl
        | true =>
          have hp : hasKey ((id, req) :: tl) id = true := by simp [hasKey, lookupAssoc]
          exact absurd ⟨hp, h⟩ (hdisj id)
      have hsnd' : (((id, out) :: settled).map Prod.fst).Nodup := by
        simp only [List.map_cons, List.nodup_cons]
        exact ⟨not_mem_keys_of_hasKey_false hid_not_s, hsnd⟩
      have hpb' : ∀ k, hasKey tl k = true → k < nextId := by
        intro k hk
        apply hpb k
        simp only [hasKey, lookupAssoc]
        by_cases hki : id = k
        · subst hki; simp
        · simp [beq_false_of_ne hki]; exact hk
      have hsb' : ∀ k, hasKey ((id, out) :: settled) k = true → k < nextId := by
        intro k hk
        simp only [hasKey, lookupAssoc] at hk
        by_cases hki : id = k
        · subst hki; exact hpb id (by simp [hasKey, lookupAssoc])
        · simp [beq_false_of_ne hki] at hk; exact hsb k hk
      have hdisj' : ∀ k, ¬(hasKey tl k = true ∧ hasKey ((id, out) :: settled) k = true) := by
        intro k ⟨hkt, hks⟩
        by_cases hki : id = k
        · subst hki; rw [hid_not_tl] at hkt; cases hkt
        · have hne : (id == k) = false := beq_false_of_ne hki
          simp only [hasKey, lookupAssoc, hne, Bool.false_eq_true, ↓reduceIte] at hks
          have hp : hasKey ((id, req) :: tl) k = true := by
            simp only [hasKey, lookupAssoc, hne, Bool.false_eq_true, ↓reduceIte]; exact hkt
          exact hdisj k ⟨hp, hks⟩
      have hcs' : ∀ k, hasKey ((id, out) :: settled) k = true → incCount counts id k = 1 := by
        intro k hk
        unfold incCount
        by_cases hki : k = id
        · subst hki; simp [hcu k hid_not_s]
        · have h1 : (k == id) = false := beq_false_of_ne hki
          have h2 : (id == k) = false := beq_false_of_ne (Ne.symm hki)
          simp only [h1, Bool.false_eq_true, ↓reduceIte]
          simp only [hasKey, lookupAssoc, h2, Bool.false_eq_true, ↓reduceIte] at hk
          exact hcs k hk
      have hcu' : ∀ k, hasKey ((id, out) :: settled) k = false → incCount counts id k = 0 := by
        intro k hk
        unfold incCount
        by_cases hki : k = id
        · subst hki; simp [hasKey, lookupAssoc] at hk
        · have h1 : (k == id) = false := beq_false_of_ne hki
          have h2 : (id == k) = false := beq_false_of_ne (Ne.symm hki)
          simp only [h1, Bool.false_eq_true, ↓reduceIte]
          simp only [hasKey, lookupAssoc, h2, Bool.false_eq_true, ↓reduceIte] at hk
          exact hcu k hk
      obtain ⟨r1, r2, r3, r4, r5⟩ :=
        ih ((id, out) :: settled) (incCount counts id) nextId hpnd.2 hsnd' hpb' hsb' hdisj' hcs' hcu'
      refine ⟨r1, r2, r3, r4, ?_⟩
      intro k o hlook
      apply r5 k o
      by_cases hki : id = k
      · subst hki
        have : hasKey settled id = true := by simp [hasKey, hlook]
        rw [this] at hid_not_s; cases hid_not_s
      · simp [lookupAssoc, beq_false_of_ne hki, hlook]

theorem initState_wellFormed : WellFormed initState where
  pendingNodup := List.nodup_nil
  settledNodup := List.nodup_nil
  pendingBound := by intro id h; simp [initState, hasKey, lookupAssoc] at h
  settledBound := by intro id h; simp [initState, hasKey, lookupAssoc] at h
  disjoint := by intro id ⟨h, _⟩; simp [initState, hasKey, lookupAssoc] at h
  countSettled := by intro id h; simp [initState, hasKey, lookupAssoc] at h
  countUnsettled := by intro id _; rfl
  closedEmpty := by intro h; cases h
  disconnectedEmpty := by intro h; cases h

theorem step_preserves_wellFormed (s : RpcState) (e : RpcEvent) (hwf : WellFormed s) :
    WellFormed (step s e) := by
  cases e with
  | clientSend preAborted =>
    dsimp only [step]
    by_cases hcond : (s.closed || !s.clientConnected) = true
    · simp only [hcond, ↓reduceIte]; exact hwf
    · simp only [hcond, Bool.false_eq_true, ↓reduceIte]
      have hnotclosed : s.closed = false := by
        cases h : s.closed with
        | false => rfl
        | true => simp [h] at hcond
      have hconn : s.clientConnected = true := by
        cases h : s.clientConnected with
        | true => rfl
        | false => simp [h] at hcond
      cases preAborted with
      | true => simp only [↓reduceIte]; exact hwf
      | false =>
        simp only [Bool.false_eq_true, ↓reduceIte]
        have hfresh_p : hasKey s.pending s.nextId = false := by
          cases h : hasKey s.pending s.nextId with
          | false => rfl
          | true =>
            have hlt : s.nextId < s.nextId := hwf.pendingBound s.nextId h
            exact absurd hlt (Nat.lt_irrefl _)
        have hfresh_s : hasKey s.settled s.nextId = false := by
          cases h : hasKey s.settled s.nextId with
          | false => rfl
          | true =>
            have hlt : s.nextId < s.nextId := hwf.settledBound s.nextId h
            exact absurd hlt (Nat.lt_irrefl _)
        refine ⟨?_, hwf.settledNodup, ?_, ?_, ?_, hwf.countSettled, hwf.countUnsettled, ?_, ?_⟩
        · simp only [List.map_cons, List.nodup_cons]
          exact ⟨not_mem_keys_of_hasKey_false hfresh_p, hwf.pendingNodup⟩
        · intro k hk
          simp only [hasKey, lookupAssoc] at hk
          by_cases hki : s.nextId = k
          · subst hki; exact Nat.lt_succ_self _
          · simp [beq_false_of_ne hki] at hk
            exact Nat.lt_succ_of_lt (hwf.pendingBound k hk)
        · intro k hk
          exact Nat.lt_succ_of_lt (hwf.settledBound k hk)
        · intro k ⟨hp, hs⟩
          simp only [hasKey, lookupAssoc] at hp
          by_cases hki : s.nextId = k
          · subst hki; rw [hs] at hfresh_s; cases hfresh_s
          · simp [beq_false_of_ne hki] at hp
            exact hwf.disjoint k ⟨hp, hs⟩
        · intro hcl; rw [hnotclosed] at hcl; cases hcl
        · intro hdc; rw [hconn] at hdc; cases hdc
  | dispatchSuccess id =>
    dsimp only [step]
    cases hlp : lookupAssoc id s.inFlight with
    | none => exact hwf
    | some wasAborted =>
      refine ⟨?_, hwf.settledNodup, ?_, hwf.settledBound, ?_, hwf.countSettled, hwf.countUnsettled, ?_, ?_⟩
      · rw [map_fst_updateKey]; exact hwf.pendingNodup
      · intro k hk; rw [hasKey_updateKey] at hk; exact hwf.pendingBound k hk
      · intro k ⟨hp, hs⟩; rw [hasKey_updateKey] at hp; exact hwf.disjoint k ⟨hp, hs⟩
      · intro hcl; rw [hwf.closedEmpty hcl]; rfl
      · intro hdc; rw [hwf.disconnectedEmpty hdc]; rfl
  | dispatchFail id =>
    dsimp only [step]
    cases lookupAssoc id s.inFlight with
    | none => exact hwf
    | some _ =>
      have h1 : WellFormed { s with inFlight := removeKey id s.inFlight } :=
        ⟨hwf.pendingNodup, hwf.settledNodup, hwf.pendingBound, hwf.settledBound,
          hwf.disjoint, hwf.countSettled, hwf.countUnsettled, hwf.closedEmpty, hwf.disconnectedEmpty⟩
      exact settleOne_preserves_wellFormed _ id .rejectedDispatchFailed h1
  | clientAbort id isTimeout =>
    dsimp only [step]
    cases hlp : lookupAssoc id s.pending with
    | none => simp only; exact hwf
    | some req =>
      simp only
      have h1 := settleOne_preserves_wellFormed s id
        (if isTimeout then .rejectedTimeout else .rejectedAbort) hwf
      split
      · exact ⟨h1.pendingNodup, h1.settledNodup, h1.pendingBound, h1.settledBound,
          h1.disjoint, h1.countSettled, h1.countUnsettled, h1.closedEmpty, h1.disconnectedEmpty⟩
      · split
        · exact ⟨h1.pendingNodup, h1.settledNodup, h1.pendingBound, h1.settledBound,
            h1.disjoint, h1.countSettled, h1.countUnsettled, h1.closedEmpty, h1.disconnectedEmpty⟩
        · exact h1
  | dropCancel id =>
    exact ⟨hwf.pendingNodup, hwf.settledNodup, hwf.pendingBound, hwf.settledBound,
      hwf.disjoint, hwf.countSettled, hwf.countUnsettled, hwf.closedEmpty, hwf.disconnectedEmpty⟩
  | serverReceiveRequest id =>
    dsimp only [step]
    split
    · exact hwf
    · exact ⟨hwf.pendingNodup, hwf.settledNodup, hwf.pendingBound, hwf.settledBound,
        hwf.disjoint, hwf.countSettled, hwf.countUnsettled, hwf.closedEmpty, hwf.disconnectedEmpty⟩
  | serverReceiveCancel id =>
    exact ⟨hwf.pendingNodup, hwf.settledNodup, hwf.pendingBound, hwf.settledBound,
      hwf.disjoint, hwf.countSettled, hwf.countUnsettled, hwf.closedEmpty, hwf.disconnectedEmpty⟩
  | serverRespond id isError =>
    dsimp only [step]
    split
    · exact hwf
    · have h1 : WellFormed { s with serverActive := removeKey id s.serverActive } :=
        ⟨hwf.pendingNodup, hwf.settledNodup, hwf.pendingBound, hwf.settledBound,
          hwf.disjoint, hwf.countSettled, hwf.countUnsettled, hwf.closedEmpty, hwf.disconnectedEmpty⟩
      exact settleOne_preserves_wellFormed _ id (if isError then .rejectedError else .resolved) h1
  | releaseClient =>
    dsimp only [step]
    have hspec := settleAllPending_spec .rejectedDisconnected s.pending s.settled s.settlementCount
      s.nextId hwf.pendingNodup hwf.settledNodup hwf.pendingBound hwf.settledBound hwf.disjoint
      hwf.countSettled hwf.countUnsettled
    refine ⟨List.nodup_nil, hspec.1, ?_, hspec.2.1, ?_, hspec.2.2.1, hspec.2.2.2.1, ?_, ?_⟩
    · intro k hk; simp [hasKey, lookupAssoc] at hk
    · intro k ⟨hp, _⟩; simp [hasKey, lookupAssoc] at hp
    · intro _; rfl
    · intro _; rfl
  | acceptClient =>
    dsimp only [step]
    by_cases hcl : s.closed = true
    · simp only [hcl, ↓reduceIte]; exact hwf
    · simp only [hcl, Bool.false_eq_true, ↓reduceIte]
      refine ⟨hwf.pendingNodup, hwf.settledNodup, hwf.pendingBound, hwf.settledBound,
        hwf.disjoint, hwf.countSettled, hwf.countUnsettled, ?_, ?_⟩
      · intro h; cases h
      · intro h; cases h
  | serverDispose =>
    exact ⟨hwf.pendingNodup, hwf.settledNodup, hwf.pendingBound, hwf.settledBound,
      hwf.disjoint, hwf.countSettled, hwf.countUnsettled, hwf.closedEmpty, hwf.disconnectedEmpty⟩
  | transportClose =>
    dsimp only [step]
    split
    · exact hwf
    · have hspec := settleAllPending_spec .rejectedDisconnected s.pending s.settled s.settlementCount
        s.nextId hwf.pendingNodup hwf.settledNodup hwf.pendingBound hwf.settledBound hwf.disjoint
        hwf.countSettled hwf.countUnsettled
      refine ⟨List.nodup_nil, hspec.1, ?_, hspec.2.1, ?_, hspec.2.2.1, hspec.2.2.2.1, ?_, ?_⟩
      · intro k hk; simp [hasKey, lookupAssoc] at hk
      · intro k ⟨hp, _⟩; simp [hasKey, lookupAssoc] at hp
      · intro _; rfl
      · intro _; rfl

theorem runTrace_preserves_wellFormed (s : RpcState) (trace : List RpcEvent) (hwf : WellFormed s) :
    WellFormed (runTrace s trace) := by
  induction trace generalizing s with
  | nil => exact hwf
  | cons e es ih =>
    exact ih (step s e) (step_preserves_wellFormed s e hwf)

theorem single_settlement_invariant (trace : List RpcEvent) (id : ReqId) :
    (runTrace initState trace).settlementCount id ≤ 1 := by
  have hwf := runTrace_preserves_wellFormed initState trace initState_wellFormed
  cases h : hasKey (runTrace initState trace).settled id with
  | true =>
    rw [hwf.countSettled id h]
    exact Nat.le_refl 1
  | false =>
    rw [hwf.countUnsettled id h]
    exact Nat.zero_le 1

private theorem settleOne_preserves_outcome (s : RpcState) (target id : ReqId) (out out' : Outcome)
    (hwf : WellFormed s) (hlook : lookupAssoc target s.settled = some out) :
    lookupAssoc target (settleOne s id out').settled = some out := by
  unfold settleOne
  cases hlp : lookupAssoc id s.pending with
  | none => exact hlook
  | some req =>
    have hpend : hasKey s.pending id = true := by simp [hasKey, hlp]
    have hset : hasKey s.settled target = true := by simp [hasKey, hlook]
    have hne : id ≠ target := by
      intro heq; subst heq; exact hwf.disjoint id ⟨hpend, hset⟩
    simp [lookupAssoc, beq_false_of_ne hne, hlook]

theorem step_preserves_settlement (s : RpcState) (e : RpcEvent) (id : ReqId) (out : Outcome)
    (hwf : WellFormed s) (hlook : lookupAssoc id s.settled = some out) :
    lookupAssoc id (step s e).settled = some out := by
  cases e with
  | clientSend preAborted =>
    dsimp only [step]
    by_cases h1 : (s.closed || !s.clientConnected) = true
    · simp [h1, hlook]
    · cases preAborted <;> simp [h1, hlook]
  | dispatchSuccess reqId =>
    dsimp only [step]
    cases lookupAssoc reqId s.inFlight <;> exact hlook
  | dispatchFail reqId =>
    dsimp only [step]
    cases lookupAssoc reqId s.inFlight with
    | none => exact hlook
    | some _ =>
      have hwf' : WellFormed { s with inFlight := removeKey reqId s.inFlight } :=
        ⟨hwf.pendingNodup, hwf.settledNodup, hwf.pendingBound, hwf.settledBound,
          hwf.disjoint, hwf.countSettled, hwf.countUnsettled, hwf.closedEmpty, hwf.disconnectedEmpty⟩
      exact settleOne_preserves_outcome _ id reqId out .rejectedDispatchFailed hwf' hlook
  | clientAbort reqId isTimeout =>
    dsimp only [step]
    cases hlp : lookupAssoc reqId s.pending with
    | none => simp only; exact hlook
    | some req =>
      simp only
      have h := settleOne_preserves_outcome s id reqId out
        (if isTimeout then .rejectedTimeout else .rejectedAbort) hwf hlook
      split
      · exact h
      · split <;> exact h
  | dropCancel _ => exact hlook
  | serverReceiveRequest _ =>
    dsimp only [step]; split <;> exact hlook
  | serverReceiveCancel _ => exact hlook
  | serverRespond reqId isError =>
    dsimp only [step]
    split
    · exact hlook
    · have hwf' : WellFormed { s with serverActive := removeKey reqId s.serverActive } :=
        ⟨hwf.pendingNodup, hwf.settledNodup, hwf.pendingBound, hwf.settledBound,
          hwf.disjoint, hwf.countSettled, hwf.countUnsettled, hwf.closedEmpty, hwf.disconnectedEmpty⟩
      exact settleOne_preserves_outcome _ id reqId out
        (if isError then .rejectedError else .resolved) hwf' hlook
  | releaseClient =>
    dsimp only [step]
    have hspec := settleAllPending_spec .rejectedDisconnected s.pending s.settled s.settlementCount
      s.nextId hwf.pendingNodup hwf.settledNodup hwf.pendingBound hwf.settledBound hwf.disjoint
      hwf.countSettled hwf.countUnsettled
    exact hspec.2.2.2.2 id out hlook
  | acceptClient =>
    dsimp only [step]; split <;> exact hlook
  | serverDispose => exact hlook
  | transportClose =>
    dsimp only [step]
    split
    · exact hlook
    · have hspec := settleAllPending_spec .rejectedDisconnected s.pending s.settled s.settlementCount
        s.nextId hwf.pendingNodup hwf.settledNodup hwf.pendingBound hwf.settledBound hwf.disjoint
        hwf.countSettled hwf.countUnsettled
      exact hspec.2.2.2.2 id out hlook

theorem late_response_ignored_after_settlement
    (s : RpcState) (trace : List RpcEvent) (id : ReqId) (out : Outcome)
    (hwf : WellFormed s) (hlook : lookupAssoc id s.settled = some out) :
    lookupAssoc id (runTrace s trace).settled = some out := by
  induction trace generalizing s with
  | nil => exact hlook
  | cons e es ih =>
    exact ih (step s e) (step_preserves_wellFormed s e hwf)
      (step_preserves_settlement s e id out hwf hlook)

theorem step_closed_stays_closed (s : RpcState) (e : RpcEvent) (hcl : s.closed = true) :
    (step s e).closed = true := by
  cases e with
  | clientSend preAborted => simp [step, hcl]
  | dispatchSuccess reqId =>
    dsimp only [step]
    cases lookupAssoc reqId s.inFlight <;> simp [hcl]
  | dispatchFail reqId =>
    dsimp only [step]
    cases lookupAssoc reqId s.inFlight with
    | none => exact hcl
    | some _ =>
      unfold settleOne
      cases lookupAssoc reqId s.pending <;> simp [hcl]
  | clientAbort reqId isTimeout =>
    dsimp only [step]
    cases lookupAssoc reqId s.pending with
    | none => exact hcl
    | some req =>
      simp only [hcl, Bool.not_true, Bool.and_false, Bool.false_eq_true, ↓reduceIte]
      split <;> (unfold settleOne; cases lookupAssoc reqId s.pending <;> simp [hcl])
  | dropCancel _ => exact hcl
  | serverReceiveRequest _ => simp [step, hcl]
  | serverReceiveCancel _ => exact hcl
  | serverRespond _ _ => simp [step, hcl]
  | releaseClient => exact hcl
  | acceptClient => simp [step, hcl]
  | serverDispose => exact hcl
  | transportClose => simp [step, hcl]

theorem no_pending_leak_after_close (s : RpcState) (trace : List RpcEvent) (hwf : WellFormed s) :
    (runTrace (step s .transportClose) trace).pending = [] := by
  have hcl0 : (step s .transportClose).closed = true := by
    dsimp only [step]
    cases h : s.closed <;> simp [h]
  have hwf0 : WellFormed (step s .transportClose) := step_preserves_wellFormed s .transportClose hwf
  have hclosed_all : ∀ (st : RpcState) (tr : List RpcEvent),
      WellFormed st → st.closed = true → (runTrace st tr).pending = [] := by
    intro st tr
    induction tr generalizing st with
    | nil =>
      intro hw hc; exact hw.closedEmpty hc
    | cons e es ih =>
      intro hw hc
      exact ih (step st e) (step_preserves_wellFormed st e hw) (step_closed_stays_closed st e hc)
  exact hclosed_all _ trace hwf0 hcl0

theorem no_pending_leak_after_releaseClient (s : RpcState) :
    (step s .releaseClient).pending = [] := by
  rfl

theorem cancel_drop_safety
    (s : RpcState) (droppedId target : ReqId) (out : Outcome)
    (hwf : WellFormed s) (hlook : lookupAssoc target s.settled = some out) :
    lookupAssoc target (step s (.dropCancel droppedId)).settled = some out ∧
    (step s (.dropCancel droppedId)).pending = s.pending ∧
    (step s (.dropCancel droppedId)).settlementCount target ≤ 1 := by
  have hset : hasKey s.settled target = true := by simp [hasKey, hlook]
  refine ⟨hlook, rfl, ?_⟩
  change s.settlementCount target ≤ 1
  rw [hwf.countSettled target hset]
  exact Nat.le_refl 1

theorem disjoint_pending_settled (trace : List RpcEvent) (id : ReqId) :
    ¬(hasKey (runTrace initState trace).pending id = true ∧
      hasKey (runTrace initState trace).settled id = true) :=
  (runTrace_preserves_wellFormed initState trace initState_wellFormed).disjoint id

theorem in_flight_abort_queues_cancel_on_dispatch_success
    (s : RpcState) (isTimeout : Bool)
    (hwf : WellFormed s) (hopen : s.closed = false) (hconn : s.clientConnected = true) :
    let id := s.nextId
    let s' := runTrace s [.clientSend false, .clientAbort id isTimeout, .dispatchSuccess id]
    id ∈ s'.cancelQueue ∧
    lookupAssoc id s'.settled = some (if isTimeout then .rejectedTimeout else .rejectedAbort) ∧
    s'.settlementCount id = 1 := by
  have hfresh_s : hasKey s.settled s.nextId = false := by
    cases h : hasKey s.settled s.nextId with
    | false => rfl
    | true => exact absurd (hwf.settledBound s.nextId h) (Nat.lt_irrefl _)
  have hcount0 : s.settlementCount s.nextId = 0 := hwf.countUnsettled s.nextId hfresh_s
  simp [runTrace, step, settleOne, lookupAssoc, updateKey, incCount, hopen, hconn, hcount0]

end StagehandProofs.RpcCancellation
