/-
  StagehandProofs.CacheSafety

  Formal model and inductive safety proofs for Stagehand's unified `act()` / `withCache`
  execution state machine (`packages/extension/services/cacheService.ts`,
  `packages/extension/services/actService.ts`).

  Proves inductively over ALL finite event traces `List ActEvent`:
  1. `at_most_one_committed_route`: once any route (`CacheReplay`, `WebMCP`, `DomAct`)
     dispatches a side effect, no competing route can ever commit.
  2. `no_cache_write_on_recovery_or_failure`: failed, aborted, or recovered runs can
     never write to cache.
  3. `abort_prevents_new_dispatch`: once `stopSignal` is set, `domDispatched` never
     increases and no new route commits.
  4. `dispatched_within_plan`: `domDispatched ≤ plannedSteps` across every reachable state.

  Discrepancies surfaced against `cacheService.ts` / `actService.ts` on `main`:
  - `replayCachedActions` (`actService.ts:265-276`) + `withCache` (`cacheService.ts:265-318`):
    if a multi-action cached replay succeeds on action 1 (mutating the DOM) and fails on
    action 2, `withCache` catches the error and falls back to full LLM `DomAct` (two routes
    committing side effects), and then writes the post-mutation result under the pre-mutation
    `baseRequest.cdpTree`.
  - `selfHealAction` (`actService.ts:388-468`): after self-heal recovery succeeds,
    `cacheValue` is still populated and written to cache.
  - Two-step `runActPipeline` (`actService.ts:188-245`): when `firstInference.response.twoStep`
    is true and `firstResult.success` is false, step 2 still captures a snapshot, calls the LLM,
    and executes a second action.
-/

namespace StagehandProofs.CacheSafety

inductive ActRoute where
  | cacheReplay
  | webMCP
  | domAct
  deriving DecidableEq, Repr

inductive RunStatus where
  | running
  | succeeded
  | failed
  | aborted
  deriving DecidableEq, Repr

structure ActState where
  /-- First route to dispatch an irreversible side effect (latched once set). -/
  committedRoute : Option ActRoute
  /-- Planned number of DOM steps for `DomAct`. -/
  plannedSteps : Nat
  /-- Number of DOM actions actually dispatched. -/
  domDispatched : Nat
  /-- Whether an action is currently executing in flight. -/
  inFlight : Bool
  /-- Whether cancellation / timeout (`Progress.signal`) has fired. -/
  stopSignal : Bool
  /-- Whether cache persistence is still permitted for this run. -/
  cacheEligible : Bool
  /-- Whether the run entered a recovery / fallback path. -/
  recovered : Bool
  /-- Whether a cache entry has been written by this run. -/
  cacheWritten : Bool
  /-- Lifecycle status of the run. -/
  status : RunStatus
  deriving DecidableEq, Repr

inductive ActEvent where
  | planSteps (n : Nat)
  | dispatchSideEffect (route : ActRoute)
  | completeInFlight (ok : Bool)
  | enterRecovery
  | triggerStop
  | finishSuccess
  | finishFailure
  | writeCache
  deriving DecidableEq, Repr

def ActState.init (cacheEligible : Bool) : ActState where
  committedRoute := none
  plannedSteps := 0
  domDispatched := 0
  inFlight := false
  stopSignal := false
  cacheEligible := cacheEligible
  recovered := false
  cacheWritten := false
  status := .running

def routeCompatible (committed : Option ActRoute) (route : ActRoute) : Bool :=
  match committed with
  | none => true
  | some r => decide (r = route)

def budgetAllows (s : ActState) (route : ActRoute) : Bool :=
  match route with
  | .domAct => decide (s.domDispatched < s.plannedSteps)
  | .cacheReplay => true
  | .webMCP => true

