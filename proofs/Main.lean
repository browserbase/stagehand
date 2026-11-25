import StagehandProofs.DomainPolicy
import StagehandProofs.FrameTree
import StagehandProofs.LocatorChain
import StagehandProofs.CacheSafety

open StagehandProofs.DomainPolicy
open StagehandProofs.FrameTree
open StagehandProofs.LocatorChain
open StagehandProofs.CacheSafety

private def escapeJson (s : String) : String :=
  String.ofList <| s.toList.flatMap fun c =>
    match c with
    | '"' => ['\\', '"']
    | '\\' => ['\\', '\\']
    | '\n' => ['\\', 'n']
    | _ => [c]

private def jsonStr (s : String) : String :=
  "\"" ++ escapeJson s ++ "\""

private def ruleToPattern : Rule → String
  | .exact d => d
  | .wildcard d => "*." ++ d

private def jsonStrArray (xs : List String) : String :=
  "[" ++ String.intercalate ", " (xs.map jsonStr) ++ "]"

private def decisionToJson : Decision → String
  | .continue => "{\"action\":\"continue\"}"
  | .block .blockedDomains => "{\"action\":\"block\",\"reason\":\"blockedDomains\"}"
  | .block .allowedDomains => "{\"action\":\"block\",\"reason\":\"allowedDomains\"}"

structure PolicyVector where
  name : String
  allowed : List Rule
  blocked : List Rule
  rawHost : String

private def domainPolicyVectors : List PolicyVector :=
  [ { name := "exact-blocked"
      allowed := []
      blocked := [.exact "blocked.test"]
      rawHost := "BLOCKED.TEST." }
  , { name := "block-beats-allow-exact"
      allowed := [.exact "example.test"]
      blocked := [.exact "example.test"]
      rawHost := "example.test.." }
  , { name := "block-beats-allow-wildcard"
      allowed := [.wildcard "example.test"]
      blocked := [.exact "private.example.test"]
      rawHost := "private.example.test" }
  , { name := "wildcard-subdomain-allowed"
      allowed := [.wildcard "example.test"]
      blocked := [.exact "private.example.test"]
      rawHost := "public.example.test" }
  , { name := "wildcard-excludes-apex-blocked"
      allowed := []
      blocked := [.wildcard "blocked.test"]
      rawHost := "blocked.test" }
  , { name := "wildcard-excludes-apex-allowlist"
      allowed := [.wildcard "allowed.test"]
      blocked := []
      rawHost := "allowed.test" }
  , { name := "wildcard-no-suffix-spoof"
      allowed := [.wildcard "example.test"]
      blocked := []
      rawHost := "evil-example.test" }
  , { name := "allowlist-default-deny"
      allowed := [.exact "allowed.test"]
      blocked := []
      rawHost := "other.test" }
  , { name := "empty-canonical-dot-host-blocked-under-allowlist"
      allowed := [.exact "allowed.test"]
      blocked := []
      rawHost := "." }
  , { name := "empty-canonical-multidot-host-blocked-under-allowlist"
      allowed := [.wildcard "allowed.test"]
      blocked := []
      rawHost := "..." }
  , { name := "empty-policy-allows"
      allowed := []
      blocked := []
      rawHost := "anything.test" }
  ]

private def emitVectorsJson : String :=
  let entries := domainPolicyVectors.map fun v =>
    let policy : DomainPolicy := { allowed := v.allowed, blocked := v.blocked }
    let canonical := canonicalizeHost v.rawHost
    let dec := decide policy canonical
    let dnr := decideDnr policy canonical
    "  {" ++
      "\"name\":" ++ jsonStr v.name ++ "," ++
      "\"allowedDomains\":" ++ jsonStrArray (v.allowed.map ruleToPattern) ++ "," ++
      "\"blockedDomains\":" ++ jsonStrArray (v.blocked.map ruleToPattern) ++ "," ++
      "\"rawHost\":" ++ jsonStr v.rawHost ++ "," ++
      "\"canonicalHost\":" ++ jsonStr canonical ++ "," ++
      "\"expected\":" ++ decisionToJson dec ++ "," ++
      "\"dnrExpected\":" ++ decisionToJson dnr ++
    "}"
  "[\n" ++ String.intercalate ",\n" entries ++ "\n]"

private def check (label : String) (cond : Bool) : IO Bool := do
  if !cond then
    IO.eprintln s!"FAIL: {label}"
  return cond

