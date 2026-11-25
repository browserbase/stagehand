namespace StagehandProofs.WireCasing

def isLower (c : Char) : Bool := 'a' ≤ c && c ≤ 'z'
def isUpper (c : Char) : Bool := 'A' ≤ c && c ≤ 'Z'
def isDigit (c : Char) : Bool := '0' ≤ c && c ≤ '9'

def toLowerChar (c : Char) : Char :=
  if isUpper c then Char.ofNat (c.toNat + 32) else c

def toUpperChar (c : Char) : Char :=
  if isLower c then Char.ofNat (c.toNat - 32) else c

private theorem isUpper_iff_nat (c : Char) : isUpper c = true ↔ 65 ≤ c.toNat ∧ c.toNat ≤ 90 := by
  simp only [isUpper, Bool.and_eq_true, decide_eq_true_eq, Char.le_def, UInt32.le_iff_toNat_le]
  rfl

private theorem isLower_iff_nat (c : Char) : isLower c = true ↔ 97 ≤ c.toNat ∧ c.toNat ≤ 122 := by
  simp only [isLower, Bool.and_eq_true, decide_eq_true_eq, Char.le_def, UInt32.le_iff_toNat_le]
  rfl

private theorem isDigit_iff_nat (c : Char) : isDigit c = true ↔ 48 ≤ c.toNat ∧ c.toNat ≤ 57 := by
  simp only [isDigit, Bool.and_eq_true, decide_eq_true_eq, Char.le_def, UInt32.le_iff_toNat_le]
  rfl

private theorem toNat_ofNat_small {n : Nat} (h : n < 128) : (Char.ofNat n).toNat = n := by
  have hv : Nat.isValidChar n := Or.inl (by omega)
  simp only [Char.ofNat, hv, ↓reduceDIte, Char.toNat, Char.ofNatAux]
  rfl

theorem isLower_not_upper {c : Char} (h : isLower c = true) : isUpper c = false := by
  rw [isLower_iff_nat] at h
  cases hu : isUpper c with
  | false => rfl
  | true =>
    rw [isUpper_iff_nat] at hu
    omega

theorem isLower_not_digit {c : Char} (h : isLower c = true) : isDigit c = false := by
  rw [isLower_iff_nat] at h
  cases hd : isDigit c with
  | false => rfl
  | true =>
    rw [isDigit_iff_nat] at hd
    omega

theorem isUpper_not_lower {c : Char} (h : isUpper c = true) : isLower c = false := by
  rw [isUpper_iff_nat] at h
  cases hl : isLower c with
  | false => rfl
  | true =>
    rw [isLower_iff_nat] at hl
    omega

theorem isDigit_not_upper {c : Char} (h : isDigit c = true) : isUpper c = false := by
  rw [isDigit_iff_nat] at h
  cases hu : isUpper c with
  | false => rfl
  | true =>
    rw [isUpper_iff_nat] at hu
    omega

theorem isDigit_not_lower {c : Char} (h : isDigit c = true) : isLower c = false := by
  rw [isDigit_iff_nat] at h
  cases hl : isLower c with
  | false => rfl
  | true =>
    rw [isLower_iff_nat] at hl
    omega

theorem isLower_ne_underscore {c : Char} (h : isLower c = true) : c ≠ '_' := by
  intro heq; subst heq; simp [isLower] at h

theorem isDigit_ne_underscore {c : Char} (h : isDigit c = true) : c ≠ '_' := by
  intro heq; subst heq; simp [isDigit] at h

theorem isLower_toLowerChar_of_isUpper {c : Char} (h : isUpper c = true) :
    isLower (toLowerChar c) = true := by
  have hn := (isUpper_iff_nat c).mp h
  simp only [toLowerChar, h, ↓reduceIte, isLower_iff_nat]
  rw [toNat_ofNat_small (by omega)]
  omega

theorem isUpper_toUpperChar_of_isLower {c : Char} (h : isLower c = true) :
    isUpper (toUpperChar c) = true := by
  have hn := (isLower_iff_nat c).mp h
  simp only [toUpperChar, h, ↓reduceIte, isUpper_iff_nat]
  rw [toNat_ofNat_small (by omega)]
  omega

