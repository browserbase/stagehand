namespace StagehandProofs

inductive Sym where
  | lit (c : Char)
  | redacted
  deriving DecidableEq, Repr

def liftSecret (s : List Char) : List Sym :=
  s.map Sym.lit

def matchPrefix (secrets : List (List Char)) (xs : List Sym) : Option { k : Nat // 0 < k } :=
  match secrets with
  | [] => none
  | s :: rest =>
    match s with
    | [] => matchPrefix rest xs
    | c :: cs =>
      if (liftSecret (c :: cs)) <+: xs then
        some ⟨(c :: cs).length, Nat.zero_lt_succ cs.length⟩
      else
        matchPrefix rest xs

theorem matchPrefix_some {secrets : List (List Char)} {xs : List Sym} {k : { k : Nat // 0 < k }}
    (h : matchPrefix secrets xs = some k) :
    ∃ s ∈ secrets, s ≠ [] ∧ (liftSecret s) <+: xs ∧ s.length = k.val := by
  induction secrets with
  | nil => simp [matchPrefix] at h
  | cons s rest ih =>
    cases s with
    | nil =>
      simp only [matchPrefix] at h
      obtain ⟨s', hmem, hne, hpre, hlen⟩ := ih h
      exact ⟨s', List.mem_cons_of_mem [] hmem, hne, hpre, hlen⟩
    | cons c cs =>
      simp only [matchPrefix] at h
      split at h
      · rename_i hpre
        injection h with hk
        have hval : (c :: cs).length = k.val := by
          cases hk
          rfl
        exact ⟨c :: cs, List.mem_cons_self, List.cons_ne_nil c cs, hpre, hval⟩
      · obtain ⟨s', hmem, hne, hpre, hlen⟩ := ih h
        exact ⟨s', List.mem_cons_of_mem (c :: cs) hmem, hne, hpre, hlen⟩

theorem matchPrefix_none {secrets : List (List Char)} {xs : List Sym}
    (h : matchPrefix secrets xs = none) :
    ∀ s ∈ secrets, s ≠ [] → ¬ ((liftSecret s) <+: xs) := by
  induction secrets with
  | nil =>
    intro _ hmem
    cases hmem
  | cons s rest ih =>
    cases s with
    | nil =>
      simp only [matchPrefix] at h
      intro s' hmem hne hpre
      cases hmem with
      | head => exact hne rfl
      | tail _ htail => exact ih h s' htail hne hpre
    | cons c cs =>
      simp only [matchPrefix] at h
      split at h
      · cases h
      · rename_i hnot
        intro s' hmem hne hpre
        cases hmem with
        | head => exact hnot hpre
        | tail _ htail => exact ih h s' htail hne hpre

def redactSyms (secrets : List (List Char)) : List Sym → List Sym
  | [] => []
  | x :: rest =>
    match matchPrefix secrets (x :: rest) with
    | some ⟨k, _hk⟩ =>
      Sym.redacted :: redactSyms secrets ((x :: rest).drop k)
    | none =>
      x :: redactSyms secrets rest
termination_by xs => xs.length
decreasing_by
  · simp [List.length_drop]
    omega
  · simp

theorem redactSyms_nil (secrets : List (List Char)) :
    redactSyms secrets [] = [] := by
  rw [redactSyms]

theorem redactSyms_cons_some {secrets : List (List Char)} {x : Sym} {rest : List Sym}
    {k : Nat} {hk : 0 < k}
    (h : matchPrefix secrets (x :: rest) = some ⟨k, hk⟩) :
    redactSyms secrets (x :: rest) = Sym.redacted :: redactSyms secrets ((x :: rest).drop k) := by
  rw [redactSyms, h]

theorem redactSyms_cons_none {secrets : List (List Char)} {x : Sym} {rest : List Sym}
    (h : matchPrefix secrets (x :: rest) = none) :
    redactSyms secrets (x :: rest) = x :: redactSyms secrets rest := by
  rw [redactSyms, h]

theorem liftSecret_prefix_of_redactSyms {secrets : List (List Char)}
    {zs : List Char} {xs : List Sym}
    (h : liftSecret zs <+: redactSyms secrets xs) :
    liftSecret zs <+: xs := by
  induction zs generalizing xs with
  | nil =>
    simp [liftSecret]
  | cons c cs ih =>
    cases xs with
    | nil =>
      rw [redactSyms_nil] at h
      simp [liftSecret] at h
    | cons x rest =>
      cases hm : matchPrefix secrets (x :: rest) with
      | some k =>
        rcases k with ⟨k, hk⟩
        rw [redactSyms_cons_some hm] at h
        simp [liftSecret] at h
      | none =>
        rw [redactSyms_cons_none hm] at h
        simp [liftSecret] at h
        obtain ⟨hx, htail⟩ := h
        subst hx
        have hrec := ih htail
        simpa [liftSecret] using hrec

theorem eq_liftSecret_of_redactSyms_eq {secrets : List (List Char)}
    {zs : List Char} {xs : List Sym}
    (h : redactSyms secrets xs = liftSecret zs) :
    xs = liftSecret zs := by
  induction zs generalizing xs with
  | nil =>
    cases xs with
    | nil => rfl
    | cons x rest =>
      cases hm : matchPrefix secrets (x :: rest) with
      | some k =>
        rcases k with ⟨k, hk⟩
        rw [redactSyms_cons_some hm] at h
        simp [liftSecret] at h
      | none =>
        rw [redactSyms_cons_none hm] at h
        simp [liftSecret] at h
  | cons c cs ih =>
    cases xs with
    | nil =>
      rw [redactSyms_nil] at h
      simp [liftSecret] at h
    | cons x rest =>
      cases hm : matchPrefix secrets (x :: rest) with
      | some k =>
        rcases k with ⟨k, hk⟩
        rw [redactSyms_cons_some hm] at h
        simp [liftSecret] at h
      | none =>
        rw [redactSyms_cons_none hm] at h
        simp only [liftSecret, List.map_cons, List.cons.injEq] at h
        obtain ⟨hx, htail⟩ := h
        subst hx
        exact congrArg (Sym.lit c :: ·) (ih htail)

theorem redactSyms_no_secret (secrets : List (List Char)) (xs : List Sym) :
    ∀ s ∈ secrets, s ≠ [] → ¬ (liftSecret s <:+: redactSyms secrets xs) := by
  intro s hmem hne hinf
  match xs with
  | [] =>
    rw [redactSyms_nil] at hinf
    obtain ⟨l1, l2, heq⟩ := hinf
    cases s with
    | nil => exact hne rfl
    | cons c cs =>
      have hlen0 : (l1 ++ liftSecret (c :: cs) ++ l2).length = 0 := congrArg List.length heq
      simp [liftSecret] at hlen0
  | x :: rest =>
    cases hm : matchPrefix secrets (x :: rest) with
    | some k =>
      rcases k with ⟨k, hk⟩
      rw [redactSyms_cons_some hm] at hinf
      obtain ⟨l1, l2, heq⟩ := hinf
      cases l1 with
      | nil =>
        cases s with
        | nil => exact hne rfl
        | cons c cs => simp [liftSecret] at heq
      | cons y ys =>
        simp only [List.cons_append, List.cons.injEq] at heq
        have hsub : liftSecret s <:+: redactSyms secrets ((x :: rest).drop k) :=
          ⟨ys, l2, heq.2⟩
        exact redactSyms_no_secret secrets ((x :: rest).drop k) s hmem hne hsub
    | none =>
      rw [redactSyms_cons_none hm] at hinf
      obtain ⟨l1, l2, heq⟩ := hinf
      cases l1 with
      | nil =>
        simp only [List.nil_append] at heq
        have hpre_red : liftSecret s <+: x :: redactSyms secrets rest := ⟨l2, heq⟩
        cases s with
        | nil => exact hne rfl
        | cons c cs =>
          simp [liftSecret] at hpre_red
          obtain ⟨hx, hcs⟩ := hpre_red
          subst hx
          have hrest_pre : liftSecret cs <+: rest := liftSecret_prefix_of_redactSyms hcs
          have hfull_pre : liftSecret (c :: cs) <+: Sym.lit c :: rest := by
            simpa [liftSecret] using hrest_pre
          exact matchPrefix_none hm (c :: cs) hmem hne hfull_pre
      | cons y ys =>
        simp only [List.cons_append, List.cons.injEq] at heq
        have hsub : liftSecret s <:+: redactSyms secrets rest := ⟨ys, l2, heq.2⟩
        exact redactSyms_no_secret secrets rest s hmem hne hsub
termination_by xs.length
decreasing_by
  · simp
  · simp
    omega

theorem redactSyms_eq_of_clean (secrets : List (List Char)) (xs : List Sym)
    (hclean : ∀ s ∈ secrets, s ≠ [] → ¬ (liftSecret s <:+: xs)) :
    redactSyms secrets xs = xs := by
  induction xs with
  | nil => rw [redactSyms_nil]
  | cons x rest ih =>
    have hnone : matchPrefix secrets (x :: rest) = none := by
      cases hm : matchPrefix secrets (x :: rest) with
      | none => rfl
      | some k =>
        obtain ⟨s, hmem, hne, hpre, _⟩ := matchPrefix_some hm
        exact False.elim (hclean s hmem hne hpre.isInfix)
    rw [redactSyms_cons_none hnone]
    congr 1
    apply ih
    intro s hmem hne hinf
    obtain ⟨l1, l2, heq⟩ := hinf
    exact hclean s hmem hne ⟨x :: l1, l2, by simp [heq]⟩

theorem redactSyms_idempotent (secrets : List (List Char)) (xs : List Sym) :
    redactSyms secrets (redactSyms secrets xs) = redactSyms secrets xs :=
  redactSyms_eq_of_clean secrets (redactSyms secrets xs) (redactSyms_no_secret secrets xs)

theorem noSecret_redacted_singleton (secrets : List (List Char)) :
    ∀ sec ∈ secrets, sec ≠ [] → ¬ (liftSecret sec <:+: [Sym.redacted]) := by
  intro sec _ hne hinf
  obtain ⟨l1, l2, heq⟩ := hinf
  cases sec with
  | nil => exact hne rfl
  | cons c cs =>
    cases l1 with
    | nil => simp [liftSecret] at heq
    | cons y ys =>
      have hlen : (y :: ys ++ liftSecret (c :: cs) ++ l2).length = 1 :=
        congrArg List.length heq
      simp [liftSecret] at hlen

theorem redactSyms_singleton_redacted (secrets : List (List Char)) :
    redactSyms secrets [Sym.redacted] = [Sym.redacted] :=
  redactSyms_eq_of_clean secrets [Sym.redacted] (noSecret_redacted_singleton secrets)

inductive JsonVal where
  | null
  | bool (b : Bool)
  | num (n : Int)
  | str (s : List Sym)
  | arr (items : List JsonVal)
  | obj (fields : List (List Sym × JsonVal))
  deriving Repr

inductive JsonTag where
  | null | bool | num | str | arr (len : Nat) | obj (arity : Nat)
  deriving DecidableEq, Repr

def jsonTag : JsonVal → JsonTag
  | .null => .null
  | .bool _ => .bool
  | .num _ => .num
  | .str _ => .str
  | .arr items => .arr items.length
  | .obj fields => .obj fields.length

def isSensitiveKey (sensitiveKeys : List (List Char)) (k : List Sym) : Bool :=
  sensitiveKeys.any (fun sk => k == liftSecret sk)

mutual
  def redactTree (secrets : List (List Char)) (sensitiveKeys : List (List Char)) :
      JsonVal → JsonVal
    | .null => .null
    | .bool b => .bool b
    | .num n => .num n
    | .str s => .str (redactSyms secrets s)
    | .arr items => .arr (redactTreeList secrets sensitiveKeys items)
    | .obj fields => .obj (redactTreeFields secrets sensitiveKeys fields)

  def redactTreeList (secrets : List (List Char)) (sensitiveKeys : List (List Char)) :
      List JsonVal → List JsonVal
    | [] => []
    | v :: vs => redactTree secrets sensitiveKeys v :: redactTreeList secrets sensitiveKeys vs

  def redactTreeFields (secrets : List (List Char)) (sensitiveKeys : List (List Char)) :
      List (List Sym × JsonVal) → List (List Sym × JsonVal)
    | [] => []
    | (k, v) :: rest =>
      let rk := redactSyms secrets k
      let rv :=
        if isSensitiveKey sensitiveKeys k then
          .str [Sym.redacted]
        else
          redactTree secrets sensitiveKeys v
      (rk, rv) :: redactTreeFields secrets sensitiveKeys rest
end

mutual
  def NoSecretInTree (secrets : List (List Char)) : JsonVal → Prop
    | .null => True
    | .bool _ => True
    | .num _ => True
    | .str s => ∀ sec ∈ secrets, sec ≠ [] → ¬ (liftSecret sec <:+: s)
    | .arr items => NoSecretInList secrets items
    | .obj fields => NoSecretInFields secrets fields

  def NoSecretInList (secrets : List (List Char)) : List JsonVal → Prop
    | [] => True
    | v :: vs => NoSecretInTree secrets v ∧ NoSecretInList secrets vs

  def NoSecretInFields (secrets : List (List Char)) : List (List Sym × JsonVal) → Prop
    | [] => True
    | (k, v) :: rest =>
      (∀ sec ∈ secrets, sec ≠ [] → ¬ (liftSecret sec <:+: k)) ∧
      NoSecretInTree secrets v ∧
      NoSecretInFields secrets rest
end

mutual
  theorem redactTree_no_secret_token (secrets : List (List Char))
      (sensitiveKeys : List (List Char)) :
      ∀ v : JsonVal, NoSecretInTree secrets (redactTree secrets sensitiveKeys v)
    | .null => trivial
    | .bool _ => trivial
    | .num _ => trivial
    | .str s => redactSyms_no_secret secrets s
    | .arr items => redactTreeList_no_secret_token secrets sensitiveKeys items
    | .obj fields => redactTreeFields_no_secret_token secrets sensitiveKeys fields

  theorem redactTreeList_no_secret_token (secrets : List (List Char))
      (sensitiveKeys : List (List Char)) :
      ∀ vs : List JsonVal, NoSecretInList secrets (redactTreeList secrets sensitiveKeys vs)
    | [] => trivial
    | v :: vs =>
      ⟨redactTree_no_secret_token secrets sensitiveKeys v,
        redactTreeList_no_secret_token secrets sensitiveKeys vs⟩

  theorem redactTreeFields_no_secret_token (secrets : List (List Char))
      (sensitiveKeys : List (List Char)) :
      ∀ fs : List (List Sym × JsonVal),
        NoSecretInFields secrets (redactTreeFields secrets sensitiveKeys fs)
    | [] => trivial
    | (k, v) :: rest => by
      simp only [redactTreeFields, NoSecretInFields]
      refine ⟨redactSyms_no_secret secrets k, ?_,
        redactTreeFields_no_secret_token secrets sensitiveKeys rest⟩
      split
      · exact noSecret_redacted_singleton secrets
      · exact redactTree_no_secret_token secrets sensitiveKeys v
end

theorem sensitiveKey_of_redacted_eq {secrets : List (List Char)} {sensitiveKeys : List (List Char)}
    {k : List Sym}
    (h : isSensitiveKey sensitiveKeys (redactSyms secrets k) = true) :
    isSensitiveKey sensitiveKeys k = true := by
  simp only [isSensitiveKey, List.any_eq_true, beq_iff_eq] at h ⊢
  obtain ⟨sk, hsk_mem, hsk_eq⟩ := h
  exact ⟨sk, hsk_mem, eq_liftSecret_of_redactSyms_eq hsk_eq⟩

mutual
  theorem redactTree_idempotent (secrets : List (List Char))
      (sensitiveKeys : List (List Char)) :
      ∀ v : JsonVal,
        redactTree secrets sensitiveKeys (redactTree secrets sensitiveKeys v) =
          redactTree secrets sensitiveKeys v
    | .null => rfl
    | .bool _ => rfl
    | .num _ => rfl
    | .str s => congrArg JsonVal.str (redactSyms_idempotent secrets s)
    | .arr items => congrArg JsonVal.arr (redactTreeList_idempotent secrets sensitiveKeys items)
    | .obj fields => congrArg JsonVal.obj (redactTreeFields_idempotent secrets sensitiveKeys fields)

  theorem redactTreeList_idempotent (secrets : List (List Char))
      (sensitiveKeys : List (List Char)) :
      ∀ vs : List JsonVal,
        redactTreeList secrets sensitiveKeys (redactTreeList secrets sensitiveKeys vs) =
          redactTreeList secrets sensitiveKeys vs
    | [] => rfl
    | v :: vs => by
      simp only [redactTreeList, redactTree_idempotent, redactTreeList_idempotent]

  theorem redactTreeFields_idempotent (secrets : List (List Char))
      (sensitiveKeys : List (List Char)) :
      ∀ fs : List (List Sym × JsonVal),
        redactTreeFields secrets sensitiveKeys (redactTreeFields secrets sensitiveKeys fs) =
          redactTreeFields secrets sensitiveKeys fs
    | [] => rfl
    | (k, v) :: rest => by
      simp only [redactTreeFields, redactSyms_idempotent, redactTreeFields_idempotent]
      congr 1
      by_cases h1 : isSensitiveKey sensitiveKeys k = true
      · simp only [h1, ↓reduceIte]
        by_cases h2 : isSensitiveKey sensitiveKeys (redactSyms secrets k) = true
        · simp [h2]
        · simp [h2, redactTree, redactSyms_singleton_redacted]
      · simp only [h1, Bool.false_eq_true, ↓reduceIte]
        have h2 : isSensitiveKey sensitiveKeys (redactSyms secrets k) = false := by
          cases hr : isSensitiveKey sensitiveKeys (redactSyms secrets k) with
          | false => rfl
          | true => exact absurd (sensitiveKey_of_redacted_eq hr) h1
        simp only [h2, Bool.false_eq_true, ↓reduceIte, redactTree_idempotent]
end

theorem redactTreeList_length (secrets : List (List Char)) (sensitiveKeys : List (List Char))
    (vs : List JsonVal) :
    (redactTreeList secrets sensitiveKeys vs).length = vs.length := by
  induction vs with
  | nil => rfl
  | cons _ _ ih => simp [redactTreeList, ih]

theorem redactTreeFields_length (secrets : List (List Char)) (sensitiveKeys : List (List Char))
    (fs : List (List Sym × JsonVal)) :
    (redactTreeFields secrets sensitiveKeys fs).length = fs.length := by
  induction fs with
  | nil => rfl
  | cons kv _ ih =>
    cases kv
    simp [redactTreeFields, ih]

theorem redactTree_preserves_shape (secrets : List (List Char))
    (sensitiveKeys : List (List Char)) (v : JsonVal) :
    jsonTag (redactTree secrets sensitiveKeys v) = jsonTag v := by
  cases v with
  | null => rfl
  | bool _ => rfl
  | num _ => rfl
  | str _ => rfl
  | arr items => simp [redactTree, jsonTag, redactTreeList_length]
  | obj fields => simp [redactTree, jsonTag, redactTreeFields_length]

def truncate {α : Type} (xs : List α) (bound : Nat) : List α :=
  xs.take bound

theorem truncate_respects_bound {α : Type} (xs : List α) (bound : Nat) :
    (truncate xs bound).length ≤ bound := by
  simp only [truncate, List.length_take]
  exact Nat.min_le_left bound xs.length

def isHighSurrogate (u : Nat) : Bool :=
  0xD800 ≤ u && u ≤ 0xDBFF

def isLowSurrogate (u : Nat) : Bool :=
  0xDC00 ≤ u && u ≤ 0xDFFF

inductive WellFormedUtf16 : List Nat → Prop where
  | nil : WellFormedUtf16 []
  | bmp {u : Nat} {rest : List Nat}
      (hNotHigh : isHighSurrogate u = false)
      (hNotLow : isLowSurrogate u = false)
      (hRest : WellFormedUtf16 rest) :
      WellFormedUtf16 (u :: rest)
  | pair {hi lo : Nat} {rest : List Nat}
      (hHigh : isHighSurrogate hi = true)
      (hLow : isLowSurrogate lo = true)
      (hRest : WellFormedUtf16 rest) :
      WellFormedUtf16 (hi :: lo :: rest)

def truncateUtf16Safe : List Nat → Nat → List Nat
  | [], _ => []
  | _, 0 => []
  | [u], _ + 1 => if isHighSurrogate u then [] else [u]
  | u :: v :: rest, b + 1 =>
    if isHighSurrogate u && isLowSurrogate v then
      if b + 1 < 2 then [] else u :: v :: truncateUtf16Safe rest (b + 1 - 2)
    else
      u :: truncateUtf16Safe (v :: rest) b

theorem truncateUtf16Safe_respects_bound (xs : List Nat) (bound : Nat) :
    (truncateUtf16Safe xs bound).length ≤ bound := by
  match xs, bound with
  | [], _ => simp [truncateUtf16Safe]
  | _ :: _, 0 => simp [truncateUtf16Safe]
  | [u], b + 1 =>
    simp only [truncateUtf16Safe]
    split <;> simp
  | u :: v :: rest, b + 1 =>
    simp only [truncateUtf16Safe]
    split
    · split
      · simp
      · simp only [List.length_cons]
        have hrec := truncateUtf16Safe_respects_bound rest (b + 1 - 2)
        omega
    · simp only [List.length_cons]
      have hrec := truncateUtf16Safe_respects_bound (v :: rest) b
      omega
termination_by xs.length

theorem truncateUtf16Safe_preserves_wellFormed (xs : List Nat) (bound : Nat)
    (hwf : WellFormedUtf16 xs) :
    WellFormedUtf16 (truncateUtf16Safe xs bound) := by
  induction hwf generalizing bound with
  | nil =>
    simp [truncateUtf16Safe]
    exact .nil
  | @bmp u rest hNotHigh hNotLow hRest ih =>
    cases bound with
    | zero =>
      simp [truncateUtf16Safe]
      exact .nil
    | succ b =>
      cases rest with
      | nil =>
        simp [truncateUtf16Safe, hNotHigh]
        exact .bmp hNotHigh hNotLow .nil
      | cons v rs =>
        simp [truncateUtf16Safe, hNotHigh]
        exact .bmp hNotHigh hNotLow (ih b)
  | @pair hi lo rest hHigh hLow hRest ih =>
    cases bound with
    | zero =>
      simp [truncateUtf16Safe]
      exact .nil
    | succ b =>
      simp only [truncateUtf16Safe, hHigh, hLow, Bool.and_self, ↓reduceIte]
      split
      · exact .nil
      · exact .pair hHigh hLow (ih (b + 1 - 2))

end StagehandProofs
