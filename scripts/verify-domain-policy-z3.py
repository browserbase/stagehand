#!/usr/bin/env python3
"""Formal SMT verification (Z3) for `packages/extension/understudy/domainPolicy.ts`.

Encodes:
  1. Syntactic normalized pattern fixed-point invariants for `normalizeDomainPattern`
     over the ASCII hostname grammar (without RFC 63-char label / 253-char hostname
     length limits, which form a subset of the modeled syntactic grammar).
  2. `getDomainPolicyDecision(url, policy)` over WHATWG-serialized HTTP(S) URLs
     (`new URL(url).href` / Chrome `GURL`), including credentials, ports, trailing
     dots, empty labels, IPv6 literals, and dot-only hostnames (whose canonical
     hostname is `""` and which block when `allowedDomains` is non-empty).
  3. `toDomainPolicyDnrRules(policy)` and `domainRuleDnrRegex(rule)` using Z3's
     native SMT-LIB regular expression theory (`z3.InRe`), matching Chrome DNR's
     case-insensitive RE2 regexes (`isUrlFilterCaseSensitive: false`) and priority
     resolution (3: block > 2: allow > 1: allowlist default block).

Run with:
  uv run --no-project --with z3-solver python scripts/verify-domain-policy-z3.py
"""

from __future__ import annotations

import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

import z3

RuleKind = Literal["exact", "wildcard"]
ExpectedResult = Literal["UNSAT", "SAT"]
ActualResult = Literal["UNSAT", "SAT", "UNKNOWN"]
ObligationFn = Callable[[], tuple[ActualResult, str]]
Obligation = tuple[str, ExpectedResult, ObligationFn]

RE_SORT = z3.ReSort(z3.StringSort())
ALL_CHAR = z3.AllChar(RE_SORT)
ANY_STR = z3.Star(ALL_CHAR)
DIGIT = z3.Range("0", "9")
LOWER_ALPHA = z3.Range("a", "z")
UPPER_ALPHA = z3.Range("A", "Z")
ALPHA_NUM_LOWER = z3.Union(LOWER_ALPHA, DIGIT)
LABEL_MID = z3.Union(ALPHA_NUM_LOWER, z3.Re("-"))
WS_CHAR = z3.Union(z3.Re(" "), z3.Re("\t"), z3.Re("\r"), z3.Re("\n"))

DNR_USERINFO_EXCLUDED = "/?#@"
DNR_SUBDOMAIN_EXCLUDED = "/?#@:"
DNR_DEFAULT_ALLOWLIST_BLOCK_PATTERN = r"^https?://"
DNR_EXACT_TEMPLATE = r"^https?://([^/?#@]*@)?{hostname}\.*(:[0-9]+)?(/|$)"
DNR_WILDCARD_TEMPLATE = r"^https?://([^/?#@]*@)?[^/?#@:]*\.{hostname}\.*(:[0-9]+)?(/|$)"


def char_not_in(chars: str) -> z3.ReRef:
    excluded = z3.Union(*[z3.Re(c) for c in chars])
    return z3.Diff(ALL_CHAR, excluded)


def ci_literal(text: str) -> z3.ReRef:
    """Case-insensitive ASCII literal regex (matches isUrlFilterCaseSensitive: false)."""
    parts: list[z3.ReRef] = []
    for ch in text:
        if ch.isalpha():
            parts.append(z3.Union(z3.Re(ch.lower()), z3.Re(ch.upper())))
        else:
            parts.append(z3.Re(ch))
    if not parts:
        return z3.Re("")
    return parts[0] if len(parts) == 1 else z3.Concat(*parts)


def opt(re_expr: z3.ReRef) -> z3.ReRef:
    return z3.Option(re_expr)


DNR_NOT_USERINFO_DELIM = char_not_in(DNR_USERINFO_EXCLUDED)
DNR_NOT_SUBDOMAIN_DELIM = char_not_in(DNR_SUBDOMAIN_EXCLUDED)

assert f"[^{DNR_USERINFO_EXCLUDED}]" in DNR_EXACT_TEMPLATE
assert f"[^{DNR_USERINFO_EXCLUDED}]" in DNR_WILDCARD_TEMPLATE
assert f"[^{DNR_SUBDOMAIN_EXCLUDED}]" in DNR_WILDCARD_TEMPLATE