theorem toUpperChar_toLowerChar {c : Char} (h : isUpper c = true) :
    toUpperChar (toLowerChar c) = c := by
  have hn := (isUpper_iff_nat c).mp h
  have hl : isLower (toLowerChar c) = true := isLower_toLowerChar_of_isUpper h
  unfold toUpperChar
  simp only [hl, ↓reduceIte]
  simp only [toLowerChar, h, ↓reduceIte]
  apply Char.ext
  apply UInt32.eq_of_toBitVec_eq
  apply BitVec.eq_of_toNat_eq
  change (Char.ofNat ((Char.ofNat (c.toNat + 32)).toNat - 32)).toNat = c.toNat
  have h1 : (Char.ofNat (c.toNat + 32)).toNat = c.toNat + 32 := toNat_ofNat_small (by omega)
  rw [h1]
  have hsub : c.toNat + 32 - 32 = c.toNat := by omega
  rw [hsub, toNat_ofNat_small (by omega)]

theorem toLowerChar_toUpperChar {c : Char} (h : isLower c = true) :
    toLowerChar (toUpperChar c) = c := by
  have hn := (isLower_iff_nat c).mp h
  have hu : isUpper (toUpperChar c) = true := isUpper_toUpperChar_of_isLower h
  unfold toLowerChar
  simp only [hu, ↓reduceIte]
  simp only [toUpperChar, h, ↓reduceIte]
  apply Char.ext
  apply UInt32.eq_of_toBitVec_eq
  apply BitVec.eq_of_toNat_eq
  change (Char.ofNat ((Char.ofNat (c.toNat - 32)).toNat + 32)).toNat = c.toNat
  have h1 : (Char.ofNat (c.toNat - 32)).toNat = c.toNat - 32 := toNat_ofNat_small (by omega)
  rw [h1]
  have hadd : c.toNat - 32 + 32 = c.toNat := by omega
  rw [hadd, toNat_ofNat_small (by omega)]

theorem toLowerChar_of_isLower {c : Char} (h : isLower c = true) : toLowerChar c = c := by
  simp [toLowerChar, isLower_not_upper h]

def camelToSnakeAux (prevUpper : Bool) : List Char → List Char
  | [] => []
  | c :: rest =>
    if isUpper c then
      match prevUpper, rest with
      | false, _ => '_' :: toLowerChar c :: camelToSnakeAux true rest
      | true, next :: _ =>
        if isLower next then
          '_' :: toLowerChar c :: camelToSnakeAux true rest
        else
          toLowerChar c :: camelToSnakeAux true rest
      | true, [] => [toLowerChar c]
    else
      c :: camelToSnakeAux false rest

def camelToSnakeChars : List Char → List Char
  | [] => []
  | c :: rest => toLowerChar c :: camelToSnakeAux (isUpper c) rest

def snakeToCamelAux (afterDigit : Bool) : List Char → List Char
  | [] => []
  | '_' :: c :: rest =>
    if isLower c then
      toUpperChar c :: snakeToCamelAux false rest
    else
      c :: snakeToCamelAux (isDigit c) rest
  | ['_'] => []
  | c :: rest =>
    if afterDigit && isLower c then
      toUpperChar c :: snakeToCamelAux false rest
    else
      c :: snakeToCamelAux (isDigit c) rest

def snakeToCamelChars : List Char → List Char
  | [] => []
  | c :: rest => c :: snakeToCamelAux (isDigit c) rest

def camelToSnake (s : String) : String :=
  String.ofList (camelToSnakeChars s.toList)

def snakeToCamel (s : String) : String :=
  String.ofList (snakeToCamelChars s.toList)

inductive CanonicalCamelRest : Bool → List Char → Prop where
  | nil {inDigits : Bool} : CanonicalCamelRest inDigits []
  | lower {c : Char} {rest : List Char} :
      isLower c = true → CanonicalCamelRest false rest → CanonicalCamelRest false (c :: rest)
  | digit {inDigits : Bool} {c : Char} {rest : List Char} :
      isDigit c = true → CanonicalCamelRest true rest → CanonicalCamelRest inDigits (c :: rest)
  | upperEnd {inDigits : Bool} {c : Char} :
      isUpper c = true → CanonicalCamelRest inDigits [c]
  | upperLower {inDigits : Bool} {c d : Char} {rest : List Char} :
      isUpper c = true → isLower d = true → CanonicalCamelRest false rest →
      CanonicalCamelRest inDigits (c :: d :: rest)
  | upperDigit {inDigits : Bool} {c d : Char} {rest : List Char} :
      isUpper c = true → isDigit d = true → CanonicalCamelRest true rest →
      CanonicalCamelRest inDigits (c :: d :: rest)

