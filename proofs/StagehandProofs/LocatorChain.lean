/-
  StagehandProofs.LocatorChain

  Formal model and inductive proofs for Stagehand's multi-step locator chain resolution
  (`packages/extension/understudy/chainLocator.ts`, `elementChainResolver.ts`,
   `frameChainResolver.ts`).

  Proves inductively over arbitrary chain lengths `List ChainStep`:
  1. `resolveChain_session_isolation`: every resolved handle's `sessionId` matches its
     owning frame's authoritative session at resolution time (zero cross-session handle
     mixing across arbitrary iframe depths).
  2. `resolveChain_zero_objectGroup_leak`: executing any chain under bracketed
     `withObjectGroup` leaves `activeGroups` unchanged on ALL outcomes
     (`ok`, `notFound`, `error`, `aborted`).
  3. `slice_bounds_sound`: `first`, `last`, and `nth` never return an out-of-bounds index,
     never fabricate elements outside the input list, and are deterministic.
-/

namespace StagehandProofs.LocatorChain

abbrev FrameId := Nat
abbrev SessionId := Nat
abbrev NodeId := Nat
abbrev LoaderId := Nat
abbrev ObjectGroupId := Nat

inductive SliceKind where
  | first
  | last
  | nth (index : Nat)
  deriving DecidableEq, Repr

inductive ChainStep where
  | query (selector : String)
  | frameHop (selector : String)
  | slice (kind : SliceKind)
  deriving DecidableEq, Repr

structure FrameWorld where
  frameId : FrameId
  sessionId : SessionId
  loaderId : LoaderId
  deriving DecidableEq, Repr

structure ChainMatch where
  world : FrameWorld
  nodeId : NodeId
  isFrame : Bool
  deriving DecidableEq, Repr

structure ResolvedHandle where
  sessionId : SessionId
  frameId : FrameId
  backendNodeId : NodeId
  deriving DecidableEq, Repr

inductive ChainOutcome (α : Type) where
  | ok (value : α)
  | notFound
  | error (msg : String)
  | aborted
  deriving DecidableEq, Repr

/-! ### Positional slicing (`first`, `last`, `nth`) -/

def sliceIndex (kind : SliceKind) (len : Nat) : Option Nat :=
  match kind with
  | .first => if 0 < len then some 0 else none
  | .last => if 0 < len then some (len - 1) else none
  | .nth idx => if idx < len then some idx else none

def sliceMatches {α : Type} (kind : SliceKind) (xs : List α) : List α :=
  match sliceIndex kind xs.length with
  | none => []
  | some idx =>
    match xs[idx]? with
    | none => []
    | some x => [x]

/-- Theorem (Slice Index Bounds): `sliceIndex` never returns an out-of-bounds index. -/
theorem sliceIndex_lt_length (kind : SliceKind) (len idx : Nat)
    (h : sliceIndex kind len = some idx) :
    idx < len := by
  cases kind with
  | first =>
    simp only [sliceIndex] at h
    by_cases hpos : 0 < len
    · simp only [hpos, ↓reduceIte, Option.some.injEq] at h
      omega
    · simp [hpos] at h
  | last =>
    simp only [sliceIndex] at h
    by_cases hpos : 0 < len
    · simp only [hpos, ↓reduceIte, Option.some.injEq] at h
      omega
    · simp [hpos] at h
  | nth i =>
    simp only [sliceIndex] at h
    by_cases hlt : i < len
    · simp only [hlt, ↓reduceIte, Option.some.injEq] at h
      omega
    · simp [hlt] at h

/-- Theorem (Slice Determinism): `sliceIndex` is a deterministic function of `(kind, len)`. -/
theorem sliceIndex_deterministic (kind : SliceKind) (len idx₁ idx₂ : Nat)
    (h₁ : sliceIndex kind len = some idx₁)
    (h₂ : sliceIndex kind len = some idx₂) :
    idx₁ = idx₂ := by
  rw [h₁] at h₂
  cases h₂
  rfl