# WHATWG serialized URL character classes:
# - Serialized userinfo percent-encodes /, ?, #, @ (while allowing : in password,
#   %XX escapes, and printable ASCII). Empty userinfo ("http://@host/") is stripped
#   by WHATWG URL serialization, so serialized userinfo has >= 1 char before '@'.
URL_USERINFO_CHAR = z3.Diff(z3.Range("!", "~"), z3.Union(*[z3.Re(c) for c in "/?#@"]))
URL_USERINFO_OPT = opt(z3.Concat(z3.Plus(URL_USERINFO_CHAR), z3.Re("@")))

# - WHATWG forbidden host code points for non-IPv6 HTTP(S) hosts:
#   \0, \t, \n, \r, ' ', '#', '/', ':', '<', '>', '?', '@', '[', '\', ']', '^', '|'
#   In serialized URLs, ASCII letters in hostnames are lowercased (IDNA / UTS #46).
#   Note: '.' IS permitted — including dot-only hostnames (".", "..") and empty labels!
URL_HOST_CHAR_LOWER = z3.Diff(
    z3.Range("!", "~"),
    z3.Union(UPPER_ALPHA, *[z3.Re(c) for c in "#/:<>?@[\\]^|"]),
)
URL_HOST_CHAR_MIXED = z3.Diff(
    z3.Range("!", "~"),
    z3.Union(*[z3.Re(c) for c in "#/:<>?@[\\]^|"]),
)
IPV6_CHAR = z3.Union(z3.Range("0", "9"), z3.Range("a", "f"), z3.Re(":"), z3.Re("."))
URL_IPV6_HOST = z3.Concat(z3.Re("["), z3.Plus(IPV6_CHAR), z3.Re("]"))
URL_ANY_HOST = z3.Union(z3.Plus(URL_HOST_CHAR_LOWER), URL_IPV6_HOST)

URL_SCHEME_HTTP = z3.Union(z3.Re("http://"), z3.Re("https://"))
URL_PORT_OPT = opt(z3.Concat(z3.Re(":"), z3.Plus(DIGIT)))
URL_PATH_SERIALIZED = z3.Concat(z3.Re("/"), z3.Star(z3.Range("!", "~")))

SERIALIZED_HTTP_URL_RE = z3.Concat(
    URL_SCHEME_HTTP,
    URL_USERINFO_OPT,
    URL_ANY_HOST,
    URL_PORT_OPT,
    URL_PATH_SERIALIZED,
)

SERIALIZED_DOT_ONLY_HOST_URL_RE = z3.Concat(
    URL_SCHEME_HTTP,
    URL_USERINFO_OPT,
    z3.Plus(z3.Re(".")),
    URL_PORT_OPT,
    URL_PATH_SERIALIZED,
)

VALID_LABEL_RE = z3.Union(
    ALPHA_NUM_LOWER,
    z3.Concat(ALPHA_NUM_LOWER, z3.Star(LABEL_MID), ALPHA_NUM_LOWER),
)
DOT_LABEL_RE = z3.Concat(z3.Re("."), VALID_LABEL_RE)
VALID_HOSTNAME_RE = z3.Concat(VALID_LABEL_RE, z3.Plus(DOT_LABEL_RE))


@dataclass(frozen=True)
class Rule:
    kind: RuleKind
    hostname: str


@dataclass(frozen=True)
class Policy:
    name: str
    allowed: tuple[Rule, ...] = ()
    blocked: tuple[Rule, ...] = ()


DNR_HTTP_SCHEME_RE = z3.Concat(ci_literal("http"), opt(ci_literal("s")), z3.Re("://"))
DNR_DEFAULT_ALLOWLIST_BLOCK_RE = z3.Concat(DNR_HTTP_SCHEME_RE, ANY_STR)


