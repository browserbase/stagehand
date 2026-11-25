/-
  StagehandProofs.DomainPolicy

  Formal model and machine-checked proofs for Stagehand's domain access policy
  (`packages/extension/understudy/domainPolicy.ts`).

  Key modeling notes grounded in the TypeScript implementation:
  - Policies carry arbitrary finite lists of `allowed` and `blocked` rules (`List Rule`),
    covering unbounded rule-set sizes.
  - Wildcard rules `*.d` follow Stagehand's strict subdomain semantics
    (`hostname.endsWith("." + d)` in `domainPolicy.ts:163` and `domainPolicy.test.ts:118,143`):
    `*.example.com` matches `sub.example.com` (and `.example.com`), does NOT match apex
    `example.com`, and cannot be suffix-spoofed by `evil-example.com`.
  - Unlike `domainPolicy.ts:174` (which currently fails open on empty canonical hosts such as
    `https://./` via `if (!hostname) return { action: "continue" }`), the reference `decide`
    function here enforces the security specification and matches `toDomainPolicyDnrRules`:
    an empty canonical host is blocked whenever `allowed` is non-empty.
-/

namespace StagehandProofs.DomainPolicy

inductive Rule where
  | exact (domain : String)
  | wildcard (domain : String)
  deriving DecidableEq, Repr, BEq

namespace Rule

def domain : Rule → String
  | .exact d => d
  | .wildcard d => d

end Rule

inductive BlockReason where
  | blockedDomains
  | allowedDomains
  deriving DecidableEq, Repr, BEq

inductive Decision where
  | continue
  | block (reason : BlockReason)
  deriving DecidableEq, Repr, BEq

def Decision.isBlocked : Decision → Bool
  | .continue => false
  | .block _ => true

structure DomainPolicy where
  allowed : List Rule
  blocked : List Rule
  deriving DecidableEq, Repr

/-- Lowercase ASCII characters, matching `hostname.toLowerCase()` on ASCII domain labels. -/
def toLowerAscii (c : Char) : Char :=
  if 'A' ≤ c ∧ c ≤ 'Z' then Char.ofNat (c.toNat + 32) else c

/-- Strip trailing dots from a character list, matching `.replace(/\.+$/, "")`. -/
def stripTrailingDotsRev : List Char → List Char
  | '.' :: rest => stripTrailingDotsRev rest
  | xs => xs

/-- Canonicalize a parsed HTTP(S) hostname (lowercase + strip trailing dots). -/
def canonicalizeHost (host : String) : String :=
  String.ofList ((stripTrailingDotsRev (host.toList.map toLowerAscii).reverse).reverse)

/-- Decidable list suffix check `suffix` at the end of `xs`. -/
def listEndsWith (xs suffix : List Char) : Bool :=
  (xs.reverse.take suffix.length) == suffix.reverse && suffix.length ≤ xs.length

/-- Stagehand's rule matcher (`matchesDomainRules` in `domainPolicy.ts`). -/
def matchesRule (rule : Rule) (host : String) : Bool :=
  match rule with
  | .exact d => host == d
  | .wildcard d => listEndsWith host.toList ('.' :: d.toList)

def matchesAny (rules : List Rule) (host : String) : Bool :=
  rules.any (fun r => matchesRule r host)

/-- Reference policy decision over a canonicalized HTTP(S) hostname. -/
def decide (policy : DomainPolicy) (canonicalHost : String) : Decision :=
  if matchesAny policy.blocked canonicalHost then
    .block .blockedDomains
  else if !policy.allowed.isEmpty && !matchesAny policy.allowed canonicalHost then
    .block .allowedDomains
  else
    .continue

/-- Evaluate a raw HTTP(S) hostname after canonicalization (never fails open on `""`). -/
def decideHttpHost (policy : DomainPolicy) (rawHost : String) : Decision :=
  decide policy (canonicalizeHost rawHost)

/-- DNR priority-3/2/1 model mirroring `toDomainPolicyDnrRules` in `domainPolicy.ts`. -/
def decideDnr (policy : DomainPolicy) (canonicalHost : String) : Decision :=
  if matchesAny policy.blocked canonicalHost then
    .block .blockedDomains
  else if matchesAny policy.allowed canonicalHost then
    .continue
  else if !policy.allowed.isEmpty then
    .block .allowedDomains
  else
    .continue