/-- Guarded single-step transition of the unified `act()` / `withCache` state machine. -/
def step (s : ActState) (ev : ActEvent) : ActState :=
  match ev with
  | .planSteps n =>
    if s.status = .running ∧ s.stopSignal = false ∧ s.domDispatched = 0 ∧ s.committedRoute = none then
      { s with plannedSteps := n }
    else
      s
  | .dispatchSideEffect route =>
    if s.status = .running ∧ s.stopSignal = false ∧ s.inFlight = false ∧
       routeCompatible s.committedRoute route = true ∧ budgetAllows s route = true then
      { s with
        committedRoute := some route
        inFlight := true
        domDispatched := if route = .domAct then s.domDispatched + 1 else s.domDispatched }
    else
      s
  | .completeInFlight ok =>
    if s.inFlight = true then
      if ok then
        { s with inFlight := false }
      else
        { s with inFlight := false, status := .failed, cacheEligible := false }
    else
      s
  | .enterRecovery =>
    if s.status = .running then
      { s with recovered := true, cacheEligible := false }
    else
      s
  | .triggerStop =>
    if s.status = .running then
      { s with stopSignal := true, status := .aborted, cacheEligible := false }
    else
      s
  | .finishSuccess =>
    if s.status = .running ∧ s.stopSignal = false ∧ s.inFlight = false then
      { s with status := .succeeded }
    else
      s
  | .finishFailure =>
    if s.status = .running then
      { s with status := .failed, cacheEligible := false }
    else
      s
  | .writeCache =>
    if s.status = .succeeded ∧ s.stopSignal = false ∧ s.recovered = false ∧ s.cacheEligible = true then
      { s with cacheWritten := true }
    else
      s

def runTrace (s : ActState) (evs : List ActEvent) : ActState :=
  evs.foldl step s

/-! ### Inductive Invariant -/

/-- Combined reachable-state invariant. -/
structure SafeState (s : ActState) : Prop where
  dispatched_le_plan : s.domDispatched ≤ s.plannedSteps
  succeeded_not_inFlight : s.status = .succeeded → s.inFlight = false
  cacheWrite_requires_clean_success :
    s.cacheWritten = true →
      s.status = .succeeded ∧ s.stopSignal = false ∧ s.recovered = false ∧ s.cacheEligible = true

theorem init_safe (eligible : Bool) : SafeState (ActState.init eligible) where
  dispatched_le_plan := Nat.le_refl 0
  succeeded_not_inFlight := by intro h; cases h
  cacheWrite_requires_clean_success := by intro h; cases h

