/-
  StagehandProofs.FrameTree

  Formal model and inductive invariant proofs for Stagehand's `FrameRegistry`
  (`packages/extension/understudy/frameRegistry.ts`).

  Proves inductively over ALL finite event histories `List FrameEvent` (unbounded tree
  depth and unbounded trace length) that `WellFormed` is preserved:
  1. Root exists and has no parent.
  2. Every non-root present frame has a present parent.
  3. Absent frames have no parent, no children, and no session owner.
  4. Parent-child symmetry (`parentOf c = some p ↔ childrenOf p c = true`).
  5. Session ownership bijection (`sessionFrames s f = true ↔ ownerOf f = some s`).
  6. Strict acyclicity (existence of a strictly decreasing ancestor depth witness,
     which rules out all finite cycles and ensures every frame reaches `rootId`).

  Discrepancies surfaced against `packages/extension/understudy/frameRegistry.ts` on `main`:
  - `onFrameAttached` does not unlink an existing parent before reparenting and performs no
    ancestor/cycle check (breaking parent-child symmetry and risking infinite DFS recursion).
  - `onFrameNavigated` calls `ensureNode(frame.id)` + `setOwnerSessionIdInternal(frame.id, sid)`
    before `renameNodeId(this.rootFrameId, frame.id)`, which overwrites `frames[frame.id]` with
    the old root's `FrameInfo`, clobbering `lastSeen` and breaking the `framesBySession` bijection.
  - `onFrameDetached` on `rootFrameId` empties `frames` while leaving `rootFrameId` dangling.
-/

namespace StagehandProofs.FrameTree

abbrev FrameId := Nat
abbrev SessionId := Nat

structure FrameTree where
  rootId : FrameId
  present : FrameId → Bool
  parentOf : FrameId → Option FrameId
  childrenOf : FrameId → FrameId → Bool
  ownerOf : FrameId → Option SessionId
  sessionFrames : SessionId → FrameId → Bool
  maxDepth : Nat

inductive FrameEvent where
  | attachChild (child parent : FrameId) (session : SessionId)
  | reparentNonDescendant (child newParent : FrameId)
  | detachSubtree (target : FrameId)
  | adoptSession (target : FrameId) (session : SessionId)
  | renameNodeId (oldId newId : FrameId)
  deriving DecidableEq, Repr

/-- `IsAncestor t a c` holds when `a` is a strict ancestor of `c` via `parentOf` links. -/
inductive IsAncestor (t : FrameTree) : FrameId → FrameId → Prop where
  | direct {p c : FrameId} : t.parentOf c = some p → IsAncestor t p c
  | step {a p c : FrameId} : t.parentOf c = some p → IsAncestor t a p → IsAncestor t a c

/-- Computable bounded parent-chain walk to test strict ancestry. -/
def walkUp (parentOf : FrameId → Option FrameId) : Nat → FrameId → FrameId → Bool
  | 0, _, _ => false
  | fuel + 1, anc, curr =>
    match parentOf curr with
    | none => false
    | some p => if p == anc then true else walkUp parentOf fuel anc p

def isAncestorBool (t : FrameTree) (anc curr : FrameId) : Bool :=
  walkUp t.parentOf (t.maxDepth + 1) anc curr

def inSubtreeBool (t : FrameTree) (target x : FrameId) : Bool :=
  (x == target) || isAncestorBool t target x

/-- Structural well-formedness invariant of `FrameRegistry`. -/
structure WellFormed (t : FrameTree) : Prop where
  root_present : t.present t.rootId = true
  root_no_parent : t.parentOf t.rootId = none
  nonroot_has_parent : ∀ f, t.present f = true → f ≠ t.rootId →
    ∃ p, t.parentOf f = some p ∧ t.present p = true
  absent_no_parent : ∀ f, t.present f = false → t.parentOf f = none
  absent_no_children : ∀ f c, t.present f = false → t.childrenOf f c = false
  absent_no_owner : ∀ f, t.present f = false → t.ownerOf f = none
  parent_child_symm : ∀ p c, t.parentOf c = some p ↔ t.childrenOf p c = true
  session_bijection : ∀ s f, t.sessionFrames s f = true ↔ t.ownerOf f = some s
  acyclic : ∃ depth : FrameId → Nat,
    (∀ c p, t.parentOf c = some p → depth p < depth c) ∧
    (∀ f, t.present f = true → depth f ≤ t.maxDepth)

/-! ### Initial state -/

