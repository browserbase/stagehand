namespace StagehandProofs.ProtocolVersion

structure SemVer where
  major : Nat
  minor : Nat
  patch : Nat
  prerelease : Option String
  build : Option String
  deriving DecidableEq, Repr

inductive ProtocolIncompatibilityReason where
  | invalidVersion
  | majorMismatch
  | serverTooOld
  | prereleaseMismatch
  deriving DecidableEq, Repr

inductive ProtocolCompatibility where
  | compatible
  | incompatible (reason : ProtocolIncompatibilityReason)
  deriving DecidableEq, Repr

def checkProtocolCompatibility (client server : Option SemVer) : ProtocolCompatibility :=
  match client, server with
  | none, _ => .incompatible .invalidVersion
  | _, none => .incompatible .invalidVersion
  | some c, some s =>
    if c.prerelease.isSome || s.prerelease.isSome then
      if c.major == s.major && c.minor == s.minor && c.patch == s.patch && c.prerelease == s.prerelease then
        .compatible
      else
        .incompatible .prereleaseMismatch
    else if c.major != s.major then
      .incompatible .majorMismatch
    else if s.minor < c.minor then
      .incompatible .serverTooOld
    else
      .compatible

theorem protocol_compat_reflexive (v : SemVer) :
    checkProtocolCompatibility (some v) (some v) = .compatible := by
  unfold checkProtocolCompatibility
  cases h : v.prerelease <;> simp

theorem protocol_invalid_client (s : Option SemVer) :
    checkProtocolCompatibility none s = .incompatible .invalidVersion := by
  rfl

theorem protocol_invalid_server (c : Option SemVer) :
    checkProtocolCompatibility c none = .incompatible .invalidVersion := by
  cases c <;> rfl

theorem protocol_major_mismatch_sound (c s : SemVer)
    (hc : c.prerelease = none) (hs : s.prerelease = none) (hmaj : c.major ≠ s.major) :
    checkProtocolCompatibility (some c) (some s) = .incompatible .majorMismatch := by
  unfold checkProtocolCompatibility
  simp [hc, hs, hmaj]

theorem protocol_compatible_implies_same_major (c s : SemVer)
    (h : checkProtocolCompatibility (some c) (some s) = .compatible) :
    c.major = s.major := by
  unfold checkProtocolCompatibility at h
  by_cases hpre : (c.prerelease.isSome || s.prerelease.isSome) = true
  · simp [hpre] at h
    exact h.1
  · simp [hpre] at h
    split at h
    · assumption
    · cases h

theorem protocol_compatible_stable_bounds (c s : SemVer)
    (hc : c.prerelease = none) (hs : s.prerelease = none)
    (h : checkProtocolCompatibility (some c) (some s) = .compatible) :
    c.major = s.major ∧ c.minor ≤ s.minor := by
  unfold checkProtocolCompatibility at h
  simp [hc, hs] at h
  split at h
  · rename_i hmaj
    split at h
    · cases h
    · rename_i hmin
      exact ⟨hmaj, Nat.le_of_not_lt hmin⟩
  · cases h

theorem protocol_minor_monotonicity (c s1 s2 : SemVer)
    (hc : c.prerelease = none) (hs1 : s1.prerelease = none) (hs2 : s2.prerelease = none)
    (hcompat : checkProtocolCompatibility (some c) (some s1) = .compatible)
    (hmaj : s2.major = s1.major) (hmin : s1.minor ≤ s2.minor) :
    checkProtocolCompatibility (some c) (some s2) = .compatible := by
  have ⟨hcmaj, hcmin⟩ := protocol_compatible_stable_bounds c s1 hc hs1 hcompat
  unfold checkProtocolCompatibility
  have hm : c.major = s2.major := by omega
  have hnotlt : ¬(s2.minor < c.minor) := by omega
  simp [hc, hs2, hm, hnotlt]

theorem protocol_compat_transitive (a b c : SemVer)
    (hab : checkProtocolCompatibility (some a) (some b) = .compatible)
    (hbc : checkProtocolCompatibility (some b) (some c) = .compatible) :
    checkProtocolCompatibility (some a) (some c) = .compatible := by
  cases ha : a.prerelease with
  | none =>
    cases hb : b.prerelease with
    | none =>
      cases hc : c.prerelease with
      | none =>
        have ⟨hm1, hn1⟩ := protocol_compatible_stable_bounds a b ha hb hab
        have ⟨hm2, hn2⟩ := protocol_compatible_stable_bounds b c hb hc hbc
        unfold checkProtocolCompatibility
        have hm : a.major = c.major := by omega
        have hnotlt : ¬(c.minor < a.minor) := by omega
        simp [ha, hc, hm, hnotlt]
      | some pc =>
        unfold checkProtocolCompatibility at hbc
        simp [hb, hc] at hbc
    | some pb =>
      unfold checkProtocolCompatibility at hab
      simp [ha, hb] at hab
  | some pa =>
    unfold checkProtocolCompatibility at hab
    simp [ha] at hab
    rcases hab with ⟨hm1, hn1, hp1, hpr1⟩
    have hb : b.prerelease = some pa := hpr1.symm
    unfold checkProtocolCompatibility at hbc
    simp [hb] at hbc
    rcases hbc with ⟨hm2, hn2, hp2, hpr2⟩
    unfold checkProtocolCompatibility
    simp [ha, hm1.trans hm2, hn1.trans hn2, hp1.trans hp2, hpr2]

