import Lean
import StagehandProofs.WireCasing
import StagehandProofs.RpcCancellation
import StagehandProofs.ProtocolVersion

open Lean Elab Command

elab "#audit_stagehand_axioms" : command => do
  let env ← getEnv
  let allowed : Array Name := #[``propext, ``Classical.choice, ``Quot.sound]
  let targets : Array Name := #[
    ``StagehandProofs.WireCasing.snakeToCamel_camelToSnake_id,
    ``StagehandProofs.WireCasing.camelToSnake_snakeToCamel_id,
    ``StagehandProofs.WireCasing.camelToSnake_preserves_canonical,
    ``StagehandProofs.WireCasing.snakeToCamel_preserves_canonical,
    ``StagehandProofs.WireCasing.acronym_loss_without_table,
    ``StagehandProofs.WireCasing.digit_followed_by_lower_camel_loss,
    ``StagehandProofs.WireCasing.digit_followed_by_lower_snake_loss,
    ``StagehandProofs.WireCasing.wireKey_roundtrip_special_and_acronyms,
    ``StagehandProofs.WireCasing.opaqueKey_subtree_preserved,
    ``StagehandProofs.WireCasing.opaqueKey_nested_subtree_preserved,
    ``StagehandProofs.WireCasing.fromWireTree_preserves_api_and_wire_opaque_entries,
    ``StagehandProofs.RpcCancellation.single_settlement_invariant,
    ``StagehandProofs.RpcCancellation.late_response_ignored_after_settlement,
    ``StagehandProofs.RpcCancellation.no_pending_leak_after_close,
    ``StagehandProofs.RpcCancellation.no_pending_leak_after_releaseClient,
    ``StagehandProofs.RpcCancellation.cancel_drop_safety,
    ``StagehandProofs.RpcCancellation.disjoint_pending_settled,
    ``StagehandProofs.RpcCancellation.in_flight_abort_queues_cancel_on_dispatch_success,
    ``StagehandProofs.ProtocolVersion.protocol_compat_reflexive,
    ``StagehandProofs.ProtocolVersion.protocol_invalid_client,
    ``StagehandProofs.ProtocolVersion.protocol_invalid_server,
    ``StagehandProofs.ProtocolVersion.protocol_major_mismatch_sound,
    ``StagehandProofs.ProtocolVersion.protocol_compatible_implies_same_major,
    ``StagehandProofs.ProtocolVersion.protocol_minor_monotonicity,
    ``StagehandProofs.ProtocolVersion.protocol_compat_transitive,
    ``StagehandProofs.ProtocolVersion.protocol_build_metadata_invariant,
    ``StagehandProofs.ProtocolVersion.protocol_patch_invariant_stable,
    ``StagehandProofs.ProtocolVersion.protocol_prerelease_symmetric,
    ``StagehandProofs.ProtocolVersion.runtime_negotiation_empty_fields_unreadable,
    ``StagehandProofs.ProtocolVersion.runtime_negotiation_compatible_iff
  ]
  for name in targets do
    unless env.contains name do
      throwError "Missing theorem {name}"
    let axioms ← Lean.collectAxioms name
    for ax in axioms do
      unless allowed.contains ax do
        throwError "Disallowed axiom {ax} used by {name}"
  return ()

#audit_stagehand_axioms