def dnr_rule_regex(rule: Rule) -> z3.ReRef:
    """Z3 regex for `domainRuleDnrRegex(rule)` with `isUrlFilterCaseSensitive: false`."""
    userinfo = opt(z3.Concat(z3.Star(DNR_NOT_USERINFO_DELIM), z3.Re("@")))
    host = ci_literal(rule.hostname)
    trailing_dots = z3.Star(z3.Re("."))
    port = opt(z3.Concat(z3.Re(":"), z3.Plus(DIGIT)))
    tail = z3.Union(z3.Re(""), z3.Concat(z3.Re("/"), ANY_STR))
    parts: list[z3.ReRef] = [DNR_HTTP_SCHEME_RE, userinfo]
    if rule.kind == "wildcard":
        parts.append(z3.Concat(z3.Star(DNR_NOT_SUBDOMAIN_DELIM), z3.Re(".")))
    parts.extend([host, trailing_dots, port, tail])
    return z3.Concat(*parts)


def dnr_blocks(url: z3.SeqRef, policy: Policy) -> z3.BoolRef:
    """Chrome DNR priority resolution for `toDomainPolicyDnrRules(policy)`.

    Priority 3 (block) > priority 2 (allow) > priority 1 (allowlist default block) > continue.
    """
    p3_block = (
        z3.Or(*[z3.InRe(url, dnr_rule_regex(r)) for r in policy.blocked])
        if policy.blocked
        else z3.BoolVal(False)
    )
    if policy.allowed:
        p2_allow = z3.Or(*[z3.InRe(url, dnr_rule_regex(r)) for r in policy.allowed])
        p1_block = z3.InRe(url, DNR_DEFAULT_ALLOWLIST_BLOCK_RE)
        return z3.Or(p3_block, z3.And(z3.Not(p2_allow), p1_block))
    return p3_block


def url_host_matches_rule_re(rule: Rule) -> z3.ReRef:
    """Serialized HTTP(S) URLs whose canonicalized hostname matches `rule`."""
    if rule.kind == "exact":
        host_re = z3.Concat(z3.Re(rule.hostname), z3.Star(z3.Re(".")))
    else:
        host_re = z3.Concat(
            z3.Star(URL_HOST_CHAR_LOWER),
            z3.Re("."),
            z3.Re(rule.hostname),
            z3.Star(z3.Re(".")),
        )
    return z3.Concat(
        URL_SCHEME_HTTP,
        URL_USERINFO_OPT,
        host_re,
        URL_PORT_OPT,
        URL_PATH_SERIALIZED,
    )


def decision_blocks(url: z3.SeqRef, policy: Policy) -> z3.BoolRef:
    """Specification of `getDomainPolicyDecision(url, policy).action === "block"`.

    Returns False for non-HTTP(S) URLs (`hostnameFromHttpUrl` returns `null`).
    For HTTP(S) URLs with dot-only hostnames (`canonicalizeHostname` returns `""`),
    returns True when `allowedDomains` is non-empty and False otherwise.
    """
    if not policy.allowed and not policy.blocked:
        return z3.BoolVal(False)

    blocked_match = (
        z3.Or(*[z3.InRe(url, url_host_matches_rule_re(r)) for r in policy.blocked])
        if policy.blocked
        else z3.BoolVal(False)
    )
    if policy.allowed:
        allowed_re = [z3.InRe(url, url_host_matches_rule_re(r)) for r in policy.allowed]
        allowed_match = z3.Or(*allowed_re)
        policy_blocks = z3.Or(blocked_match, z3.Not(allowed_match))
    else:
        policy_blocks = blocked_match

    return z3.And(z3.InRe(url, SERIALIZED_HTTP_URL_RE), policy_blocks)


REPRESENTATIVE_POLICIES: tuple[Policy, ...] = (
    Policy("block-exact", blocked=(Rule("exact", "example.com"),)),
    Policy("block-wildcard", blocked=(Rule("wildcard", "example.com"),)),
    Policy("allow-exact", allowed=(Rule("exact", "example.com"),)),
    Policy("allow-wildcard", allowed=(Rule("wildcard", "example.com"),)),
    Policy(
        "overlap-exact-and-wildcard",
        allowed=(Rule("exact", "example.com"), Rule("wildcard", "example.com")),
        blocked=(
            Rule("exact", "private.example.com"),
            Rule("wildcard", "private.example.com"),
        ),
    ),
    Policy(
        "overlap-allow-sub-block-wildcard",
        allowed=(Rule("exact", "public.example.com"),),
        blocked=(Rule("wildcard", "example.com"),),
    ),
    Policy(
        "overlap-same-host",
        allowed=(Rule("exact", "example.com"),),
        blocked=(Rule("exact", "example.com"),),
    ),
    Policy(
        "ipv4-and-punycode",
        allowed=(Rule("exact", "xn--bcher-kva.test"),),
        blocked=(Rule("exact", "127.0.0.2"),),
    ),
)


