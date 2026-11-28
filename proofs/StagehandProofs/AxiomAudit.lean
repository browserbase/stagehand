import Lean
import StagehandProofs.RedactionNonInterference

open Lean Elab Command

private def allowedAxioms : List Name :=
  [``propext, ``Classical.choice, ``Quot.sound]

elab "#audit_stagehand_axioms " ids:ident+ : command => do
  for id in ids do
    let declName ← liftCoreM <| realizeGlobalConstNoOverloadWithInfo id
    let axioms ← Lean.collectAxioms declName
    let disallowed := axioms.toList.filter (fun ax => !allowedAxioms.contains ax)
    if !disallowed.isEmpty then
      throwError "Theorem {declName} depends on disallowed axioms: {disallowed}"

#audit_stagehand_axioms
  StagehandProofs.redactSyms_no_secret
  StagehandProofs.redactSyms_idempotent
  StagehandProofs.redactSyms_eq_of_clean
  StagehandProofs.redactChars_no_secret
  StagehandProofs.redactChars_idempotent
  StagehandProofs.redactTree_no_secret_token
  StagehandProofs.redactTree_idempotent
  StagehandProofs.redactTree_preserves_shape
  StagehandProofs.truncate_respects_bound
  StagehandProofs.truncateUtf16Safe_respects_bound
  StagehandProofs.truncateUtf16Safe_preserves_wellFormed