inductive CanonicalCamelChars : List Char → Prop where
  | mk {c : Char} {rest : List Char} :
      isLower c = true → CanonicalCamelRest false rest → CanonicalCamelChars (c :: rest)

def CanonicalCamel (s : String) : Prop :=
  CanonicalCamelChars s.toList

inductive CanonicalSnakeRest : Bool → List Char → Prop where
  | nil {inDigits : Bool} : CanonicalSnakeRest inDigits []
  | lower {c : Char} {rest : List Char} :
      isLower c = true → CanonicalSnakeRest false rest → CanonicalSnakeRest false (c :: rest)
  | digit {inDigits : Bool} {c : Char} {rest : List Char} :
      isDigit c = true → CanonicalSnakeRest true rest → CanonicalSnakeRest inDigits (c :: rest)
  | sepEnd {inDigits : Bool} {c : Char} :
      isLower c = true → CanonicalSnakeRest inDigits ['_', c]
  | sepLower {inDigits : Bool} {c d : Char} {rest : List Char} :
      isLower c = true → isLower d = true → CanonicalSnakeRest false rest →
      CanonicalSnakeRest inDigits ('_' :: c :: d :: rest)
  | sepDigit {inDigits : Bool} {c d : Char} {rest : List Char} :
      isLower c = true → isDigit d = true → CanonicalSnakeRest true rest →
      CanonicalSnakeRest inDigits ('_' :: c :: d :: rest)

inductive CanonicalSnakeChars : List Char → Prop where
  | mk {c : Char} {rest : List Char} :
      isLower c = true → CanonicalSnakeRest false rest → CanonicalSnakeChars (c :: rest)

def CanonicalSnake (s : String) : Prop :=
  CanonicalSnakeChars s.toList

private theorem snakeToCamelAux_cons_lower {c : Char} (hc : isLower c = true) (rest : List Char) :
    snakeToCamelAux false (c :: rest) = c :: snakeToCamelAux false rest := by
  have hne := isLower_ne_underscore hc
  have hnd := isLower_not_digit hc
  cases rest with
  | nil => simp [snakeToCamelAux, hne]
  | cons d tl => simp [snakeToCamelAux, hne, hnd]

private theorem snakeToCamelAux_cons_digit (afterDigit : Bool) {c : Char} (hc : isDigit c = true)
    (rest : List Char) :
    snakeToCamelAux afterDigit (c :: rest) = c :: snakeToCamelAux true rest := by
  have hne := isDigit_ne_underscore hc
  have hnl := isDigit_not_lower hc
  cases rest with
  | nil => simp [snakeToCamelAux, hne, hnl]
  | cons d tl => simp [snakeToCamelAux, hne, hnl, hc]

theorem camelToSnakeAux_preserves_canonical {inDigits : Bool} {cs : List Char}
    (h : CanonicalCamelRest inDigits cs) :
    CanonicalSnakeRest inDigits (camelToSnakeAux false cs) := by
  induction h with
  | nil => exact .nil
  | lower hc _ ih =>
    simp only [camelToSnakeAux, isLower_not_upper hc, Bool.false_eq_true, ↓reduceIte]
    exact .lower hc ih
  | digit hc _ ih =>
    simp only [camelToSnakeAux, isDigit_not_upper hc, Bool.false_eq_true, ↓reduceIte]
    exact .digit hc ih
  | upperEnd hc =>
    simp only [camelToSnakeAux, hc, ↓reduceIte]
    exact .sepEnd (isLower_toLowerChar_of_isUpper hc)
  | upperLower hc hd _ ih =>
    simp only [camelToSnakeAux, hc, isLower_not_upper hd, Bool.false_eq_true, ↓reduceIte]
    exact .sepLower (isLower_toLowerChar_of_isUpper hc) hd ih
  | upperDigit hc hd _ ih =>
    simp only [camelToSnakeAux, hc, isDigit_not_upper hd, Bool.false_eq_true, ↓reduceIte]
    exact .sepDigit (isLower_toLowerChar_of_isUpper hc) hd ih