def FrameTree.init (rootId : FrameId) : FrameTree where
  rootId := rootId
  present := fun f => f == rootId
  parentOf := fun _ => none
  childrenOf := fun _ _ => false
  ownerOf := fun _ => none
  sessionFrames := fun _ _ => false
  maxDepth := 0

theorem init_wellFormed (rootId : FrameId) : WellFormed (FrameTree.init rootId) where
  root_present := by simp [FrameTree.init]
  root_no_parent := rfl
  nonroot_has_parent := by
    intro f hf hne
    simp [FrameTree.init] at hf
    exact absurd hf hne
  absent_no_parent := fun _ _ => rfl
  absent_no_children := fun _ _ _ => rfl
  absent_no_owner := fun _ _ => rfl
  parent_child_symm := by intro p c; simp [FrameTree.init]
  session_bijection := by intro s f; simp [FrameTree.init]
  acyclic := ⟨fun _ => 0, by intro c p h; simp [FrameTree.init] at h, fun _ _ => Nat.le_refl 0⟩

/-! ### Ancestry and acyclicity lemmas -/

theorem isAncestor_depth_lt {t : FrameTree} {depth : FrameId → Nat}
    (hdec : ∀ c p, t.parentOf c = some p → depth p < depth c)
    {a c : FrameId} (h : IsAncestor t a c) :
    depth a < depth c := by
  induction h with
  | direct hp => exact hdec _ _ hp
  | step hp _ ih => exact Nat.lt_trans ih (hdec _ _ hp)

/-- No node in a well-formed frame tree can be its own ancestor (no cycles of any length). -/
theorem wellFormed_no_cycles {t : FrameTree} (hwf : WellFormed t) (f : FrameId) :
    ¬ IsAncestor t f f := by
  intro h
  rcases hwf.acyclic with ⟨depth, hdec, _⟩
  exact Nat.lt_irrefl (depth f) (isAncestor_depth_lt hdec h)

theorem walkUp_sound {t : FrameTree} :
    ∀ fuel anc curr, walkUp t.parentOf fuel anc curr = true → IsAncestor t anc curr
  | 0, _, _, h => by cases h
  | fuel + 1, anc, curr, h => by
    unfold walkUp at h
    cases hp : t.parentOf curr with
    | none => rw [hp] at h; cases h
    | some p =>
      rw [hp] at h
      dsimp only at h
      by_cases hpa : p = anc
      · subst hpa; exact IsAncestor.direct hp
      · have hbeq : (p == anc) = false := beq_false_of_ne hpa
        rw [hbeq] at h
        simp only [Bool.false_eq_true, ↓reduceIte] at h
        exact IsAncestor.step hp (walkUp_sound fuel anc p h)

theorem walkUp_complete {t : FrameTree} {depth : FrameId → Nat}
    (hdec : ∀ c p, t.parentOf c = some p → depth p < depth c)
    {anc curr : FrameId} (hanc : IsAncestor t anc curr) :
    ∀ fuel, depth curr < fuel → walkUp t.parentOf fuel anc curr = true := by
  induction hanc with
  | direct hp =>
    intro fuel hlt
    have hdp := hdec _ _ hp
    cases fuel with
    | zero => omega
    | succ fuel' =>
      simp [walkUp, hp]
  | @step p c hp _ ih =>
    intro fuel hlt
    have hdp := hdec c p hp
    cases fuel with
    | zero => omega
    | succ fuel' =>
      simp only [walkUp, hp]
      by_cases hpa : p = anc
      · simp [hpa]
      · have hbeq : (p == anc) = false := beq_false_of_ne hpa
        rw [hbeq]
        simp only [Bool.false_eq_true, ↓reduceIte]
        exact ih fuel' (by omega)

theorem isAncestorBool_iff {t : FrameTree} (hwf : WellFormed t) (anc curr : FrameId) :
    isAncestorBool t anc curr = true ↔ IsAncestor t anc curr := by
  constructor
  · exact walkUp_sound (t.maxDepth + 1) anc curr
  · intro hanc
    rcases hwf.acyclic with ⟨depth, hdec, hbound⟩
    have hcurrPresent : t.present curr = true := by
      cases hp : t.present curr with
      | true => rfl
      | false =>
        exfalso
        have hnone := hwf.absent_no_parent curr hp
        cases hanc with
        | direct h => rw [hnone] at h; cases h
        | step h _ => rw [hnone] at h; cases h
    have hle := hbound curr hcurrPresent
    exact walkUp_complete hdec hanc (t.maxDepth + 1) (by omega)