@dataclass
class CheckResult:
    name: str
    expected: ExpectedResult
    actual: ActualResult
    elapsed_ms: float
    detail: str


def run_obligation(
    name: str,
    expected: ExpectedResult,
    fn: Callable[[], tuple[ActualResult, str]],
) -> CheckResult:
    t0 = time.perf_counter()
    actual, detail = fn()
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return CheckResult(
        name=name,
        expected=expected,
        actual=actual,
        elapsed_ms=elapsed_ms,
        detail=detail,
    )


def solver_result_to_actual(res: z3.CheckSatResult) -> ActualResult:
    if res == z3.sat:
        return "SAT"
    if res == z3.unsat:
        return "UNSAT"
    return "UNKNOWN"


def check_dnr_soundness_serialized() -> tuple[ActualResult, str]:
    """OBLIGATION 1: DNR soundness (`dec=block => dnr=block`) on all serialized HTTP(S) URLs."""
    for pol in REPRESENTATIVE_POLICIES:
        s = z3.Solver()
        s.set("timeout", 10000)
        url = z3.String("url")
        s.add(z3.InRe(url, SERIALIZED_HTTP_URL_RE))
        s.add(decision_blocks(url, pol))
        s.add(z3.Not(dnr_blocks(url, pol)))
        res = s.check()
        if res == z3.sat:
            return "SAT", f"policy={pol.name} url={s.model().eval(url)}"
        if res != z3.unsat:
            return "UNKNOWN", f"policy={pol.name} solver returned {res}"
    return (
        "UNSAT",
        f"All {len(REPRESENTATIVE_POLICIES)} policy shapes proved sound (dec=block => dnr=block).",
    )


def check_dnr_equivalence_serialized() -> tuple[ActualResult, str]:
    """OBLIGATION 2: Exact bidirectional DNR <-> decision equivalence on all serialized HTTP(S)
    URLs, including dot-only hostnames."""
    for pol in REPRESENTATIVE_POLICIES:
        s = z3.Solver()
        s.set("timeout", 10000)
        url = z3.String("url")
        s.add(z3.InRe(url, SERIALIZED_HTTP_URL_RE))
        s.add(decision_blocks(url, pol) != dnr_blocks(url, pol))
        res = s.check()
        if res == z3.sat:
            return "SAT", f"policy={pol.name} url={s.model().eval(url)}"
        if res != z3.unsat:
            return "UNKNOWN", f"policy={pol.name} solver returned {res}"
    return (
        "UNSAT",
        f"Exact bidirectional equivalence proved across all {len(REPRESENTATIVE_POLICIES)} "
        "policy shapes (including dot-only hostnames).",
    )


def check_dot_only_hostname_policy() -> tuple[ActualResult, str]:
    """OBLIGATION 3: Dot-only hostnames block in both decision and DNR when `allowedDomains` is set,
    and continue in both when only `blockedDomains` is set."""
    for pol in REPRESENTATIVE_POLICIES:
        s = z3.Solver()
        s.set("timeout", 10000)
        url = z3.String("url")
        s.add(z3.InRe(url, SERIALIZED_DOT_ONLY_HOST_URL_RE))
        dec = decision_blocks(url, pol)
        dnr = dnr_blocks(url, pol)
        if pol.allowed:
            s.add(z3.Or(z3.Not(dec), z3.Not(dnr)))
        else:
            s.add(z3.Or(dec, dnr))
        res = s.check()
        if res == z3.sat:
            return "SAT", f"policy={pol.name} url={s.model().eval(url)}"
        if res != z3.unsat:
            return "UNKNOWN", f"policy={pol.name} solver returned {res}"
    return (
        "UNSAT",
        "Dot-only hostnames block under allowlists and continue under blocklist-only policies "
        "in both decision and DNR.",
    )