theorem camelToSnakeChars_preserves_canonical {cs : List Char} (h : CanonicalCamelChars cs) :
    CanonicalSnakeChars (camelToSnakeChars cs) := by
  cases h with
  | mk hc hrest =>
    simp only [camelToSnakeChars, toLowerChar_of_isLower hc, isLower_not_upper hc]
    exact .mk hc (camelToSnakeAux_preserves_canonical hrest)

theorem snakeToCamelAux_preserves_canonical {inDigits : Bool} {cs : List Char}
    (h : CanonicalSnakeRest inDigits cs) :
    CanonicalCamelRest inDigits (snakeToCamelAux inDigits cs) := by
  induction h with
  | nil => exact .nil
  | lower hc _ ih =>
    rw [snakeToCamelAux_cons_lower hc]
    exact .lower hc ih
  | digit hc _ ih =>
    rw [snakeToCamelAux_cons_digit _ hc]
    exact .digit hc ih
  | sepEnd hc =>
    simp only [snakeToCamelAux, hc, ↓reduceIte]
    exact .upperEnd (isUpper_toUpperChar_of_isLower hc)
  | sepLower hc hd _ ih =>
    simp only [snakeToCamelAux, hc, ↓reduceIte]
    rw [snakeToCamelAux_cons_lower hd]
    exact .upperLower (isUpper_toUpperChar_of_isLower hc) hd ih
  | sepDigit hc hd _ ih =>
    simp only [snakeToCamelAux, hc, ↓reduceIte]
    rw [snakeToCamelAux_cons_digit false hd]
    exact .upperDigit (isUpper_toUpperChar_of_isLower hc) hd ih

theorem snakeToCamelChars_preserves_canonical {cs : List Char} (h : CanonicalSnakeChars cs) :
    CanonicalCamelChars (snakeToCamelChars cs) := by
  cases h with
  | mk hc hrest =>
    simp only [snakeToCamelChars, isLower_not_digit hc]
    exact .mk hc (snakeToCamelAux_preserves_canonical hrest)

theorem snakeToCamelAux_camelToSnakeAux_id {inDigits : Bool} {cs : List Char}
    (h : CanonicalCamelRest inDigits cs) :
    snakeToCamelAux inDigits (camelToSnakeAux false cs) = cs := by
  induction h with
  | nil => rfl
  | lower hc _ ih =>
    simp only [camelToSnakeAux, isLower_not_upper hc, Bool.false_eq_true, ↓reduceIte]
    rw [snakeToCamelAux_cons_lower hc, ih]
  | digit hc _ ih =>
    simp only [camelToSnakeAux, isDigit_not_upper hc, Bool.false_eq_true, ↓reduceIte]
    rw [snakeToCamelAux_cons_digit _ hc, ih]
  | upperEnd hc =>
    simp only [camelToSnakeAux, hc, ↓reduceIte, snakeToCamelAux,
      isLower_toLowerChar_of_isUpper hc, toUpperChar_toLowerChar hc]
  | upperLower hc hd _ ih =>
    simp only [camelToSnakeAux, hc, isLower_not_upper hd, Bool.false_eq_true, ↓reduceIte,
      snakeToCamelAux, isLower_toLowerChar_of_isUpper hc, toUpperChar_toLowerChar hc]
    rw [snakeToCamelAux_cons_lower hd, ih]
  | upperDigit hc hd _ ih =>
    simp only [camelToSnakeAux, hc, isDigit_not_upper hd, Bool.false_eq_true, ↓reduceIte,
      snakeToCamelAux, isLower_toLowerChar_of_isUpper hc, toUpperChar_toLowerChar hc]
    rw [snakeToCamelAux_cons_digit false hd, ih]

theorem snakeToCamelChars_camelToSnakeChars_id {cs : List Char} (h : CanonicalCamelChars cs) :
    snakeToCamelChars (camelToSnakeChars cs) = cs := by
  cases h with
  | mk hc hrest =>
    simp only [camelToSnakeChars, toLowerChar_of_isLower hc, isLower_not_upper hc,
      snakeToCamelChars, isLower_not_digit hc]
    rw [snakeToCamelAux_camelToSnakeAux_id hrest]