/-! ### Helper lemmas for list suffix matching -/

private theorem reverse_take_eq_iff {α : Type} [DecidableEq α] (xs suf : List α) :
    ((xs.reverse.take suf.length == suf.reverse) && suf.length ≤ xs.length) = true ↔
      ∃ pfx : List α, xs = pfx ++ suf := by
  constructor
  · intro h
    simp only [Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq] at h
    rcases h with ⟨htake, hlen⟩
    refine ⟨(xs.reverse.drop suf.length).reverse, ?_⟩
    have hsplit : xs.reverse = xs.reverse.take suf.length ++ xs.reverse.drop suf.length :=
      (List.take_append_drop suf.length xs.reverse).symm
    have hrev := congrArg List.reverse hsplit
    rw [List.reverse_reverse, List.reverse_append, htake, List.reverse_reverse] at hrev
    exact hrev
  · rintro ⟨pfx, rfl⟩
    simp only [Bool.and_eq_true, beq_iff_eq, decide_eq_true_eq]
    constructor
    · rw [List.reverse_append, List.take_left' (by simp)]
    · simp

theorem listEndsWith_iff (xs suf : List Char) :
    listEndsWith xs suf = true ↔ ∃ pfx : List Char, xs = pfx ++ suf :=
  reverse_take_eq_iff xs suf

private theorem matchesAny_eq_true_iff (rules : List Rule) (h : String) :
    matchesAny rules h = true ↔ ∃ r ∈ rules, matchesRule r h = true := by
  simp [matchesAny, List.any_eq_true]

private theorem matchesAny_eq_false_iff (rules : List Rule) (h : String) :
    matchesAny rules h = false ↔ ∀ r ∈ rules, matchesRule r h = false := by
  constructor
  · intro hfalse r hr
    cases hm : matchesRule r h
    · rfl
    · have : matchesAny rules h = true := (matchesAny_eq_true_iff rules h).mpr ⟨r, hr, hm⟩
      rw [this] at hfalse
      cases hfalse
  · intro hall
    cases ha : matchesAny rules h
    · rfl
    · rcases (matchesAny_eq_true_iff rules h).mp ha with ⟨r, hr, hm⟩
      rw [hall r hr] at hm
      cases hm

/-! ### Core Security Theorems -/

/-- Theorem 1: Any matching blocked rule forces `.block .blockedDomains`, regardless of `allowed`. -/
theorem blocked_always_wins (policy : DomainPolicy) (h : String) (r : Rule)
    (hr : r ∈ policy.blocked) (hmatch : matchesRule r h = true) :
    decide policy h = .block .blockedDomains := by
  have hb : matchesAny policy.blocked h = true :=
    (matchesAny_eq_true_iff policy.blocked h).mpr ⟨r, hr, hmatch⟩
  simp [decide, hb]

/-- Theorem 2: Non-empty `allowed` with no matching allow rule always blocks. -/
theorem allowlist_default_deny (policy : DomainPolicy) (h : String)
    (hne : policy.allowed ≠ [])
    (hnomatch : ∀ r ∈ policy.allowed, matchesRule r h = false) :
    (decide policy h).isBlocked = true := by
  have hallowFalse : matchesAny policy.allowed h = false :=
    (matchesAny_eq_false_iff policy.allowed h).mpr hnomatch
  have hisEmpty : policy.allowed.isEmpty = false := by
    cases hlist : policy.allowed with
    | nil => exact absurd hlist hne
    | cons _ _ => rfl
  unfold decide
  cases hb : matchesAny policy.blocked h
  · simp [hisEmpty, hallowFalse, Decision.isBlocked]
  · simp [Decision.isBlocked]

/-- Stronger form of Theorem 2 when no blocked rule matches: reason is `.allowedDomains`. -/
theorem allowlist_default_deny_reason (policy : DomainPolicy) (h : String)
    (hne : policy.allowed ≠ [])
    (hnoAllow : ∀ r ∈ policy.allowed, matchesRule r h = false)
    (hnoBlock : ∀ r ∈ policy.blocked, matchesRule r h = false) :
    decide policy h = .block .allowedDomains := by
  have hallowFalse : matchesAny policy.allowed h = false :=
    (matchesAny_eq_false_iff policy.allowed h).mpr hnoAllow
  have hblockFalse : matchesAny policy.blocked h = false :=
    (matchesAny_eq_false_iff policy.blocked h).mpr hnoBlock
  have hisEmpty : policy.allowed.isEmpty = false := by
    cases hlist : policy.allowed with
    | nil => exact absurd hlist hne
    | cons _ _ => rfl
  simp [decide, hblockFalse, hisEmpty, hallowFalse]

/-- Empty canonical host never matches any valid (non-empty-domain) rule. -/
theorem empty_host_matches_no_valid_rule (r : Rule) (hd : r.domain ≠ "") :
    matchesRule r "" = false := by
  cases r with
  | exact d =>
    simp only [Rule.domain] at hd
    simp only [matchesRule, beq_eq_false_iff_ne]
    exact fun h => hd h.symm
  | wildcard d =>
    cases hm : matchesRule (.wildcard d) "" with
    | false => rfl
    | true =>
      have ⟨pfx, hpfx⟩ := (listEndsWith_iff "".toList ('.' :: d.toList)).mp hm
      have hlen := congrArg List.length hpfx
      simp at hlen

/-- Theorem 3: An empty canonical host (e.g. `https://./`) is always blocked under any
    non-empty allowlist of valid (non-empty) rules. -/
theorem empty_host_blocked_under_allowlist (policy : DomainPolicy)
    (hne : policy.allowed ≠ [])
    (hvalid : ∀ r ∈ policy.allowed, r.domain ≠ "") :
    (decide policy "").isBlocked = true := by
  apply allowlist_default_deny policy "" hne
  intro r hr
  exact empty_host_matches_no_valid_rule r (hvalid r hr)

/-- Canonicalizing `"."` (as produced by `new URL("https://./").hostname`) yields `""`. -/
theorem canonicalizeHost_dot : canonicalizeHost "." = "" := by
  decide

/-- Corollary of Theorem 3 for raw host `"."` (`https://./`). -/
theorem dot_host_blocked_under_allowlist (policy : DomainPolicy)
    (hne : policy.allowed ≠ [])
    (hvalid : ∀ r ∈ policy.allowed, r.domain ≠ "") :
    (decideHttpHost policy ".").isBlocked = true := by
  rw [decideHttpHost, canonicalizeHost_dot]
  exact empty_host_blocked_under_allowlist policy hne hvalid

/-- Theorem 4: Wildcard boundary soundness — `*.d` matches `h` iff `h` ends with `.d`. -/
theorem wildcard_boundary_sound (d h : String) :
    matchesRule (.wildcard d) h = true ↔ ∃ pfx : List Char, h.toList = pfx ++ ('.' :: d.toList) :=
  listEndsWith_iff h.toList ('.' :: d.toList)

/-- Theorem 4b: Wildcard `*.d` cannot be suffix-spoofed by a non-dot boundary character
    (e.g. `evil-example.com` cannot match `*.example.com`). -/
theorem wildcard_no_suffix_spoofing (d h : String) (pfx : List Char) (c : Char)
    (hc : c ≠ '.') (hh : h.toList = pfx ++ (c :: d.toList)) :
    matchesRule (.wildcard d) h = false := by
  cases hm : matchesRule (.wildcard d) h with
  | false => rfl
  | true =>
    exfalso
    rcases (wildcard_boundary_sound d h).mp hm with ⟨pfx', hpfx'⟩
    rw [hh] at hpfx'
    have hrev := congrArg List.reverse hpfx'
    simp only [List.reverse_append, List.reverse_cons, List.append_assoc] at hrev
    have htail := List.append_cancel_left hrev
    simp at htail
    exact hc htail.1

/-- Theorem 4c: Stagehand's wildcard `*.d` strictly excludes the apex `d` itself
    (grounded in `domainPolicy.ts:163` and `domainPolicy.test.ts:118,143`). -/
theorem wildcard_excludes_apex (d : String) :
    matchesRule (.wildcard d) d = false := by
  cases hm : matchesRule (.wildcard d) d with
  | false => rfl
  | true =>
    exfalso
    rcases (wildcard_boundary_sound d d).mp hm with ⟨pfx, hpfx⟩
    have hlen := congrArg List.length hpfx
    simp at hlen
    omega

/-- Theorem 5: Adding a blocked rule never turns a `block` decision into `continue`. -/
theorem monotone_blocklist_addition (policy : DomainPolicy) (r : Rule) (h : String)
    (hblk : (decide policy h).isBlocked = true) :
    (decide { policy with blocked := r :: policy.blocked } h).isBlocked = true := by
  unfold decide at hblk ⊢
  cases hmr : matchesRule r h
  · simp only [matchesAny, List.any_cons, hmr, Bool.false_or]
    exact hblk
  · simp [matchesAny, hmr, Decision.isBlocked]

/-- Stronger form of Theorem 5: prepending an arbitrary list of blocked rules preserves blocking. -/
theorem monotone_blocklist_append (policy : DomainPolicy) (extra : List Rule) (h : String)
    (hblk : (decide policy h).isBlocked = true) :
    (decide { policy with blocked := extra ++ policy.blocked } h).isBlocked = true := by
  induction extra with
  | nil => exact hblk
  | cons r rs ih =>
    simpa [List.cons_append] using
      monotone_blocklist_addition { policy with blocked := rs ++ policy.blocked } r h ih

private theorem matchesAny_congr {xs ys : List Rule} (h : String)
    (heq : ∀ r, r ∈ xs ↔ r ∈ ys) :
    matchesAny xs h = matchesAny ys h := by
  cases hx : matchesAny xs h <;> cases hy : matchesAny ys h
  · rfl
  · exfalso
    rcases (matchesAny_eq_true_iff ys h).mp hy with ⟨r, hry, hm⟩
    have hrx : r ∈ xs := (heq r).mpr hry
    have := (matchesAny_eq_true_iff xs h).mpr ⟨r, hrx, hm⟩
    rw [hx] at this
    cases this
  · exfalso
    rcases (matchesAny_eq_true_iff xs h).mp hx with ⟨r, hrx, hm⟩
    have hry : r ∈ ys := (heq r).mp hrx
    have := (matchesAny_eq_true_iff ys h).mpr ⟨r, hry, hm⟩
    rw [hy] at this
    cases this
  · rfl

private theorem isEmpty_congr {xs ys : List Rule}
    (heq : ∀ r, r ∈ xs ↔ r ∈ ys) :
    xs.isEmpty = ys.isEmpty := by
  cases xs with
  | nil =>
    cases ys with
    | nil => rfl
    | cons y _ =>
      have : y ∈ ([] : List Rule) := (heq y).mpr (List.mem_cons_self ..)
      cases this
  | cons x _ =>
    cases ys with
    | nil =>
      have : x ∈ ([] : List Rule) := (heq x).mp (List.mem_cons_self ..)
      cases this
    | cons _ _ => rfl

/-- Theorem 6: Policy decisions depend only on rule set membership, never rule ordering
    or duplicates. -/
theorem rule_order_independent (p₁ p₂ : DomainPolicy) (h : String)
    (hallow : ∀ r, r ∈ p₁.allowed ↔ r ∈ p₂.allowed)
    (hblock : ∀ r, r ∈ p₁.blocked ↔ r ∈ p₂.blocked) :
    decide p₁ h = decide p₂ h := by
  unfold decide
  rw [matchesAny_congr h hblock, matchesAny_congr h hallow, isEmpty_congr hallow]

/-- Theorem 7: Equivalence between the reference decision function and the DNR priority-3/2/1
    compiler semantics for all policies and all canonical hosts (including `""`). -/
theorem decideDnr_eq_decide (policy : DomainPolicy) (h : String) :
    decideDnr policy h = decide policy h := by
  unfold decideDnr decide
  cases matchesAny policy.blocked h <;> cases matchesAny policy.allowed h <;>
    cases policy.allowed.isEmpty <;> rfl

end StagehandProofs.DomainPolicy