/-- Theorem (Slice Soundness): `first`, `last`, and `nth` return at most one element,
    every returned index is strictly in bounds, every returned element belongs to the
    input list, and the result is deterministic. -/
theorem slice_bounds_sound {α : Type} (kind : SliceKind) (xs : List α) :
    (∀ idx, sliceIndex kind xs.length = some idx → idx < xs.length) ∧
    (sliceMatches kind xs).length ≤ 1 ∧
    (∀ x ∈ sliceMatches kind xs, x ∈ xs) := by
  refine ⟨fun idx h => sliceIndex_lt_length kind xs.length idx h, ?_, ?_⟩
  · unfold sliceMatches
    cases hidx : sliceIndex kind xs.length with
    | none => simp
    | some idx =>
      dsimp only
      cases hget : xs[idx]? with
      | none => simp
      | some x => simp
  · intro x hx
    unfold sliceMatches at hx
    cases hidx : sliceIndex kind xs.length with
    | none => simp [hidx] at hx
    | some idx =>
      simp only [hidx] at hx
      cases hget : xs[idx]? with
      | none => simp [hget] at hx
      | some y =>
        simp only [hget, List.mem_singleton] at hx
        subst x
        exact List.mem_of_getElem? hget

/-! ### Multi-step cross-frame resolution environment and session tracking -/

structure ChainEnv where
  /-- Authoritative frame → session map (`page.getSessionForFrame`). -/
  frameSession : FrameId → Option SessionId
  /-- Authoritative frame → loaderId map (`registry.frames.get(fid).lastSeen.loaderId`). -/
  frameLoader : FrameId → Option LoaderId
  /-- Single-world DOM query (`createFrameChainScope.query`): returns `(nodeId, isFrame)`
      strictly within the queried `FrameWorld`. -/
  queryWorld : FrameWorld → String → NodeId → List (NodeId × Bool)
  /-- `findContentFrameId`: resolves an iframe element's child `FrameId`. -/
  contentFrame : FrameWorld → NodeId → Option FrameId
  /-- `DOM.describeNode`: resolves a remote handle to its `backendNodeId`. -/
  describeNode : FrameWorld → NodeId → Option NodeId
  /-- Whether progress cancellation / timeout fired at step `k`. -/
  abortedAt : Nat → Bool

/-- A `FrameWorld` is valid iff its session and loaderId match the authoritative registry
    (`FrameChainOperation.assertWorld` in `frameChainResolver.ts:146-155`). -/
def worldValid (env : ChainEnv) (w : FrameWorld) : Prop :=
  env.frameSession w.frameId = some w.sessionId ∧ env.frameLoader w.frameId = some w.loaderId

def openWorld (env : ChainEnv) (frameId : FrameId) : Option FrameWorld :=
  match env.frameSession frameId, env.frameLoader frameId with
  | some sid, some lid => some { frameId, sessionId := sid, loaderId := lid }
  | _, _ => none

theorem openWorld_valid (env : ChainEnv) (frameId : FrameId) (w : FrameWorld)
    (h : openWorld env frameId = some w) :
    worldValid env w := by
  unfold openWorld at h
  cases hs : env.frameSession frameId with
  | none => rw [hs] at h; cases h
  | some sid =>
    rw [hs] at h
    cases hl : env.frameLoader frameId with
    | none => rw [hl] at h; cases h
    | some lid =>
      rw [hl] at h
      cases h
      exact ⟨hs, hl⟩

/-- Enter child frame worlds for any `isFrame = true` matches (`frameChainResolver.ts:83-97`). -/
def enterFrames (env : ChainEnv) : List ChainMatch → ChainOutcome (List ChainMatch)
  | [] => .ok []
  | m :: rest =>
    if m.isFrame then
      match env.contentFrame m.world m.nodeId with
      | none => .error "Unable to obtain content frame"
      | some childFid =>
        match openWorld env childFid with
        | none => .error "Child frame detached"
        | some childWorld =>
          match enterFrames env rest with
          | .ok restScopes => .ok ({ world := childWorld, nodeId := 0, isFrame := false } :: restScopes)
          | other => other
    else
      match enterFrames env rest with
      | .ok restScopes => .ok (m :: restScopes)
      | other => other