theorem camelToSnakeAux_snakeToCamelAux_id {inDigits : Bool} {cs : List Char}
    (h : CanonicalSnakeRest inDigits cs) :
    camelToSnakeAux false (snakeToCamelAux inDigits cs) = cs := by
  induction h with
  | nil => rfl
  | lower hc _ ih =>
    rw [snakeToCamelAux_cons_lower hc]
    simp only [camelToSnakeAux, isLower_not_upper hc, Bool.false_eq_true, ↓reduceIte, ih]
  | digit hc _ ih =>
    rw [snakeToCamelAux_cons_digit _ hc]
    simp only [camelToSnakeAux, isDigit_not_upper hc, Bool.false_eq_true, ↓reduceIte, ih]
  | sepEnd hc =>
    simp only [snakeToCamelAux, hc, ↓reduceIte, camelToSnakeAux,
      isUpper_toUpperChar_of_isLower hc, toLowerChar_toUpperChar hc]
  | sepLower hc hd _ ih =>
    simp only [snakeToCamelAux, hc, ↓reduceIte]
    rw [snakeToCamelAux_cons_lower hd]
    simp only [camelToSnakeAux, isUpper_toUpperChar_of_isLower hc,
      isLower_not_upper hd, Bool.false_eq_true, ↓reduceIte, toLowerChar_toUpperChar hc, ih]
  | sepDigit hc hd _ ih =>
    simp only [snakeToCamelAux, hc, ↓reduceIte]
    rw [snakeToCamelAux_cons_digit false hd]
    simp only [camelToSnakeAux, isUpper_toUpperChar_of_isLower hc,
      isDigit_not_upper hd, Bool.false_eq_true, ↓reduceIte, toLowerChar_toUpperChar hc, ih]

theorem camelToSnakeChars_snakeToCamelChars_id {cs : List Char} (h : CanonicalSnakeChars cs) :
    camelToSnakeChars (snakeToCamelChars cs) = cs := by
  cases h with
  | mk hc hrest =>
    simp only [snakeToCamelChars, isLower_not_digit hc, camelToSnakeChars,
      toLowerChar_of_isLower hc, isLower_not_upper hc]
    rw [camelToSnakeAux_snakeToCamelAux_id hrest]

theorem snakeToCamel_camelToSnake_id (s : String) (h : CanonicalCamel s) :
    snakeToCamel (camelToSnake s) = s := by
  unfold snakeToCamel camelToSnake
  rw [String.toList_ofList, snakeToCamelChars_camelToSnakeChars_id h, String.ofList_toList]

theorem camelToSnake_snakeToCamel_id (s : String) (h : CanonicalSnake s) :
    camelToSnake (snakeToCamel s) = s := by
  unfold camelToSnake snakeToCamel
  rw [String.toList_ofList, camelToSnakeChars_snakeToCamelChars_id h, String.ofList_toList]

theorem camelToSnake_preserves_canonical (s : String) (h : CanonicalCamel s) :
    CanonicalSnake (camelToSnake s) := by
  unfold CanonicalSnake camelToSnake
  rw [String.toList_ofList]
  exact camelToSnakeChars_preserves_canonical h

theorem snakeToCamel_preserves_canonical (s : String) (h : CanonicalSnake s) :
    CanonicalCamel (snakeToCamel s) := by
  unfold CanonicalCamel snakeToCamel
  rw [String.toList_ofList]
  exact snakeToCamelChars_preserves_canonical h

theorem acronym_loss_without_table :
    snakeToCamel (camelToSnake "baseURL") ≠ "baseURL" := by
  decide

theorem digit_followed_by_lower_camel_loss :
    snakeToCamel (camelToSnake "aA0a") ≠ "aA0a" := by
  decide

theorem digit_followed_by_lower_snake_loss :
    camelToSnake (snakeToCamel "a2a") ≠ "a2a" := by
  decide

inductive JsonVal where
  | jnull
  | jbool (b : Bool)
  | jint (n : Int)
  | jstr (s : String)
  | jarr (items : List JsonVal)
  | jobj (fields : List (String × JsonVal))
  deriving Repr

def isPreservedPrefix (k : String) : Bool :=
  match k.toList with
  | '$' :: _ => true
  | '_' :: _ => true
  | _ => false

def toWireKey (k : String) : String :=
  if isPreservedPrefix k || k == "constructor" then k else camelToSnake k

def fromWireKey (k : String) : String :=
  if isPreservedPrefix k || k == "constructor" then k
  else if k == "base_url" then "baseURL"
  else if k == "prefer_css_page_size" then "preferCSSPageSize"
  else if k == "ignore_https_errors" then "ignoreHTTPSErrors"
  else snakeToCamel k