def check_raw_unserialized_url_gap() -> tuple[ActualResult, str]:
    """OBLIGATION 4: Raw unserialized HTTP(S) URLs (e.g. `?q=1`, `#frag`, `:/`) evade DNR regex,
    demonstrating why Chrome GURL / WHATWG serialization is a required precondition."""
    pol = Policy("block-exact", blocked=(Rule("exact", "example.com"),))
    s = z3.Solver()
    s.set("timeout", 10000)
    url = z3.String("raw_url")
    raw_port = opt(z3.Concat(z3.Re(":"), z3.Star(DIGIT)))
    raw_delim = z3.Union(z3.Re("/"), z3.Re("?"), z3.Re("#"))
    raw_tail = z3.Union(
        z3.Re(""),
        z3.Concat(raw_delim, z3.Star(z3.Range("!", "~"))),
    )
    raw_exact_example = z3.Concat(
        URL_SCHEME_HTTP,
        URL_USERINFO_OPT,
        z3.Re("example.com"),
        z3.Star(z3.Re(".")),
        raw_port,
        raw_tail,
    )
    s.add(z3.InRe(url, raw_exact_example))
    s.add(z3.Not(dnr_blocks(url, pol)))
    res = s.check()
    if res == z3.sat:
        model_url = s.model().eval(url)
        return "SAT", f"COUNTEREXAMPLE (raw unserialized URL): url={model_url}"
    return solver_result_to_actual(res), "Unexpectedly no raw-URL gap found."


def check_blocked_always_wins() -> tuple[ActualResult, str]:
    """OBLIGATION 5: Blocked-always-wins precedence in both decision and DNR."""
    policies_with_blocks = [p for p in REPRESENTATIVE_POLICIES if p.blocked]
    for pol in policies_with_blocks:
        s = z3.Solver()
        s.set("timeout", 10000)
        url = z3.String("url")
        s.add(z3.InRe(url, SERIALIZED_HTTP_URL_RE))
        blocked_res = [z3.InRe(url, url_host_matches_rule_re(r)) for r in pol.blocked]
        matches_blocked = z3.Or(*blocked_res)
        s.add(matches_blocked)
        s.add(z3.Or(z3.Not(decision_blocks(url, pol)), z3.Not(dnr_blocks(url, pol))))
        res = s.check()
        if res == z3.sat:
            return "SAT", f"policy={pol.name} url={s.model().eval(url)}"
        if res != z3.unsat:
            return "UNKNOWN", f"policy={pol.name} solver returned {res}"
    return (
        "UNSAT",
        "Blocked-always-wins proved for both decision and DNR across "
        f"{len(policies_with_blocks)} policies.",
    )


def check_wildcard_boundary_safety() -> tuple[ActualResult, str]:
    """OBLIGATION 6: Wildcard boundary safety.

    Part A: `*.example.com` never matches non-subdomain hosts, apex, userinfo, or path in
      either decision or DNR.
    Part B: For any symbolic hostname `H` in syntactic `VALID_HOSTNAME_RE` (without RFC
      63/253 length limits), `*.H` never matches apex `H` or `<prefix>-<H>`.
    """
    rule = Rule("wildcard", "example.com")
    pol = Policy("block-wildcard", blocked=(rule,))

    s = z3.Solver()
    s.set("timeout", 10000)
    url = z3.String("url")
    s.add(z3.InRe(url, SERIALIZED_HTTP_URL_RE))
    s.add(z3.Not(z3.InRe(url, url_host_matches_rule_re(rule))))
    s.add(z3.Or(decision_blocks(url, pol), dnr_blocks(url, pol)))
    res = s.check()
    if res != z3.unsat:
        detail = f"url={s.model().eval(url)}" if res == z3.sat else str(res)
        return solver_result_to_actual(res), f"Part A failed: {detail}"

    s2 = z3.Solver()
    s2.set("timeout", 10000)
    h = z3.String("sym_h")
    prefix = z3.String("sym_prefix")
    s2.add(z3.InRe(h, VALID_HOSTNAME_RE))
    s2.add(z3.InRe(prefix, z3.Plus(LABEL_MID)))
    dot_h = z3.Concat(z3.StringVal("."), h)
    apex_matches = z3.SuffixOf(dot_h, h)
    lookalike_matches = z3.SuffixOf(dot_h, z3.Concat(prefix, z3.StringVal("-"), h))
    s2.add(z3.Or(apex_matches, lookalike_matches))
    res2 = s2.check()
    if res2 != z3.unsat:
        detail = f"h={s2.model().eval(h)}" if res2 == z3.sat else str(res2)
        return solver_result_to_actual(res2), f"Part B failed: {detail}"

    return (
        "UNSAT",
        "Wildcard *.example.com (and symbolic *.H) never matches apex, lookalikes, "
        "userinfo, or path.",
    )


