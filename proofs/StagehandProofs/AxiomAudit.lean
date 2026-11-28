/-
  StagehandProofs.AxiomAudit

  Audits the exact axiom footprint of every main theorem across all four Stagehand
  formal verification modules. `scripts/verify-lean-proofs.sh` checks that only
  standard Lean kernel axioms appear in the audit output.
-/

import StagehandProofs.DomainPolicy
import StagehandProofs.FrameTree
import StagehandProofs.LocatorChain
import StagehandProofs.CacheSafety

-- DomainPolicy theorems
#print axioms StagehandProofs.DomainPolicy.blocked_always_wins
#print axioms StagehandProofs.DomainPolicy.allowlist_default_deny
#print axioms StagehandProofs.DomainPolicy.allowlist_default_deny_reason
#print axioms StagehandProofs.DomainPolicy.empty_host_blocked_under_allowlist
#print axioms StagehandProofs.DomainPolicy.dot_host_blocked_under_allowlist
#print axioms StagehandProofs.DomainPolicy.wildcard_boundary_sound
#print axioms StagehandProofs.DomainPolicy.wildcard_no_suffix_spoofing
#print axioms StagehandProofs.DomainPolicy.wildcard_excludes_apex
#print axioms StagehandProofs.DomainPolicy.monotone_blocklist_addition
#print axioms StagehandProofs.DomainPolicy.monotone_blocklist_append
#print axioms StagehandProofs.DomainPolicy.rule_order_independent
#print axioms StagehandProofs.DomainPolicy.decideDnr_eq_decide

-- FrameTree theorems
#print axioms StagehandProofs.FrameTree.init_wellFormed
#print axioms StagehandProofs.FrameTree.runEvents_preserves_wellFormed
#print axioms StagehandProofs.FrameTree.init_runEvents_wellFormed
#print axioms StagehandProofs.FrameTree.wellFormed_no_cycles
#print axioms StagehandProofs.FrameTree.wellFormed_reaches_root

-- LocatorChain theorems
#print axioms StagehandProofs.LocatorChain.resolveChain_session_isolation
#print axioms StagehandProofs.LocatorChain.resolveChain_zero_objectGroup_leak
#print axioms StagehandProofs.LocatorChain.resolveChain_release_retains_only_failed
#print axioms StagehandProofs.LocatorChain.slice_bounds_sound
#print axioms StagehandProofs.LocatorChain.sliceIndex_lt_length
#print axioms StagehandProofs.LocatorChain.sliceIndex_deterministic

-- CacheSafety theorems
#print axioms StagehandProofs.CacheSafety.at_most_one_committed_route
#print axioms StagehandProofs.CacheSafety.no_competing_route_commits
#print axioms StagehandProofs.CacheSafety.no_cache_write_on_recovery_or_failure
#print axioms StagehandProofs.CacheSafety.abort_prevents_new_dispatch
#print axioms StagehandProofs.CacheSafety.dispatched_within_plan