theorem wireKey_roundtrip_special_and_acronyms :
    fromWireKey (toWireKey "baseURL") = "baseURL" ∧
    fromWireKey (toWireKey "preferCSSPageSize") = "preferCSSPageSize" ∧
    fromWireKey (toWireKey "ignoreHTTPSErrors") = "ignoreHTTPSErrors" ∧
    fromWireKey (toWireKey "$schema") = "$schema" ∧
    fromWireKey (toWireKey "__proto__") = "__proto__" ∧
    fromWireKey (toWireKey "constructor") = "constructor" := by
  decide

mutual
  def transformJson (keyFn : String → String) (opaqueKeys : List String) : JsonVal → JsonVal
    | .jnull => .jnull
    | .jbool b => .jbool b
    | .jint n => .jint n
    | .jstr s => .jstr s
    | .jarr items => .jarr (transformList keyFn opaqueKeys items)
    | .jobj fields => .jobj (transformFields keyFn opaqueKeys fields)

  def transformList (keyFn : String → String) (opaqueKeys : List String) : List JsonVal → List JsonVal
    | [] => []
    | x :: xs => transformJson keyFn opaqueKeys x :: transformList keyFn opaqueKeys xs

  def transformFields (keyFn : String → String) (opaqueKeys : List String) :
      List (String × JsonVal) → List (String × JsonVal)
    | [] => []
    | (k, v) :: rest =>
      let v' := if k ∈ opaqueKeys then v else transformJson keyFn opaqueKeys v
      (keyFn k, v') :: transformFields keyFn opaqueKeys rest
end

def toWireTree (opaqueKeys : List String) (v : JsonVal) : JsonVal :=
  transformJson toWireKey opaqueKeys v

def fromWireTree (opaqueKeys : List String) (v : JsonVal) : JsonVal :=
  transformJson fromWireKey (opaqueKeys.map toWireKey) v

def lookupField (k : String) : List (String × JsonVal) → Option JsonVal
  | [] => none
  | (k', v) :: rest => if k' == k then some v else lookupField k rest

def lookupPath : List String → JsonVal → Option JsonVal
  | [], v => some v
  | k :: ks, .jobj fields =>
    match lookupField k fields with
    | some child => lookupPath ks child
    | none => none
  | _ :: _, _ => none

theorem transformFields_preserves_opaque_entry
    (keyFn : String → String) (opaqueKeys : List String)
    (fields : List (String × JsonVal)) (k : String) (v : JsonVal)
    (hmem : (k, v) ∈ fields) (hopaque : k ∈ opaqueKeys) :
    (keyFn k, v) ∈ transformFields keyFn opaqueKeys fields := by
  induction fields with
  | nil =>
    cases hmem
  | cons hd tl ih =>
    cases hd with
    | mk k' v' =>
      simp only [transformFields]
      rcases List.mem_cons.mp hmem with heq | htl
      · injection heq with hk hv
        subst hk; subst hv
        simp [hopaque]
      · exact List.mem_cons_of_mem _ (ih htl)

theorem opaqueKey_subtree_preserved
    (keyFn : String → String) (opaqueKeys : List String)
    (fields : List (String × JsonVal)) (k : String) (v : JsonVal)
    (hmem : (k, v) ∈ fields) (hopaque : k ∈ opaqueKeys)
    (hinj : ∀ k' v', (k', v') ∈ fields → keyFn k' = keyFn k → k' = k)
    (huniq : lookupField k fields = some v) :
    lookupField (keyFn k) (transformFields keyFn opaqueKeys fields) = some v := by
  induction fields with
  | nil =>
    cases hmem
  | cons hd tl ih =>
    cases hd with
    | mk k' v' =>
      simp only [transformFields]
      by_cases hk : k' = k
      · subst hk
        simp only [lookupField, beq_self_eq_true, ↓reduceIte] at huniq ⊢
        injection huniq with hv
        subst hv
        simp [hopaque]
      · have hne_fn : keyFn k' ≠ keyFn k := by
          intro heq
          exact hk (hinj k' v' (List.mem_cons_self ..) heq)
        have hbeq_orig : (k' == k) = false := beq_false_of_ne hk
        have hbeq_fn : (keyFn k' == keyFn k) = false := beq_false_of_ne hne_fn
        simp only [lookupField, hbeq_orig, Bool.false_eq_true, ↓reduceIte] at huniq
        simp only [lookupField, hbeq_fn, Bool.false_eq_true, ↓reduceIte]
        have hmem_tl : (k, v) ∈ tl := by
          rcases List.mem_cons.mp hmem with heq | htl
          · injection heq with hk'; exact absurd hk'.symm hk
          · exact htl
        exact ih hmem_tl (fun k'' v'' hm => hinj k'' v'' (List.mem_cons_of_mem _ hm)) huniq

theorem opaqueKey_nested_subtree_preserved
    (keyFn : String → String) (opaqueKeys : List String)
    (hinj : ∀ a b, keyFn a = keyFn b → a = b) :
    ∀ (path : List String) (opaqueKey : String) (root subtree : JsonVal),
      opaqueKey ∈ opaqueKeys →
      (∀ p ∈ path, p ∉ opaqueKeys) →
      lookupPath (path ++ [opaqueKey]) root = some subtree →
      lookupPath (path.map keyFn ++ [keyFn opaqueKey]) (transformJson keyFn opaqueKeys root) =
        some subtree := by
  intro path
  induction path with
  | nil =>
    intro opaqueKey root subtree hopaque _ hlook
    cases root with
    | jobj fields =>
      simp only [List.nil_append, List.map_nil, lookupPath, transformJson] at hlook ⊢
      cases hlf : lookupField opaqueKey fields with
      | none => simp [hlf] at hlook
      | some child =>
        simp [hlf] at hlook
        subst hlook
        have hmem : (opaqueKey, child) ∈ fields := by
          clear hopaque hinj
          induction fields with
          | nil => simp [lookupField] at hlf
          | cons hd tl ih =>
            cases hd with
            | mk k' v' =>
              simp only [lookupField] at hlf
              split at hlf
              · rename_i heq
                have hk' : k' = opaqueKey := eq_of_beq heq
                injection hlf with hv'
                subst hk'; subst hv'
                exact List.mem_cons_self ..
              · exact List.mem_cons_of_mem _ (ih hlf)
        have hres := opaqueKey_subtree_preserved keyFn opaqueKeys fields opaqueKey child
          hmem hopaque (fun k' _ _ hfn => hinj k' opaqueKey hfn) hlf
        simp [hres]
    | jnull | jbool _ | jint _ | jstr _ | jarr _ =>
      simp [lookupPath] at hlook
  | cons p ps ih =>
    intro opaqueKey root subtree hopaque hnotop hlook
    cases root with
    | jobj fields =>
      simp only [List.cons_append, List.map_cons, lookupPath, transformJson] at hlook ⊢
      cases hlf : lookupField p fields with
      | none => simp [hlf] at hlook
      | some child =>
        simp [hlf] at hlook
        have hp_notop : p ∉ opaqueKeys := hnotop p (List.mem_cons_self ..)
        have hps_notop : ∀ q ∈ ps, q ∉ opaqueKeys :=
          fun q hq => hnotop q (List.mem_cons_of_mem _ hq)
        have hstep : lookupField (keyFn p) (transformFields keyFn opaqueKeys fields) =
            some (transformJson keyFn opaqueKeys child) := by
          clear hlook ih hps_notop
          induction fields with
          | nil => simp [lookupField] at hlf
          | cons hd tl ihf =>
            cases hd with
            | mk k' v' =>
              simp only [lookupField] at hlf
              simp only [transformFields, lookupField]
              by_cases hk : k' = p
              · subst hk
                simp only [beq_self_eq_true, ↓reduceIte] at hlf ⊢
                injection hlf with hv
                subst hv
                simp [hp_notop]
              · have hbeq1 : (k' == p) = false := beq_false_of_ne hk
                have hne2 : keyFn k' ≠ keyFn p := fun heq => hk (hinj k' p heq)
                have hbeq2 : (keyFn k' == keyFn p) = false := beq_false_of_ne hne2
                simp only [hbeq1, Bool.false_eq_true, ↓reduceIte] at hlf
                simp only [hbeq2, Bool.false_eq_true, ↓reduceIte]
                exact ihf hlf
        rw [hstep]
        exact ih opaqueKey child subtree hopaque hps_notop hlook
    | jnull | jbool _ | jint _ | jstr _ | jarr _ =>
      simp [lookupPath] at hlook

end StagehandProofs.WireCasing