/-- Query every scope strictly within its own `FrameWorld` (never mixing sessions). -/
def queryScopes (env : ChainEnv) (selector : String) (scopes : List ChainMatch) :
    List ChainMatch :=
  scopes.flatMap fun sc =>
    (env.queryWorld sc.world selector sc.nodeId).map fun (nid, isF) =>
      { world := sc.world, nodeId := nid, isFrame := isF }

/-- Execute one `ChainStep` over the current match list. -/
def execStep (env : ChainEnv) (stepIdx : Nat) (ms : List ChainMatch) (step : ChainStep) :
    ChainOutcome (List ChainMatch) :=
  if env.abortedAt stepIdx then
    .aborted
  else if ms.isEmpty then
    .notFound
  else
    match step with
    | .slice kind =>
      let sliced := sliceMatches kind ms
      if sliced.isEmpty then .notFound else .ok sliced
    | .query selector =>
      match enterFrames env ms with
      | .ok scopes =>
        let next := queryScopes env selector scopes
        if next.isEmpty then .notFound else .ok next
      | .notFound => .notFound
      | .error msg => .error msg
      | .aborted => .aborted
    | .frameHop selector =>
      if ms.any (fun m => !m.isFrame) then
        .error "Explicit frame hop requires an iframe or frame element"
      else
        match enterFrames env ms with
        | .ok scopes =>
          let next := queryScopes env selector scopes
          if next.isEmpty then .notFound else .ok next
        | .notFound => .notFound
        | .error msg => .error msg
        | .aborted => .aborted

/-- Execute an arbitrary-length `List ChainStep`. -/
def execSteps (env : ChainEnv) : Nat → List ChainMatch → List ChainStep →
    ChainOutcome (List ChainMatch)
  | _, ms, [] => .ok ms
  | k, ms, step :: rest =>
    match execStep env k ms step with
    | .ok ms' => execSteps env (k + 1) ms' rest
    | .notFound => .notFound
    | .error msg => .error msg
    | .aborted => .aborted

/-- Materialize matches into `ResolvedHandle`s, strictly binding each handle's session
    to its owning `FrameWorld`. -/
def materialize (env : ChainEnv) : List ChainMatch → ChainOutcome (List ResolvedHandle)
  | [] => .ok []
  | m :: rest =>
    match env.describeNode m.world m.nodeId with
    | none => .error "Node detached before describeNode"
    | some backendId =>
      match materialize env rest with
      | .ok hs =>
        .ok ({ sessionId := m.world.sessionId, frameId := m.world.frameId, backendNodeId := backendId } :: hs)
      | other => other

/-- Full chain resolution starting at `rootFrameId`. -/
def resolveChain (env : ChainEnv) (rootFrameId : FrameId) (steps : List ChainStep) :
    ChainOutcome (List ResolvedHandle) :=
  match openWorld env rootFrameId with
  | none => .error "Root frame detached"
  | some rootWorld =>
    match execSteps env 0 [{ world := rootWorld, nodeId := 0, isFrame := false }] steps with
    | .ok ms => materialize env ms
    | .notFound => .notFound
    | .error msg => .error msg
    | .aborted => .aborted

/-! ### Session isolation proofs (inductive over arbitrary `List ChainStep`) -/