theorem step_preserves_safe (s : ActState) (ev : ActEvent) (hs : SafeState s) :
    SafeState (step s ev) := by
  cases ev with
  | planSteps n =>
    simp only [step]
    split
    · rename_i h
      rcases h with ⟨_, _, hzero, _⟩
      exact
        { dispatched_le_plan := by simp [hzero]
          succeeded_not_inFlight := hs.succeeded_not_inFlight
          cacheWrite_requires_clean_success := hs.cacheWrite_requires_clean_success }
    · exact hs
  | dispatchSideEffect route =>
    simp only [step]
    split
    · rename_i h
      rcases h with ⟨hrun, _, _, _, hbudget⟩
      refine
        { dispatched_le_plan := ?_
          succeeded_not_inFlight := by intro hsuc; rw [hrun] at hsuc; cases hsuc
          cacheWrite_requires_clean_success := hs.cacheWrite_requires_clean_success }
      cases route with
      | domAct =>
        simp only [budgetAllows, decide_eq_true_eq] at hbudget
        simp only [↓reduceIte]
        omega
      | cacheReplay =>
        simpa using hs.dispatched_le_plan
      | webMCP =>
        simpa using hs.dispatched_le_plan
    · exact hs
  | completeInFlight ok =>
    simp only [step]
    split
    · rename_i hinf
      split
      · exact
          { dispatched_le_plan := hs.dispatched_le_plan
            succeeded_not_inFlight := fun _ => rfl
            cacheWrite_requires_clean_success := hs.cacheWrite_requires_clean_success }
      · exact
          { dispatched_le_plan := hs.dispatched_le_plan
            succeeded_not_inFlight := by intro h; cases h
            cacheWrite_requires_clean_success := by
              intro hw
              have hclean := hs.cacheWrite_requires_clean_success hw
              have hnotInf := hs.succeeded_not_inFlight hclean.1
              rw [hnotInf] at hinf
              cases hinf }
    · exact hs
  | enterRecovery =>
    simp only [step]
    split
    · rename_i hrun
      exact
        { dispatched_le_plan := hs.dispatched_le_plan
          succeeded_not_inFlight := hs.succeeded_not_inFlight
          cacheWrite_requires_clean_success := by
            intro hw
            have h := hs.cacheWrite_requires_clean_success hw
            rw [hrun] at h
            cases h.1 }
    · exact hs
  | triggerStop =>
    simp only [step]
    split
    · rename_i hrun
      exact
        { dispatched_le_plan := hs.dispatched_le_plan
          succeeded_not_inFlight := by intro h; cases h
          cacheWrite_requires_clean_success := by
            intro hw
            have h := hs.cacheWrite_requires_clean_success hw
            rw [hrun] at h
            cases h.1 }
    · exact hs
  | finishSuccess =>
    simp only [step]
    split
    · rename_i h
      rcases h with ⟨hrun, _, hnotInf⟩
      exact
        { dispatched_le_plan := hs.dispatched_le_plan
          succeeded_not_inFlight := fun _ => hnotInf
          cacheWrite_requires_clean_success := by
            intro hw
            have h0 := hs.cacheWrite_requires_clean_success hw
            rw [hrun] at h0
            cases h0.1 }
    · exact hs
  | finishFailure =>
    simp only [step]
    split
    · rename_i hrun
      exact
        { dispatched_le_plan := hs.dispatched_le_plan
          succeeded_not_inFlight := by intro h; cases h
          cacheWrite_requires_clean_success := by
            intro hw
            have h := hs.cacheWrite_requires_clean_success hw
            rw [hrun] at h
            cases h.1 }
    · exact hs
  | writeCache =>
    simp only [step]
    split
    · rename_i h
      rcases h with ⟨hsuc, hstop, hrec, helig⟩
      exact
        { dispatched_le_plan := hs.dispatched_le_plan
          succeeded_not_inFlight := hs.succeeded_not_inFlight
          cacheWrite_requires_clean_success := fun _ => ⟨hsuc, hstop, hrec, helig⟩ }
    · exact hs

theorem runTrace_preserves_safe (s : ActState) (evs : List ActEvent) (hs : SafeState s) :
    SafeState (runTrace s evs) := by
  induction evs generalizing s with
  | nil => exact hs
  | cons ev rest ih =>
    exact ih (step s ev) (step_preserves_safe s ev hs)

/-! ### Main Safety Theorems over ALL finite traces `List ActEvent` -/

private theorem step_committedRoute_stable (s : ActState) (r : ActRoute) (ev : ActEvent)
    (hc : s.committedRoute = some r) :
    (step s ev).committedRoute = some r := by
  cases ev with
  | planSteps n => simp only [step]; split <;> exact hc
  | dispatchSideEffect route =>
    simp only [step]
    split
    · rename_i h
      rcases h with ⟨_, _, _, hcompat, _⟩
      rw [hc] at hcompat
      simp only [routeCompatible, decide_eq_true_eq] at hcompat
      subst route
      rfl
    · exact hc
  | completeInFlight ok =>
    simp only [step]
    split
    · split <;> exact hc
    · exact hc
  | enterRecovery => simp only [step]; split <;> exact hc
  | triggerStop => simp only [step]; split <;> exact hc
  | finishSuccess => simp only [step]; split <;> exact hc
  | finishFailure => simp only [step]; split <;> exact hc
  | writeCache => simp only [step]; split <;> exact hc

/-- Theorem 1 (`at_most_one_committed_route`): Once any route dispatches a side effect,
    no competing route can ever commit in any finite continuation `List ActEvent`. -/
theorem at_most_one_committed_route (s : ActState) (r : ActRoute) (evs : List ActEvent)
    (hc : s.committedRoute = some r) :
    (runTrace s evs).committedRoute = some r := by
  induction evs generalizing s with
  | nil => exact hc
  | cons ev rest ih =>
    exact ih (step s ev) (step_committedRoute_stable s r ev hc)