theorem inSubtreeBool_iff {t : FrameTree} (hwf : WellFormed t) (target x : FrameId) :
    inSubtreeBool t target x = true ↔ x = target ∨ IsAncestor t target x := by
  simp [inSubtreeBool, isAncestorBool_iff hwf]

theorem inSubtreeBool_false_iff {t : FrameTree} (hwf : WellFormed t) (target x : FrameId) :
    inSubtreeBool t target x = false ↔ ¬ (x = target ∨ IsAncestor t target x) := by
  cases hb : inSubtreeBool t target x
  · constructor
    · intro _ h; have := (inSubtreeBool_iff hwf target x).mpr h; rw [hb] at this; cases this
    · intro _; rfl
  · constructor
    · intro h; cases h
    · intro h; exact absurd ((inSubtreeBool_iff hwf target x).mp hb) h

/-- Every present node reaches `rootId` (either is `rootId` or has `rootId` as a strict ancestor). -/
theorem wellFormed_reaches_root {t : FrameTree} (hwf : WellFormed t) :
    ∀ f, t.present f = true → f = t.rootId ∨ IsAncestor t t.rootId f := by
  rcases hwf.acyclic with ⟨depth, hdec, _⟩
  have go : ∀ k f, depth f ≤ k → t.present f = true → f = t.rootId ∨ IsAncestor t t.rootId f := by
    intro k
    induction k with
    | zero =>
      intro f hle hp
      by_cases hroot : f = t.rootId
      · exact Or.inl hroot
      · rcases hwf.nonroot_has_parent f hp hroot with ⟨p, hpf, _⟩
        have := hdec f p hpf
        omega
    | succ k ih =>
      intro f hle hp
      by_cases hroot : f = t.rootId
      · exact Or.inl hroot
      · rcases hwf.nonroot_has_parent f hp hroot with ⟨p, hpf, hpp⟩
        have hlt := hdec f p hpf
        rcases ih p (by omega) hpp with rfl | hanc
        · exact Or.inr (IsAncestor.direct hpf)
        · exact Or.inr (IsAncestor.step hpf hanc)
  intro f hp
  exact go (depth f) f (Nat.le_refl _) hp

/-! ### Individual guarded transitions -/

def attachChild (t : FrameTree) (child parent : FrameId) (session : SessionId) : FrameTree :=
  if t.present parent && !t.present child then
    { rootId := t.rootId
      present := fun f => if f == child then true else t.present f
      parentOf := fun f => if f == child then some parent else t.parentOf f
      childrenOf := fun p c => if p == parent && c == child then true else t.childrenOf p c
      ownerOf := fun f => if f == child then some session else t.ownerOf f
      sessionFrames := fun s f => if f == child then s == session else t.sessionFrames s f
      maxDepth := t.maxDepth + 1 }
  else
    t

def reparentNonDescendant (t : FrameTree) (child newParent : FrameId) : FrameTree :=
  if t.present child && t.present newParent &&
     !(child == t.rootId) && !(child == newParent) && !isAncestorBool t child newParent then
    { rootId := t.rootId
      present := t.present
      parentOf := fun f => if f == child then some newParent else t.parentOf f
      childrenOf := fun p c =>
        if c == child then p == newParent else t.childrenOf p c
      ownerOf := t.ownerOf
      sessionFrames := t.sessionFrames
      maxDepth := t.maxDepth + t.maxDepth + 1 }
  else
    t

def detachSubtree (t : FrameTree) (target : FrameId) : FrameTree :=
  if t.present target && !(target == t.rootId) then
    { rootId := t.rootId
      present := fun f => if inSubtreeBool t target f then false else t.present f
      parentOf := fun f => if inSubtreeBool t target f then none else t.parentOf f
      childrenOf := fun p c =>
        if inSubtreeBool t target p || inSubtreeBool t target c then false else t.childrenOf p c
      ownerOf := fun f => if inSubtreeBool t target f then none else t.ownerOf f
      sessionFrames := fun s f => if inSubtreeBool t target f then false else t.sessionFrames s f
      maxDepth := t.maxDepth }
  else
    t

def adoptSession (t : FrameTree) (target : FrameId) (session : SessionId) : FrameTree :=
  if t.present target then
    { t with
      ownerOf := fun f => if f == target then some session else t.ownerOf f
      sessionFrames := fun s f => if f == target then s == session else t.sessionFrames s f }
  else
    t