theorem enterFrames_preserves_worldValid (env : ChainEnv) (ms scopes : List ChainMatch)
    (hvalid : ∀ m ∈ ms, worldValid env m.world)
    (hres : enterFrames env ms = .ok scopes) :
    ∀ sc ∈ scopes, worldValid env sc.world := by
  induction ms generalizing scopes with
  | nil =>
    cases hres
    intro sc hsc; cases hsc
  | cons m rest ih =>
    have hm : worldValid env m.world := hvalid m (List.mem_cons_self ..)
    have hrest : ∀ x ∈ rest, worldValid env x.world := fun x hx =>
      hvalid x (List.mem_cons_of_mem m hx)
    unfold enterFrames at hres
    split at hres
    · cases hcf : env.contentFrame m.world m.nodeId with
      | none => simp [hcf] at hres
      | some childFid =>
        simp only [hcf] at hres
        cases how : openWorld env childFid with
        | none => simp [how] at hres
        | some childWorld =>
          simp only [how] at hres
          cases hent : enterFrames env rest with
          | ok restScopes =>
            simp only [hent, ChainOutcome.ok.injEq] at hres
            subst scopes
            intro sc hsc
            rcases List.mem_cons.mp hsc with rfl | hmem
            · exact openWorld_valid env childFid childWorld how
            · exact ih restScopes hrest hent sc hmem
          | notFound => simp [hent] at hres
          | error _ => simp [hent] at hres
          | aborted => simp [hent] at hres
    · cases hent : enterFrames env rest with
      | ok restScopes =>
        simp only [hent, ChainOutcome.ok.injEq] at hres
        subst scopes
        intro sc hsc
        rcases List.mem_cons.mp hsc with rfl | hmem
        · exact hm
        · exact ih restScopes hrest hent sc hmem
      | notFound => simp [hent] at hres
      | error _ => simp [hent] at hres
      | aborted => simp [hent] at hres

theorem queryScopes_preserves_worldValid (env : ChainEnv) (sel : String) (scopes : List ChainMatch)
    (hvalid : ∀ sc ∈ scopes, worldValid env sc.world) :
    ∀ m ∈ queryScopes env sel scopes, worldValid env m.world := by
  intro m hm
  unfold queryScopes at hm
  rcases List.mem_flatMap.mp hm with ⟨sc, hsc, hm'⟩
  rcases List.mem_map.mp hm' with ⟨⟨nid, isF⟩, _, rfl⟩
  exact hvalid sc hsc