theorem protocol_build_metadata_invariant (c s : SemVer) (b1 b2 : Option String) :
    checkProtocolCompatibility (some { c with build := b1 }) (some { s with build := b2 }) =
      checkProtocolCompatibility (some c) (some s) := by
  rfl

theorem protocol_patch_invariant_stable (c s : SemVer) (p1 p2 : Nat)
    (hc : c.prerelease = none) (hs : s.prerelease = none) :
    checkProtocolCompatibility (some { c with patch := p1 }) (some { s with patch := p2 }) =
      checkProtocolCompatibility (some c) (some s) := by
  unfold checkProtocolCompatibility
  simp [hc, hs]

theorem protocol_prerelease_symmetric (c s : SemVer)
    (h : c.prerelease.isSome = true ∨ s.prerelease.isSome = true) :
    checkProtocolCompatibility (some c) (some s) =
      checkProtocolCompatibility (some s) (some c) := by
  unfold checkProtocolCompatibility
  have h1 : (c.prerelease.isSome || s.prerelease.isSome) = true := by
    cases h with
    | inl hc => simp [hc]
    | inr hs => simp [hs]
  have h2 : (s.prerelease.isSome || c.prerelease.isSome) = true := by
    cases h with
    | inl hc => simp [hc]
    | inr hs => simp [hs]
  simp only [h1, h2, ↓reduceIte]
  by_cases heq : c.major = s.major ∧ c.minor = s.minor ∧ c.patch = s.patch ∧ c.prerelease = s.prerelease
  · rcases heq with ⟨hm, hn, hp, hpr⟩
    simp [hm, hn, hp, hpr]
  · have hb1 : (c.major == s.major && c.minor == s.minor && c.patch == s.patch && c.prerelease == s.prerelease) = false := by
      cases hbool : (c.major == s.major && c.minor == s.minor && c.patch == s.patch && c.prerelease == s.prerelease) with
      | false => rfl
      | true =>
        simp only [Bool.and_eq_true, beq_iff_eq] at hbool
        exact absurd ⟨hbool.1.1.1, hbool.1.1.2, hbool.1.2, hbool.2⟩ heq
    have hb2 : (s.major == c.major && s.minor == c.minor && s.patch == c.patch && s.prerelease == c.prerelease) = false := by
      cases hbool : (s.major == c.major && s.minor == c.minor && s.patch == c.patch && s.prerelease == c.prerelease) with
      | false => rfl
      | true =>
        simp only [Bool.and_eq_true, beq_iff_eq] at hbool
        exact absurd ⟨hbool.1.1.1.symm, hbool.1.1.2.symm, hbool.1.2.symm, hbool.2.symm⟩ heq
    simp [hb1, hb2]

def stagehandRuntimeName : String := "stagehand"

inductive MarkerInput where
  | missing
  | unreadable
  | readable (serverName : String) (protocolVersion : Option SemVer)
  deriving DecidableEq, Repr

inductive RuntimeIncompatibilityReason where
  | protocol (reason : ProtocolIncompatibilityReason)
  | runtimeNameMismatch
  deriving DecidableEq, Repr

inductive RuntimeCompatibility where
  | compatible
  | incompatible (reason : RuntimeIncompatibilityReason)
  | missingMarker
  | unreadableMarker
  deriving DecidableEq, Repr

def negotiateRuntimeCompatibility
    (required : Option SemVer) (marker : MarkerInput) : RuntimeCompatibility :=
  match marker with
  | .missing => .missingMarker
  | .unreadable => .unreadableMarker
  | .readable serverName reported =>
    if serverName != stagehandRuntimeName then
      .incompatible .runtimeNameMismatch
    else
      match checkProtocolCompatibility required reported with
      | .compatible => .compatible
      | .incompatible reason => .incompatible (.protocol reason)

theorem runtime_negotiation_compatible_iff (required : Option SemVer) (marker : MarkerInput) :
    negotiateRuntimeCompatibility required marker = .compatible ↔
      ∃ reported, marker = .readable stagehandRuntimeName reported ∧
        checkProtocolCompatibility required reported = .compatible := by
  constructor
  · intro h
    cases marker with
    | missing => simp [negotiateRuntimeCompatibility] at h
    | unreadable => simp [negotiateRuntimeCompatibility] at h
    | readable name reported =>
      unfold negotiateRuntimeCompatibility at h
      by_cases hname : name = stagehandRuntimeName
      · subst hname
        simp at h
        cases hcompat : checkProtocolCompatibility required reported with
        | compatible => exact ⟨reported, rfl, hcompat⟩
        | incompatible r => simp [hcompat] at h
      · simp [hname] at h
  · rintro ⟨reported, rfl, hcompat⟩
    simp [negotiateRuntimeCompatibility, hcompat]

end StagehandProofs.ProtocolVersion