def check_exact_boundary_safety() -> tuple[ActualResult, str]:
    """OBLIGATION 7: Exact rule `example.com` never matches subdomains, unescaped-dot lookalikes,
    userinfo, or path in either decision or DNR."""
    rule = Rule("exact", "example.com")
    pol = Policy("block-exact", blocked=(rule,))
    s = z3.Solver()
    s.set("timeout", 10000)
    url = z3.String("url")
    s.add(z3.InRe(url, SERIALIZED_HTTP_URL_RE))
    s.add(z3.Not(z3.InRe(url, url_host_matches_rule_re(rule))))
    s.add(z3.Or(decision_blocks(url, pol), dnr_blocks(url, pol)))
    res = s.check()
    if res == z3.sat:
        return "SAT", f"url={s.model().eval(url)}"
    if res != z3.unsat:
        return "UNKNOWN", str(res)
    return (
        "UNSAT",
        "Exact rule never matches subdomains, unescaped-dot lookalikes, userinfo, or path.",
    )


def check_non_http_scheme_isolation() -> tuple[ActualResult, str]:
    """OBLIGATION 8: Any string not starting with `(?i)https?://` continues in BOTH decision
    and DNR."""
    for pol in REPRESENTATIVE_POLICIES:
        s = z3.Solver()
        s.set("timeout", 10000)
        url = z3.String("non_http_url")
        s.add(z3.Not(z3.InRe(url, DNR_DEFAULT_ALLOWLIST_BLOCK_RE)))
        s.add(z3.Or(decision_blocks(url, pol), dnr_blocks(url, pol)))
        res = s.check()
        if res == z3.sat:
            return "SAT", f"policy={pol.name} url={s.model().eval(url)}"
        if res != z3.unsat:
            return "UNKNOWN", f"policy={pol.name} solver returned {res}"
    return (
        "UNSAT",
        "Non-HTTP(S) URLs always continue in both decision and DNR across all "
        f"{len(REPRESENTATIVE_POLICIES)} policies.",
    )


def check_case_folding_invariance_dnr() -> tuple[ActualResult, str]:
    """OBLIGATION 9: DNR regex matches all mixed-case ASCII HTTP(S) URLs for exact and wildcard."""
    for rule in (Rule("exact", "example.com"), Rule("wildcard", "example.com")):
        s = z3.Solver()
        s.set("timeout", 10000)
        url = z3.String("url")
        host_re = (
            z3.Concat(ci_literal(rule.hostname), z3.Star(z3.Re(".")))
            if rule.kind == "exact"
            else z3.Concat(
                z3.Star(URL_HOST_CHAR_MIXED),
                z3.Re("."),
                ci_literal(rule.hostname),
                z3.Star(z3.Re(".")),
            )
        )
        mixed_url_re = z3.Concat(
            DNR_HTTP_SCHEME_RE,
            URL_USERINFO_OPT,
            host_re,
            URL_PORT_OPT,
            URL_PATH_SERIALIZED,
        )
        s.add(z3.InRe(url, mixed_url_re))
        s.add(z3.Not(z3.InRe(url, dnr_rule_regex(rule))))
        res = s.check()
        if res == z3.sat:
            return "SAT", f"rule={rule} url={s.model().eval(url)}"
        if res != z3.unsat:
            return "UNKNOWN", f"rule={rule} solver returned {res}"
    return (
        "UNSAT",
        "DNR regex matches all mixed-case ASCII spellings for both exact and wildcard rules.",
    )