theorem execStep_preserves_worldValid (env : ChainEnv) (k : Nat) (ms ms' : List ChainMatch)
    (step : ChainStep)
    (hvalid : ∀ m ∈ ms, worldValid env m.world)
    (hres : execStep env k ms step = .ok ms') :
    ∀ m ∈ ms', worldValid env m.world := by
  unfold execStep at hres
  split at hres
  · cases hres
  · split at hres
    · cases hres
    · cases step with
      | slice kind =>
        dsimp only at hres
        split at hres
        · cases hres
        · cases hres
          intro m hm
          have hmem : m ∈ ms := (slice_bounds_sound kind ms).2.2 m hm
          exact hvalid m hmem
      | query sel =>
        dsimp only at hres
        cases hent : enterFrames env ms with
        | ok scopes =>
          rw [hent] at hres
          dsimp only at hres
          split at hres
          · cases hres
          · cases hres
            have hsc := enterFrames_preserves_worldValid env ms scopes hvalid hent
            exact queryScopes_preserves_worldValid env sel scopes hsc
        | notFound => rw [hent] at hres; cases hres
        | error _ => rw [hent] at hres; cases hres
        | aborted => rw [hent] at hres; cases hres
      | frameHop sel =>
        dsimp only at hres
        split at hres
        · cases hres
        · cases hent : enterFrames env ms with
          | ok scopes =>
            rw [hent] at hres
            dsimp only at hres
            split at hres
            · cases hres
            · cases hres
              have hsc := enterFrames_preserves_worldValid env ms scopes hvalid hent
              exact queryScopes_preserves_worldValid env sel scopes hsc
          | notFound => rw [hent] at hres; cases hres
          | error _ => rw [hent] at hres; cases hres
          | aborted => rw [hent] at hres; cases hres

theorem execSteps_preserves_worldValid (env : ChainEnv) (k : Nat) (steps : List ChainStep)
    (ms ms' : List ChainMatch)
    (hvalid : ∀ m ∈ ms, worldValid env m.world)
    (hres : execSteps env k ms steps = .ok ms') :
    ∀ m ∈ ms', worldValid env m.world := by
  induction steps generalizing k ms with
  | nil =>
    cases hres
    exact hvalid
  | cons step rest ih =>
    unfold execSteps at hres
    cases hstep : execStep env k ms step with
    | ok mid =>
      rw [hstep] at hres
      have hmid := execStep_preserves_worldValid env k ms mid step hvalid hstep
      exact ih (k + 1) mid hmid hres
    | notFound => rw [hstep] at hres; cases hres
    | error _ => rw [hstep] at hres; cases hres
    | aborted => rw [hstep] at hres; cases hres

theorem materialize_preserves_session (env : ChainEnv) (ms : List ChainMatch)
    (handles : List ResolvedHandle)
    (hvalid : ∀ m ∈ ms, worldValid env m.world)
    (hmat : materialize env ms = .ok handles) :
    ∀ h ∈ handles, env.frameSession h.frameId = some h.sessionId := by
  induction ms generalizing handles with
  | nil =>
    cases hmat
    intro h hh; cases hh
  | cons m rest ih =>
    have hm := hvalid m (List.mem_cons_self ..)
    have hrest : ∀ x ∈ rest, worldValid env x.world := fun x hx =>
      hvalid x (List.mem_cons_of_mem m hx)
    unfold materialize at hmat
    cases hdesc : env.describeNode m.world m.nodeId with
    | none => rw [hdesc] at hmat; cases hmat
    | some bid =>
      rw [hdesc] at hmat
      cases hrem : materialize env rest with
      | ok hs =>
        rw [hrem] at hmat
        cases hmat
        intro h hh
        rcases List.mem_cons.mp hh with rfl | hmem
        · exact hm.1
        · exact ih hs hrest hrem h hmem
      | notFound => rw [hrem] at hmat; cases hmat
      | error _ => rw [hrem] at hmat; cases hmat
      | aborted => rw [hrem] at hmat; cases hmat

/-- Theorem (Session Isolation): Over arbitrary chain lengths `List ChainStep` and arbitrary
    iframe nesting depths, every resolved handle's `sessionId` matches its frame's
    authoritative session. -/
theorem resolveChain_session_isolation (env : ChainEnv) (rootFrameId : FrameId)
    (steps : List ChainStep) (handles : List ResolvedHandle)
    (hres : resolveChain env rootFrameId steps = .ok handles) :
    ∀ h ∈ handles, env.frameSession h.frameId = some h.sessionId := by
  unfold resolveChain at hres
  cases how : openWorld env rootFrameId with
  | none => simp [how] at hres
  | some rootWorld =>
    simp only [how] at hres
    cases hex : execSteps env 0 [{ world := rootWorld, nodeId := 0, isFrame := false }] steps with
    | ok ms =>
      simp only [hex] at hres
      have hrootValid : ∀ m ∈ ([{ world := rootWorld, nodeId := 0, isFrame := false }] : List ChainMatch),
          worldValid env m.world := by
        intro m hm
        simp only [List.mem_singleton] at hm
        subst hm
        exact openWorld_valid env rootFrameId rootWorld how
      have hmsValid := execSteps_preserves_worldValid env 0 steps _ ms hrootValid hex
      exact materialize_preserves_session env ms handles hmsValid hres
    | notFound => simp [hex] at hres
    | error _ => simp [hex] at hres
    | aborted => simp [hex] at hres

/-! ### Bracketed `objectGroup` handle accounting -/

structure GroupState where
  /-- Currently allocated `(sessionId, objectGroupId)` handles across all CDP sessions. -/
  activeGroups : List (SessionId × ObjectGroupId)
  deriving DecidableEq, Repr

/-- Register handles allocated in `gid` across a list of touched sessions during chain work. -/
def acquireGroups (s : GroupState) (touchedSessions : List SessionId) (gid : ObjectGroupId) :
    GroupState :=
  { activeGroups := touchedSessions.map (fun sid => (sid, gid)) ++ s.activeGroups }

/-- Release all remote handles belonging to `gid` across all sessions (`dispose()`). -/
def releaseGroup (s : GroupState) (gid : ObjectGroupId) : GroupState :=
  { activeGroups := s.activeGroups.filter (fun p => p.2 != gid) }

/-- Bracketed execution (`try { ... } finally { dispose(); }`): runs a chain operation
    that allocates handles in a fresh `objectGroup` across arbitrarily many sessions and
    terminates with ANY outcome (`ok`, `notFound`, `error`, `aborted`), then releases `gid`. -/
def withObjectGroup {α : Type} (s₀ : GroupState) (gid : ObjectGroupId)
    (run : GroupState → ChainOutcome α × GroupState) :
    ChainOutcome α × GroupState :=
  let (outcome, sAfterWork) := run s₀
  (outcome, releaseGroup sAfterWork gid)

/-- Execute `resolveChain` inside a bracketed `objectGroup`, recording allocations across
    any list of touched sessions before releasing on exit. -/
def resolveChainWithGroup (env : ChainEnv) (rootFrameId : FrameId) (steps : List ChainStep)
    (s₀ : GroupState) (gid : ObjectGroupId) (touchedSessions : List SessionId) :
    ChainOutcome (List ResolvedHandle) × GroupState :=
  withObjectGroup s₀ gid fun s =>
    let sAlloc := acquireGroups s touchedSessions gid
    (resolveChain env rootFrameId steps, sAlloc)

private theorem filter_neq_append_eq {α : Type} [DecidableEq α] {β : Type} [DecidableEq β]
    (xs : List α) (g : β) (ys : List (α × β))
    (hfresh : ∀ p ∈ ys, p.2 ≠ g) :
    (xs.map (fun x => (x, g)) ++ ys).filter (fun p => p.2 != g) = ys := by
  rw [List.filter_append]
  have h1 : (xs.map (fun x => (x, g))).filter (fun p => p.2 != g) = [] := by
    induction xs with
    | nil => rfl
    | cons x rest ih =>
      simp [ih]
  have h2 : ys.filter (fun p => p.2 != g) = ys := by
    induction ys with
    | nil => rfl
    | cons p rest ih =>
      have hp : p.2 ≠ g := hfresh p (List.mem_cons_self ..)
      have hrest : ∀ q ∈ rest, q.2 ≠ g := fun q hq => hfresh q (List.mem_cons_of_mem p hq)
      have hb : (p.2 != g) = true := by
        simp [bne_iff_ne, hp]
      simp [hb, ih hrest]
  rw [h1, h2, List.nil_append]

/-- Theorem (Zero `objectGroup` Leak): Executing any locator chain under bracketed
    `withObjectGroup` with a fresh group ID leaves `activeGroups` unchanged across ALL
    outcomes (`ok`, `notFound`, `error`, `aborted`) and any number of touched sessions. -/
theorem resolveChain_zero_objectGroup_leak (env : ChainEnv) (rootFrameId : FrameId)
    (steps : List ChainStep) (s₀ : GroupState) (gid : ObjectGroupId)
    (touchedSessions : List SessionId)
    (hfresh : ∀ p ∈ s₀.activeGroups, p.2 ≠ gid) :
    (resolveChainWithGroup env rootFrameId steps s₀ gid touchedSessions).2 = s₀ := by
  unfold resolveChainWithGroup withObjectGroup acquireGroups releaseGroup
  dsimp only
  cases s₀ with
  | mk gs =>
    dsimp only at hfresh ⊢
    congr 1
    exact filter_neq_append_eq touchedSessions gid gs hfresh

end StagehandProofs.LocatorChain