/-- Involution swapping `oldId` and `newId`. -/
def swapId (oldId newId x : FrameId) : FrameId :=
  if x == oldId then newId else if x == newId then oldId else x

theorem swapId_invol (oldId newId x : FrameId) :
    swapId oldId newId (swapId oldId newId x) = x := by
  unfold swapId
  by_cases h1 : x = oldId
  · subst x
    by_cases h2 : oldId = newId
    · subst oldId; simp
    · have hne : (newId == oldId) = false := beq_false_of_ne (Ne.symm h2)
      simp [hne]
  · by_cases h2 : x = newId
    · subst x
      have hne : (newId == oldId) = false := beq_false_of_ne h1
      simp [hne]
    · have hne1 : (x == oldId) = false := beq_false_of_ne h1
      have hne2 : (x == newId) = false := beq_false_of_ne h2
      simp [hne1, hne2]

def renameNodeId (t : FrameTree) (oldId newId : FrameId) : FrameTree :=
  if t.present oldId && !t.present newId then
    let bij := swapId oldId newId
    { rootId := bij t.rootId
      present := fun f => t.present (bij f)
      parentOf := fun f => (t.parentOf (bij f)).map bij
      childrenOf := fun p c => t.childrenOf (bij p) (bij c)
      ownerOf := fun f => t.ownerOf (bij f)
      sessionFrames := fun s f => t.sessionFrames s (bij f)
      maxDepth := t.maxDepth }
  else
    t

def applyEvent (t : FrameTree) : FrameEvent → FrameTree
  | .attachChild child parent session => attachChild t child parent session
  | .reparentNonDescendant child newParent => reparentNonDescendant t child newParent
  | .detachSubtree target => detachSubtree t target
  | .adoptSession target session => adoptSession t target session
  | .renameNodeId oldId newId => renameNodeId t oldId newId

def runEvents (t : FrameTree) (events : List FrameEvent) : FrameTree :=
  events.foldl applyEvent t

/-! ### Preservation proofs -/