def check_normalization_pattern_invariants() -> tuple[ActualResult, str]:
    """OBLIGATION 10: Syntactic fixed-point invariants of `normalizeDomainPattern` output.

    Over the syntactic output grammar `L_OUT = ("*."?) + VALID_HOSTNAME_RE` (without RFC
    63-char label / 253-char hostname length bounds, and without modeling array deduplication
    in `normalizeDomainPolicy`), proves that every `n1` in `L_OUT` is non-empty, unchanged by
    trimming, ASCII lowercasing, and trailing-dot stripping, contains none of `/`, `:`, `?`, `#`,
    starts with `*.` iff wildcard with no other `*`, and yields a string in `VALID_HOSTNAME_RE`
    after stripping leading `*.`.
    """
    wild_re = z3.Concat(z3.Re("*."), VALID_HOSTNAME_RE)
    for is_wild in (False, True):
        out_re = wild_re if is_wild else VALID_HOSTNAME_RE
        n1 = z3.String("n1")
        starts_with_wild = z3.InRe(n1, z3.Concat(z3.Re("*."), ANY_STR))
        wild_mismatch = z3.Not(starts_with_wild) if is_wild else starts_with_wild
        stripped = z3.SubString(n1, 2, z3.Length(n1) - 2) if is_wild else n1
        checks: list[tuple[str, z3.BoolRef]] = [
            ("empty", n1 == z3.StringVal("")),
            ("leading-ws", z3.InRe(n1, z3.Concat(WS_CHAR, ANY_STR))),
            ("trailing-ws", z3.InRe(n1, z3.Concat(ANY_STR, WS_CHAR))),
            ("uppercase", z3.InRe(n1, z3.Concat(ANY_STR, UPPER_ALPHA, ANY_STR))),
            ("trailing-dot", z3.InRe(n1, z3.Concat(ANY_STR, z3.Re(".")))),
            (
                "forbidden-url-char",
                z3.InRe(
                    n1,
                    z3.Concat(
                        ANY_STR,
                        z3.Union(z3.Re("/"), z3.Re(":"), z3.Re("?"), z3.Re("#")),
                        ANY_STR,
                    ),
                ),
            ),
            ("wild-flag-mismatch", wild_mismatch),
            (
                "extra-star",
                z3.InRe(n1, z3.Concat(z3.Re("*."), ANY_STR, z3.Re("*"), ANY_STR))
                if is_wild
                else z3.InRe(n1, z3.Concat(ANY_STR, z3.Re("*"), ANY_STR)),
            ),
            ("stripped-hostname-invalid", z3.Not(z3.InRe(stripped, VALID_HOSTNAME_RE))),
        ]
        for label, bad_cond in checks:
            s = z3.Solver()
            s.set("timeout", 10000)
            s.add(z3.InRe(n1, out_re))
            s.add(bad_cond)
            res = s.check()
            if res == z3.sat:
                return "SAT", f"check={label} n1={s.model().eval(n1)} is_wild={is_wild}"
            if res != z3.unsat:
                return "UNKNOWN", f"check={label} is_wild={is_wild} res={res}"
    return (
        "UNSAT",
        "All normalizeDomainPattern syntactic fixed-point invariants proved "
        "(unbounded syntactic hostname grammar).",
    )


def check_mutation_sanity() -> tuple[ActualResult, str]:
    """OBLIGATION 11: Non-vacuity check seeding missing `/` in userinfo and unescaped `.` host."""
    buggy_userinfo_regex = z3.Concat(
        DNR_HTTP_SCHEME_RE,
        opt(z3.Concat(z3.Star(char_not_in("?#@")), z3.Re("@"))),
        ci_literal("example.com"),
        z3.Star(z3.Re(".")),
        opt(z3.Concat(z3.Re(":"), z3.Plus(DIGIT))),
        z3.Union(z3.Re(""), z3.Concat(z3.Re("/"), ANY_STR)),
    )
    sa = z3.Solver()
    sa.set("timeout", 10000)
    ua = z3.String("ua")
    sa.add(z3.InRe(ua, SERIALIZED_HTTP_URL_RE))
    sa.add(z3.Not(z3.InRe(ua, url_host_matches_rule_re(Rule("exact", "example.com")))))
    sa.add(z3.InRe(ua, buggy_userinfo_regex))
    ra = sa.check()

    buggy_dot_regex = z3.Concat(
        DNR_HTTP_SCHEME_RE,
        opt(z3.Concat(z3.Star(DNR_NOT_USERINFO_DELIM), z3.Re("@"))),
        ci_literal("example"),
        char_not_in("/"),
        ci_literal("com"),
        z3.Star(z3.Re(".")),
        opt(z3.Concat(z3.Re(":"), z3.Plus(DIGIT))),
        z3.Union(z3.Re(""), z3.Concat(z3.Re("/"), ANY_STR)),
    )
    sb = z3.Solver()
    sb.set("timeout", 10000)
    ub = z3.String("ub")
    sb.add(z3.InRe(ub, SERIALIZED_HTTP_URL_RE))
    sb.add(z3.Not(z3.InRe(ub, url_host_matches_rule_re(Rule("exact", "example.com")))))
    sb.add(z3.InRe(ub, buggy_dot_regex))
    rb = sb.check()

    if ra == z3.sat and rb == z3.sat:
        return (
            "SAT",
            f"Caught both seeded bugs: path-@ spoof={sa.model().eval(ua)}, "
            f"unescaped-dot={sb.model().eval(ub)}",
        )
    return "UNSAT", f"Mutation check failed: ra={ra}, rb={rb}"