private def runOracleChecks : IO UInt32 := do
  let mut ok := true

  -- 1. DomainPolicy checks
  let p1 : DomainPolicy := {
    allowed := [.wildcard "example.test"]
    blocked := [.exact "private.example.test"]
  }
  ok := ok && (← check "domain: block beats allow"
    (decideHttpHost p1 "PRIVATE.EXAMPLE.TEST." == .block .blockedDomains))
  ok := ok && (← check "domain: subdomain allowed"
    (decideHttpHost p1 "app.example.test" == .continue))
  ok := ok && (← check "domain: suffix spoof rejected"
    (decideHttpHost p1 "evil-example.test" == .block .allowedDomains))
  ok := ok && (← check "domain: apex excluded by wildcard"
    (decideHttpHost p1 "example.test" == .block .allowedDomains))
  ok := ok && (← check "domain: dot host blocked under allowlist"
    (decideHttpHost p1 "." == .block .allowedDomains))
  ok := ok && (← check "domain: DNR equivalence on all vectors"
    (domainPolicyVectors.all fun v =>
      let pol : DomainPolicy := { allowed := v.allowed, blocked := v.blocked }
      let h := canonicalizeHost v.rawHost
      decide pol h == decideDnr pol h))

  -- 2. FrameTree checks
  let ft := runEvents (FrameTree.init 1)
    [ .attachChild 2 1 10
    , .attachChild 3 2 20
    , .reparentNonDescendant 2 3   -- illegal cycle attempt: must be ignored
    , .attachChild 4 1 10
    , .reparentNonDescendant 3 4   -- legal reparent: 3 moves from 2 to 4
    , .adoptSession 3 30
    , .renameNodeId 1 100          -- root swap to fresh id 100
    , .detachSubtree 4             -- removes 4 and its child 3
    ]
  ok := ok && (← check "frametree: root renamed to 100" (ft.rootId == 100))
  ok := ok && (← check "frametree: child 2 parent updated to 100" (ft.parentOf 2 == some 100))
  ok := ok && (← check "frametree: detached subtree 4 & 3 removed"
    (!ft.present 4 && !ft.present 3 && !ft.sessionFrames 30 3))
  ok := ok && (← check "frametree: child 2 remains owned by session 10"
    (ft.ownerOf 2 == some 10 && ft.sessionFrames 10 2))

  -- 3. LocatorChain checks
  let env : ChainEnv := {
    frameSession := fun fid => if fid == 1 then some 10 else if fid == 2 then some 20 else none
    frameLoader := fun fid => if fid == 1 || fid == 2 then some 1 else none
    queryWorld := fun w sel _ =>
      if w.frameId == 1 && sel == "iframe" then [(11, true)]
      else if w.frameId == 2 && sel == "button" then [(21, false), (22, false)]
      else []
    contentFrame := fun w nid => if w.frameId == 1 && nid == 11 then some 2 else none
    describeNode := fun _ nid => some (nid * 10)
    abortedAt := fun _ => false
  }
  let g0 : GroupState := { activeGroups := [(10, 999)] }
  let (outcome, gFinal) := resolveChainWithGroup env 1
    [.query "iframe", .frameHop "button", .slice .last] g0 42 [10, 20]
  ok := ok && (← check "locator: cross-frame resolution isolates session"
    (outcome == .ok [{ sessionId := 20, frameId := 2, backendNodeId := 220 }]))
  ok := ok && (← check "locator: zero objectGroup leak" (gFinal == g0))
  ok := ok && (← check "locator: slice out-of-bounds returns empty"
    (sliceMatches (.nth 5) [1, 2, 3] == []))

  -- 4. CacheSafety checks
  let cs1 := runTrace (ActState.init true)
    [ .planSteps 2
    , .dispatchSideEffect .domAct
    , .completeInFlight true
    , .dispatchSideEffect .webMCP  -- competing route: must be rejected
    , .dispatchSideEffect .domAct
    , .completeInFlight true
    , .dispatchSideEffect .domAct  -- exceeds plan: must be rejected
    , .finishSuccess
    , .writeCache
    ]
  ok := ok && (← check "cache: single committed route & within plan"
    (cs1.committedRoute == some .domAct && cs1.domDispatched == 2 && cs1.cacheWritten))

  let cs2 := runTrace (ActState.init true)
    [ .planSteps 2
    , .dispatchSideEffect .domAct
    , .enterRecovery
    , .completeInFlight true
    , .finishSuccess
    , .writeCache
    ]
  ok := ok && (← check "cache: recovery prevents cache write" (!cs2.cacheWritten))

  let cs3 := runTrace (ActState.init true)
    [ .planSteps 2
    , .triggerStop
    , .dispatchSideEffect .domAct
    , .writeCache
    ]
  ok := ok && (← check "cache: abort prevents dispatch & cache write"
    (cs3.domDispatched == 0 && !cs3.cacheWritten && cs3.committedRoute == none))

  if ok then
    IO.println "stagehand-oracle: all reference model checks passed."
    return 0
  else
    return 1

def main (args : List String) : IO UInt32 := do
  match args with
  | ["--vectors"] =>
    IO.println emitVectorsJson
    return 0
  | [] =>
    runOracleChecks
  | _ =>
    IO.eprintln "Usage: stagehand-oracle [--vectors]"
    return 2