theorem attachChild_preserves_wellFormed (t : FrameTree) (child parent : FrameId)
    (session : SessionId) (hwf : WellFormed t) :
    WellFormed (attachChild t child parent session) := by
  unfold attachChild
  split
  · rename_i hcond
    simp only [Bool.and_eq_true, Bool.not_eq_true'] at hcond
    rcases hcond with ⟨hpPresent, hcAbsent⟩
    have hcr : child ≠ t.rootId := by
      intro h; subst h; rw [hwf.root_present] at hcAbsent; cases hcAbsent
    have hpc : parent ≠ child := by
      intro h; subst h; rw [hpPresent] at hcAbsent; cases hcAbsent
    refine
      { root_present := by
          have : (t.rootId == child) = false := beq_false_of_ne (Ne.symm hcr)
          simp [this, hwf.root_present]
        root_no_parent := by
          have : (t.rootId == child) = false := beq_false_of_ne (Ne.symm hcr)
          simp [this, hwf.root_no_parent]
        nonroot_has_parent := by
          intro f hf hne
          by_cases hfc : f = child
          · subst f
            refine ⟨parent, by simp, ?_⟩
            have : (parent == child) = false := beq_false_of_ne hpc
            simp [this, hpPresent]
          · have hneq : (f == child) = false := beq_false_of_ne hfc
            simp only [hneq, Bool.false_eq_true, ↓reduceIte] at hf ⊢
            rcases hwf.nonroot_has_parent f hf hne with ⟨p, hpf, hpp⟩
            refine ⟨p, hpf, ?_⟩
            by_cases hpc' : p = child
            · subst p; rw [hpp] at hcAbsent; cases hcAbsent
            · simp [beq_false_of_ne hpc', hpp]
        absent_no_parent := by
          intro f hf
          by_cases hfc : f = child
          · subst f; simp at hf
          · have hneq : (f == child) = false := beq_false_of_ne hfc
            simp only [hneq, Bool.false_eq_true, ↓reduceIte] at hf ⊢
            exact hwf.absent_no_parent f hf
        absent_no_children := by
          intro f c hf
          by_cases hfc : f = child
          · subst f; simp at hf
          · have hneq : (f == child) = false := beq_false_of_ne hfc
            simp only [hneq, Bool.false_eq_true, ↓reduceIte] at hf
            have hfp : f ≠ parent := by
              intro h; subst f; rw [hpPresent] at hf; cases hf
            simp [beq_false_of_ne hfp, hwf.absent_no_children f c hf]
        absent_no_owner := by
          intro f hf
          by_cases hfc : f = child
          · subst f; simp at hf
          · have hneq : (f == child) = false := beq_false_of_ne hfc
            simp only [hneq, Bool.false_eq_true, ↓reduceIte] at hf ⊢
            exact hwf.absent_no_owner f hf
        parent_child_symm := by
          intro p c
          by_cases hcc : c = child
          · subst c
            have hnotOld : t.childrenOf p child = false := by
              cases hch : t.childrenOf p child with
              | false => rfl
              | true =>
                have hpar := (hwf.parent_child_symm p child).mpr hch
                rw [hwf.absent_no_parent child hcAbsent] at hpar
                cases hpar
            simp only [beq_self_eq_true, ↓reduceIte, Bool.and_true, hnotOld, Option.some.injEq]
            constructor
            · intro h; simp [h]
            · intro h
              split at h
              · rename_i heq; exact (beq_iff_eq.mp heq).symm
              · cases h
          · have hneq : (c == child) = false := beq_false_of_ne hcc
            simp [hneq, hwf.parent_child_symm p c]
        session_bijection := by
          intro s f
          by_cases hfc : f = child
          · subst f
            simp only [beq_self_eq_true, ↓reduceIte, beq_iff_eq, Option.some.injEq]
            exact Eq.comm
          · have hneq : (f == child) = false := beq_false_of_ne hfc
            simp [hneq, hwf.session_bijection s f]
        acyclic := by
          rcases hwf.acyclic with ⟨depth, hdec, hbound⟩
          refine ⟨fun x => if x == child then depth parent + 1 else depth x, ?_, ?_⟩
          · intro c p hcp
            by_cases hcc : c = child
            · subst c
              simp only [beq_self_eq_true, ↓reduceIte, Option.some.injEq] at hcp
              subst p
              have hne : (parent == child) = false := beq_false_of_ne hpc
              simp [hne]
            · have hneq : (c == child) = false := beq_false_of_ne hcc
              simp only [hneq, Bool.false_eq_true, ↓reduceIte] at hcp ⊢
              have hpne : p ≠ child := by
                intro h; subst p
                have hch := (hwf.parent_child_symm child c).mp hcp
                rw [hwf.absent_no_children child c hcAbsent] at hch
                cases hch
              simp [beq_false_of_ne hpne, hdec c p hcp]
          · intro f hf
            by_cases hfc : f = child
            · subst f
              simp only [beq_self_eq_true, ↓reduceIte]
              have := hbound parent hpPresent
              omega
            · have hneq : (f == child) = false := beq_false_of_ne hfc
              simp only [hneq, Bool.false_eq_true, ↓reduceIte] at hf ⊢
              have := hbound f hf
              omega }
  · exact hwf

theorem reparentNonDescendant_preserves_wellFormed (t : FrameTree) (child newParent : FrameId)
    (hwf : WellFormed t) :
    WellFormed (reparentNonDescendant t child newParent) := by
  unfold reparentNonDescendant
  split
  · rename_i hcond
    simp only [Bool.and_eq_true, Bool.not_eq_true', beq_eq_false_iff_ne] at hcond
    rcases hcond with ⟨⟨⟨⟨hcPres, hnpPres⟩, hcNotRoot⟩, hcNeNp⟩, hnotAncBool⟩
    have hnotAnc : ¬ IsAncestor t child newParent := by
      intro h
      have := (isAncestorBool_iff hwf child newParent).mpr h
      rw [hnotAncBool] at this
      cases this
    refine
      { root_present := hwf.root_present
        root_no_parent := by
          have : (t.rootId == child) = false := beq_false_of_ne (Ne.symm hcNotRoot)
          simp [this, hwf.root_no_parent]
        nonroot_has_parent := by
          intro f hf hne
          by_cases hfc : f = child
          · subst hfc; exact ⟨newParent, by simp, hnpPres⟩
          · simp [beq_false_of_ne hfc]
            exact hwf.nonroot_has_parent f hf hne
        absent_no_parent := by
          intro f hf
          have hfc : f ≠ child := by
            intro h; subst h; rw [hcPres] at hf; cases hf
          simp [beq_false_of_ne hfc, hwf.absent_no_parent f hf]
        absent_no_children := by
          intro f c hf
          by_cases hcc : c = child
          · subst hcc
            have hfnp : f ≠ newParent := by
              intro h; subst h; rw [hnpPres] at hf; cases hf
            simp [beq_false_of_ne hfnp]
          · simp [beq_false_of_ne hcc, hwf.absent_no_children f c hf]
        absent_no_owner := hwf.absent_no_owner
        parent_child_symm := by
          intro p c
          by_cases hcc : c = child
          · subst c
            simp only [beq_self_eq_true, ↓reduceIte, beq_iff_eq, Option.some.injEq]
            exact Eq.comm
          · simp [beq_false_of_ne hcc, hwf.parent_child_symm p c]
        session_bijection := hwf.session_bijection
        acyclic := by
          rcases hwf.acyclic with ⟨depth, hdec, hbound⟩
          let shift := depth newParent + 1
          let depth' : FrameId → Nat := fun x =>
            if inSubtreeBool t child x then depth x + shift else depth x
          refine ⟨depth', ?_, ?_⟩
          · intro c p hcp
            by_cases hcc : c = child
            · subst c
              simp only [beq_self_eq_true, ↓reduceIte, Option.some.injEq] at hcp
              subst p
              have hcIn : inSubtreeBool t child child = true := by simp [inSubtreeBool]
              have hnpOut : inSubtreeBool t child newParent = false := by
                rw [inSubtreeBool_false_iff hwf]
                rintro (h | h)
                · exact hcNeNp h.symm
                · exact hnotAnc h
              simp only [depth', hcIn, hnpOut, ↓reduceIte, Bool.false_eq_true, shift]
              omega
            · have hneq : (c == child) = false := beq_false_of_ne hcc
              simp only [hneq, Bool.false_eq_true, ↓reduceIte] at hcp
              have hlt := hdec c p hcp
              cases hcSub : inSubtreeBool t child c with
              | true =>
                have hcOr := (inSubtreeBool_iff hwf child c).mp hcSub
                have hcAnc : IsAncestor t child c := by
                  rcases hcOr with rfl | h
                  · exact absurd rfl hcc
                  · exact h
                have hpIn : inSubtreeBool t child p = true := by
                  rw [inSubtreeBool_iff hwf]
                  cases hcAnc with
                  | direct h =>
                    rw [hcp] at h; cases h; exact Or.inl rfl
                  | step h hrec =>
                    rw [hcp] at h; cases h; exact Or.inr hrec
                simp only [depth', hcSub, hpIn, ↓reduceIte]
                omega
              | false =>
                have hpOut : inSubtreeBool t child p = false := by
                  rw [inSubtreeBool_false_iff hwf]
                  intro hpOr
                  have hcAnc : IsAncestor t child c := by
                    rcases hpOr with rfl | hrec
                    · exact IsAncestor.direct hcp
                    · exact IsAncestor.step hcp hrec
                  have hcIn := (inSubtreeBool_iff hwf child c).mpr (Or.inr hcAnc)
                  rw [hcSub] at hcIn
                  cases hcIn
                simp only [depth', hcSub, hpOut, Bool.false_eq_true, ↓reduceIte]
                exact hlt
          · intro f hf
            have hdf := hbound f hf
            have hdnp := hbound newParent hnpPres
            simp only [depth', shift]
            split <;> omega }
  · exact hwf

theorem detachSubtree_preserves_wellFormed (t : FrameTree) (target : FrameId)
    (hwf : WellFormed t) :
    WellFormed (detachSubtree t target) := by
  unfold detachSubtree
  split
  · rename_i hcond
    simp only [Bool.and_eq_true, Bool.not_eq_true', beq_eq_false_iff_ne] at hcond
    rcases hcond with ⟨_, htNotRoot⟩
    have hrootOut : inSubtreeBool t target t.rootId = false := by
      rw [inSubtreeBool_false_iff hwf]
      rintro (h | h)
      · exact htNotRoot h.symm
      · cases h with
        | direct hp => rw [hwf.root_no_parent] at hp; cases hp
        | step hp _ => rw [hwf.root_no_parent] at hp; cases hp
    refine
      { root_present := by simp [hrootOut, hwf.root_present]
        root_no_parent := by simp [hrootOut, hwf.root_no_parent]
        nonroot_has_parent := by
          intro f hf hne
          cases hsub : inSubtreeBool t target f with
          | true => simp [hsub] at hf
          | false =>
            simp only [hsub, Bool.false_eq_true, ↓reduceIte] at hf ⊢
            rcases hwf.nonroot_has_parent f hf hne with ⟨p, hpf, hpp⟩
            have hpOut : inSubtreeBool t target p = false := by
              rw [inSubtreeBool_false_iff hwf]
              intro hpOr
              have hfAnc : IsAncestor t target f := by
                rcases hpOr with rfl | hrec
                · exact IsAncestor.direct hpf
                · exact IsAncestor.step hpf hrec
              have := (inSubtreeBool_iff hwf target f).mpr (Or.inr hfAnc)
              rw [hsub] at this
              cases this
            exact ⟨p, hpf, by simp [hpOut, hpp]⟩
        absent_no_parent := by
          intro f hf
          cases hsub : inSubtreeBool t target f with
          | true => simp [hsub]
          | false =>
            simp only [hsub, Bool.false_eq_true, ↓reduceIte] at hf ⊢
            exact hwf.absent_no_parent f hf
        absent_no_children := by
          intro f c hf
          cases hsub : inSubtreeBool t target f with
          | true => simp [hsub]
          | false =>
            simp only [hsub, Bool.false_eq_true, ↓reduceIte] at hf
            cases hsubc : inSubtreeBool t target c with
            | true => simp [hsubc]
            | false => simp [hsub, hsubc, hwf.absent_no_children f c hf]
        absent_no_owner := by
          intro f hf
          cases hsub : inSubtreeBool t target f with
          | true => simp [hsub]
          | false =>
            simp only [hsub, Bool.false_eq_true, ↓reduceIte] at hf ⊢
            exact hwf.absent_no_owner f hf
        parent_child_symm := by
          intro p c
          cases hsubc : inSubtreeBool t target c with
          | true => simp [hsubc]
          | false =>
            cases hsubp : inSubtreeBool t target p with
            | true =>
              simp only [hsubc, hsubp, Bool.false_eq_true, Bool.true_or, ↓reduceIte]
              constructor
              · intro hpc
                exfalso
                have hpOr := (inSubtreeBool_iff hwf target p).mp hsubp
                have hcAnc : IsAncestor t target c := by
                  rcases hpOr with rfl | hrec
                  · exact IsAncestor.direct hpc
                  · exact IsAncestor.step hpc hrec
                have := (inSubtreeBool_iff hwf target c).mpr (Or.inr hcAnc)
                rw [hsubc] at this
                cases this
              · intro h; cases h
            | false =>
              simp [hsubc, hsubp, hwf.parent_child_symm p c]
        session_bijection := by
          intro s f
          cases hsub : inSubtreeBool t target f with
          | true => simp [hsub]
          | false => simp [hsub, hwf.session_bijection s f]
        acyclic := by
          rcases hwf.acyclic with ⟨depth, hdec, hbound⟩
          refine ⟨depth, ?_, ?_⟩
          · intro c p hcp
            cases hsub : inSubtreeBool t target c with
            | true => simp [hsub] at hcp
            | false =>
              simp only [hsub, Bool.false_eq_true, ↓reduceIte] at hcp
              exact hdec c p hcp
          · intro f hf
            cases hsub : inSubtreeBool t target f with
            | true => simp [hsub] at hf
            | false =>
              simp only [hsub, Bool.false_eq_true, ↓reduceIte] at hf
              exact hbound f hf }
  · exact hwf

theorem adoptSession_preserves_wellFormed (t : FrameTree) (target : FrameId)
    (session : SessionId) (hwf : WellFormed t) :
    WellFormed (adoptSession t target session) := by
  unfold adoptSession
  split
  · rename_i htPres
    refine
      { root_present := hwf.root_present
        root_no_parent := hwf.root_no_parent
        nonroot_has_parent := hwf.nonroot_has_parent
        absent_no_parent := hwf.absent_no_parent
        absent_no_children := hwf.absent_no_children
        absent_no_owner := by
          intro f hf
          have hft : f ≠ target := by
            intro h; subst h; rw [htPres] at hf; cases hf
          simp [beq_false_of_ne hft, hwf.absent_no_owner f hf]
        parent_child_symm := hwf.parent_child_symm
        session_bijection := by
          intro s f
          by_cases hft : f = target
          · subst f
            simp only [beq_self_eq_true, ↓reduceIte, beq_iff_eq, Option.some.injEq]
            exact Eq.comm
          · simp [beq_false_of_ne hft, hwf.session_bijection s f]
        acyclic := hwf.acyclic }
  · exact hwf

theorem renameNodeId_preserves_wellFormed (t : FrameTree) (oldId newId : FrameId)
    (hwf : WellFormed t) :
    WellFormed (renameNodeId t oldId newId) := by
  unfold renameNodeId
  split
  · let bij := swapId oldId newId
    have hinvol : ∀ x, bij (bij x) = x := swapId_invol oldId newId
    have hinj : ∀ x y, bij x = bij y → x = y := by
      intro x y h
      have := congrArg bij h
      simpa [hinvol] using this
    refine
      { root_present := by
          change t.present (bij (bij t.rootId)) = true
          rw [hinvol]; exact hwf.root_present
        root_no_parent := by
          change (t.parentOf (bij (bij t.rootId))).map bij = none
          rw [hinvol, hwf.root_no_parent]; rfl
        nonroot_has_parent := by
          intro f hf hne
          have hf' : t.present (bij f) = true := hf
          have hne' : bij f ≠ t.rootId := by
            intro h
            have := congrArg bij h
            rw [hinvol] at this
            exact hne this
          rcases hwf.nonroot_has_parent (bij f) hf' hne' with ⟨p, hpf, hpp⟩
          refine ⟨bij p, ?_, ?_⟩
          · change (t.parentOf (bij f)).map bij = some (bij p)
            rw [hpf]; rfl
          · change t.present (bij (bij p)) = true
            rw [hinvol]; exact hpp
        absent_no_parent := by
          intro f hf
          change (t.parentOf (bij f)).map bij = none
          rw [hwf.absent_no_parent (bij f) hf]; rfl
        absent_no_children := by
          intro f c hf
          exact hwf.absent_no_children (bij f) (bij c) hf
        absent_no_owner := by
          intro f hf
          exact hwf.absent_no_owner (bij f) hf
        parent_child_symm := by
          intro p c
          change (t.parentOf (bij c)).map bij = some p ↔ t.childrenOf (bij p) (bij c) = true
          rw [← hwf.parent_child_symm (bij p) (bij c)]
          cases hpc : t.parentOf (bij c) with
          | none => simp
          | some q =>
            simp only [Option.map_some, Option.some.injEq]
            constructor
            · intro h; rw [← h, hinvol]
            · intro h; subst h; exact hinvol p
        session_bijection := by
          intro s f
          exact hwf.session_bijection s (bij f)
        acyclic := by
          rcases hwf.acyclic with ⟨depth, hdec, hbound⟩
          refine ⟨fun x => depth (bij x), ?_, ?_⟩
          · intro c p hcp
            change (t.parentOf (bij c)).map bij = some p at hcp
            cases hpc : t.parentOf (bij c) with
            | none => rw [hpc] at hcp; cases hcp
            | some q =>
              rw [hpc] at hcp
              simp only [Option.map_some, Option.some.injEq] at hcp
              have hq : bij p = q := by rw [← hcp, hinvol]
              dsimp only
              rw [hq]
              exact hdec (bij c) q hpc
          · intro f hf
            exact hbound (bij f) hf }
  · exact hwf

/-- Every single event in the legal alphabet preserves `WellFormed`. -/
theorem applyEvent_preserves_wellFormed (t : FrameTree) (ev : FrameEvent)
    (hwf : WellFormed t) :
    WellFormed (applyEvent t ev) := by
  cases ev with
  | attachChild child parent session =>
    exact attachChild_preserves_wellFormed t child parent session hwf
  | reparentNonDescendant child newParent =>
    exact reparentNonDescendant_preserves_wellFormed t child newParent hwf
  | detachSubtree target =>
    exact detachSubtree_preserves_wellFormed t target hwf
  | adoptSession target session =>
    exact adoptSession_preserves_wellFormed t target session hwf
  | renameNodeId oldId newId =>
    exact renameNodeId_preserves_wellFormed t oldId newId hwf

/-- Main Inductive Invariant Theorem: ALL finite event histories `List FrameEvent`
    preserve `WellFormed` (unbounded depth and unbounded trace length). -/
theorem runEvents_preserves_wellFormed (t : FrameTree) (evs : List FrameEvent)
    (hwf : WellFormed t) :
    WellFormed (runEvents t evs) := by
  induction evs generalizing t with
  | nil => exact hwf
  | cons ev rest ih =>
    exact ih (applyEvent t ev) (applyEvent_preserves_wellFormed t ev hwf)

/-- Corollary: Starting from `FrameTree.init rootId`, any finite history produces a well-formed,
    acyclic frame tree. -/
theorem init_runEvents_wellFormed (rootId : FrameId) (evs : List FrameEvent) :
    WellFormed (runEvents (FrameTree.init rootId) evs) :=
  runEvents_preserves_wellFormed (FrameTree.init rootId) evs (init_wellFormed rootId)

end StagehandProofs.FrameTree