def main() -> int:
    print(
        "Z3 Formal Verification for packages/extension/understudy/domainPolicy.ts "
        f"(Z3 {z3.get_version_string()})"
    )
    print("=" * 92)

    obligations: list[Obligation] = [
        (
            "1. DNR Soundness (all serialized HTTP(S): dec=block => dnr=block)",
            "UNSAT",
            check_dnr_soundness_serialized,
        ),
        (
            "2. DNR <-> Decision Exact Equivalence (ALL serialized HTTP(S), incl. dot-only host)",
            "UNSAT",
            check_dnr_equivalence_serialized,
        ),
        (
            "3. Dot-Only Hostname Policy (allowlist blocks, blocklist-only continues)",
            "UNSAT",
            check_dot_only_hostname_policy,
        ),
        (
            "4. Raw Unserialized URL Gap (demonstrates GURL canonicalization requirement)",
            "SAT",
            check_raw_unserialized_url_gap,
        ),
        (
            "5. Blocked-Always-Wins Precedence (decision & DNR)",
            "UNSAT",
            check_blocked_always_wins,
        ),
        (
            "6. Wildcard Boundary Safety (*.example.com & symbolic *.H)",
            "UNSAT",
            check_wildcard_boundary_safety,
        ),
        (
            "7. Exact Boundary Safety (example.com, escaped dots, no spoofing)",
            "UNSAT",
            check_exact_boundary_safety,
        ),
        (
            "8. Non-HTTP(S) Scheme Isolation (decision & DNR)",
            "UNSAT",
            check_non_http_scheme_isolation,
        ),
        (
            "9. Case-Folding Invariance (DNR regex on mixed-case ASCII URLs)",
            "UNSAT",
            check_case_folding_invariance_dnr,
        ),
        (
            "10. Normalization Pattern Fixed-Point Invariants (syntactic grammar)",
            "UNSAT",
            check_normalization_pattern_invariants,
        ),
        (
            "11. Model Tightness / Mutation Sanity (seeded path-@ & unescaped-dot bugs)",
            "SAT",
            check_mutation_sanity,
        ),
    ]

    results: list[CheckResult] = []
    all_matched_expected = True

    for name, expected, fn in obligations:
        r = run_obligation(name, expected, fn)
        results.append(r)
        ok = r.actual == r.expected
        if not ok:
            all_matched_expected = False
        badge = "PASS" if ok else "FAIL"
        print(f"[{badge}] {r.name}")
        summary = f"{r.actual} (expected {r.expected}, {r.elapsed_ms:.1f} ms)"
        print(f"       Result: {summary}")
        print(f"       Detail: {r.detail}")

    print("=" * 92)
    proved_unsat = sum(1 for r in results if r.actual == "UNSAT")
    found_sat = sum(1 for r in results if r.actual == "SAT")
    unknown = sum(1 for r in results if r.actual == "UNKNOWN")
    total_ms = sum(r.elapsed_ms for r in results)
    print(
        f"Summary: {proved_unsat} UNSAT (proved), {found_sat} SAT (counterexample synthesized), "
        f"{unknown} UNKNOWN — total {total_ms:.1f} ms"
    )

    return 0 if all_matched_expected else 1


if __name__ == "__main__":
    sys.exit(main())
