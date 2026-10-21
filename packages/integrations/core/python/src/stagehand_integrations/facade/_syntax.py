"""Checks run code the way `AsyncFunction(params, code)` does in the TypeScript facade.

The bundle's run callback is `runPrelude + code + runEpilogue`, so code that is not
an async function body on its own could close the callback early and run outside
it. Python has no JavaScript engine to ask, so this parses with tree-sitter and
rejects the few constructs V8 reads differently. It does not report V8's early
errors (such as a redeclared `let`); the executor rejects those.
"""

from __future__ import annotations

import tree_sitter_javascript
from tree_sitter import Language, Node, Parser, Query, QueryCursor

_JAVASCRIPT = Language(tree_sitter_javascript.language())
_PARSER = Parser(_JAVASCRIPT)
# Syntax the parser reads differently from V8, which could hide where run code ends:
# JSX, and `<!--` / a mid-line `-->`, which V8 reads as comments.
_UNCHECKABLE = Query(
    _JAVASCRIPT,
    '[(jsx_element) (jsx_self_closing_element)] @jsx "<" @less "--" @decrement',
)

# Source text of `AsyncFunction("batchStagehand", "input", code)` (ECMA-262
# CreateDynamicFunction), parenthesized as the SDK sends a callback.
_DYNAMIC_FUNCTION_HEAD = "(async function anonymous(batchStagehand,input\n) {\n"
_DYNAMIC_FUNCTION_TAIL = "\n})"


def check_run_syntax(code: str) -> None:
    """Fail like `AsyncFunction(params, code)` would when ``code`` is not an async
    function body on its own, so it cannot close the run callback early."""
    encoded = (_DYNAMIC_FUNCTION_HEAD + code + _DYNAMIC_FUNCTION_TAIL).encode()
    start = len(_DYNAMIC_FUNCTION_HEAD.encode())
    end = len(encoded) - len(_DYNAMIC_FUNCTION_TAIL.encode())
    root = _PARSER.parse(encoded).root_node
    if root.has_error:
        node = _first_error(root)
        offset = min(max(node.start_byte if node else end, start), end)
        raise SyntaxError(f"Invalid JavaScript in run code at {_position(encoded, start, offset)}.")
    # Without errors the code can still have closed the function and opened another.
    node = root
    for expected in ("expression_statement", "parenthesized_expression", "function_expression"):
        children = [child for child in node.named_children if "comment" not in child.type]
        if len(children) != 1 or children[0].type != expected:
            raise SyntaxError("Run code must not close its enclosing function.")
        node = children[0]
    cursor = QueryCursor(_UNCHECKABLE)
    cursor.set_byte_range(start, end)
    for tag, nodes in cursor.captures(root).items():
        for node in nodes:
            following = encoded[node.end_byte : node.end_byte + 3]
            if (
                tag == "jsx"
                or (tag == "less" and following == b"!--")
                or (tag == "decrement" and following.startswith(b">"))
            ):
                position = _position(encoded, start, node.start_byte)
                raise SyntaxError(
                    f"Unsupported syntax in run code at {position}: "
                    "JSX, <!-- and --> are not allowed."
                )


def _first_error(node: Node) -> Node | None:
    if node.is_error or node.is_missing:
        return node
    for child in node.children:
        if child.has_error or child.is_missing:
            found = _first_error(child)
            if found is not None:
                return found
    return None


def _position(encoded: bytes, start: int, offset: int) -> str:
    before = encoded[start:offset].decode(errors="replace")
    line = before.count("\n") + 1
    return f"line {line}, column {len(before) - before.rfind(chr(10))}"