/-- Corollary of Theorem 1: No competing route `r' ≠ r` can ever commit after `r`. -/
theorem no_competing_route_commits (s : ActState) (r r' : ActRoute) (evs : List ActEvent)
    (hc : s.committedRoute = some r) (hne : r' ≠ r) :
    (runTrace s evs).committedRoute ≠ some r' := by
  rw [at_most_one_committed_route s r evs hc]
  intro h
  cases h
  exact hne rfl

/-- Theorem 2 (`no_cache_write_on_recovery_or_failure`): Starting from `ActState.init`,
    any failed, aborted, stopped, recovered, or cache-ineligible run can never write to cache. -/
theorem no_cache_write_on_recovery_or_failure (eligible : Bool) (evs : List ActEvent)
    (hbad :
      let s' := runTrace (ActState.init eligible) evs
      s'.status = .failed ∨ s'.status = .aborted ∨ s'.recovered = true ∨
      s'.stopSignal = true ∨ s'.cacheEligible = false) :
    (runTrace (ActState.init eligible) evs).cacheWritten = false := by
  have hsafe := runTrace_preserves_safe (ActState.init eligible) evs (init_safe eligible)
  cases hw : (runTrace (ActState.init eligible) evs).cacheWritten with
  | false => rfl
  | true =>
    exfalso
    have hclean := hsafe.cacheWrite_requires_clean_success hw
    rcases hbad with h | h | h | h | h
    · rw [hclean.1] at h; cases h
    · rw [hclean.1] at h; cases h
    · rw [hclean.2.2.1] at h; cases h
    · rw [hclean.2.1] at h; cases h
    · rw [hclean.2.2.2] at h; cases h

private theorem step_after_stop (s : ActState) (ev : ActEvent) (hstop : s.stopSignal = true) :
    (step s ev).domDispatched = s.domDispatched ∧
    (step s ev).stopSignal = true ∧
    (step s ev).committedRoute = s.committedRoute := by
  cases ev with
  | planSteps n => simp only [step]; split <;> exact ⟨rfl, hstop, rfl⟩
  | dispatchSideEffect route =>
    simp [step, hstop]
  | completeInFlight ok =>
    simp only [step]
    split
    · split <;> exact ⟨rfl, hstop, rfl⟩
    · exact ⟨rfl, hstop, rfl⟩
  | enterRecovery => simp only [step]; split <;> exact ⟨rfl, hstop, rfl⟩
  | triggerStop => simp only [step]; split <;> exact ⟨rfl, by simp [hstop], rfl⟩
  | finishSuccess => simp [step, hstop]
  | finishFailure => simp only [step]; split <;> exact ⟨rfl, hstop, rfl⟩
  | writeCache => simp [step, hstop]

/-- Theorem 3 (`abort_prevents_new_dispatch`): Once `stopSignal` is set, no finite
    continuation can ever increase `domDispatched`, clear `stopSignal`, or commit a new route. -/
theorem abort_prevents_new_dispatch (s : ActState) (evs : List ActEvent)
    (hstop : s.stopSignal = true) :
    (runTrace s evs).domDispatched = s.domDispatched ∧
    (runTrace s evs).stopSignal = true ∧
    (runTrace s evs).committedRoute = s.committedRoute := by
  induction evs generalizing s with
  | nil => exact ⟨rfl, hstop, rfl⟩
  | cons ev rest ih =>
    rcases step_after_stop s ev hstop with ⟨hdisp, hstop', hcomm⟩
    rcases ih (step s ev) hstop' with ⟨hdisp2, hstop2, hcomm2⟩
    exact ⟨hdisp2.trans hdisp, hstop2, hcomm2.trans hcomm⟩

/-- Theorem 4 (`dispatched_within_plan`): Across all finite traces from initialization,
    `domDispatched ≤ plannedSteps`. -/
theorem dispatched_within_plan (eligible : Bool) (evs : List ActEvent) :
    (runTrace (ActState.init eligible) evs).domDispatched ≤
      (runTrace (ActState.init eligible) evs).plannedSteps :=
  (runTrace_preserves_safe (ActState.init eligible) evs (init_safe eligible)).dispatched_le_plan

end StagehandProofs.CacheSafety
