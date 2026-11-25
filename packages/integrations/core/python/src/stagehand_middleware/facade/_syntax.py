from __future__ import annotations

import re

import tree_sitter_javascript
from tree_sitter import Language, Node, Parser, Query, QueryCursor

_JAVASCRIPT = Language(tree_sitter_javascript.language())
_PARSER = Parser(_JAVASCRIPT)
_UNCHECKABLE = Query(
    _JAVASCRIPT,
    (
        "[(jsx_element) (jsx_self_closing_element)] @jsx "
        '(html_comment) @html_comment "<" @less "--" @decrement'
    ),
)

_DYNAMIC_FUNCTION_HEAD = "(async function anonymous(batchStagehand,input\n) {"
_DYNAMIC_FUNCTION_TAIL = "\n})"
_LONE_SURROGATE = re.compile(r"[\ud800-\udfff]")


def check_run_syntax(code: str) -> None:
    normalized = code.replace("\r\n", "\n").replace("\r", "\n")
    safe_code = _LONE_SURROGATE.sub("\ufffd", normalized)
    encoded = (_DYNAMIC_FUNCTION_HEAD + safe_code + _DYNAMIC_FUNCTION_TAIL).encode("utf-8")
    start = len(_DYNAMIC_FUNCTION_HEAD.encode("utf-8"))
    end = len(encoded) - len(_DYNAMIC_FUNCTION_TAIL.encode("utf-8"))
    root = _PARSER.parse(encoded).root_node
    if root.has_error:
        node = _first_error(root)
        offset = min(max(node.start_byte if node else end, start), end)
        raise SyntaxError(f"Invalid JavaScript in run code at {_position(encoded, start, offset)}.")
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
            if tag == "html_comment":
                if encoded[node.start_byte : node.start_byte + 3] == b"-->" and (
                    not _preceded_by_line_break_only(encoded, start, node.start_byte)
                ):
                    position = _position(encoded, start, node.start_byte)
                    raise SyntaxError(
                        f"Unsupported syntax in run code at {position}: "
                        "JSX, <!-- and --> are not allowed."
                    )
                continue
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


_ECMA_HORIZONTAL_SPACE = frozenset(
    "\t\v\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009"
    "\u200a\u202f\u205f\u3000\ufeff"
)


def _preceded_by_line_break_only(encoded: bytes, start: int, offset: int) -> bool:
    before = encoded[start:offset].decode("utf-8", errors="replace")
    last_break = max(before.rfind("\n"), before.rfind("\u2028"), before.rfind("\u2029"))
    if last_break == -1:
        return False
    return all(char in _ECMA_HORIZONTAL_SPACE for char in before[last_break + 1 :])


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
