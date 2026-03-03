#!/usr/bin/env python3
"""
Transform Playwright .click(...) → .evaluate("el => el.click()")
across all .py and .js genPython templates under auto_verbs/verbs/.

Playwright locator.click() simulates a mouse at the element's center coordinates,
which can fail if the element is out of viewport or covered by an overlay.

locator.evaluate("el => el.click()") uses Playwright's auto-wait to find the element,
then fires a DOM click event directly — no viewport/overlay issues.

Usage:
    python convert_clicks.py --dry-run     # Preview changes
    python convert_clicks.py               # Apply changes
"""

import re
import os
import sys
import glob
from pathlib import Path

VERBS_DIR = Path(__file__).parent
DRY_RUN = "--dry-run" in sys.argv


def transform_clicks(content, base_line=0):
    """
    Replace Playwright .click(...) with .evaluate("el => el.click()")
    in Python code (either standalone .py or inside JS genPython templates).

    Skips:
    - page.mouse.click(x, y)  — coordinate-based clicks
    - .click() inside page.evaluate() strings — already DOM clicks
    - Comment-only lines

    base_line: offset for reporting line numbers (for JS template sections)
    """
    lines = content.split('\n')
    result = []
    changes = []
    in_triple_quote_eval = False

    for i, line in enumerate(lines):
        original = line

        # ── Track multi-line page.evaluate("""...""") blocks ──
        if not in_triple_quote_eval:
            # Opening: page.evaluate(""" or page.evaluate('''
            if (re.search(r'page\.evaluate\s*\(\s*[frb]*"""', line) or
                    re.search(r"page\.evaluate\s*\(\s*[frb]*'''", line)):
                # Check if it closes on the same line
                tq = '"""' if '"""' in line else "'''"
                count = line.count(tq)
                if count < 2:
                    # Opens but doesn't close — entering multi-line eval
                    in_triple_quote_eval = True
                    result.append(line)
                    continue
                # else: single-line eval — skip below via page.evaluate check
        else:
            # Inside multi-line evaluate — check for closing triple-quote
            if '"""' in line or "'''" in line:
                in_triple_quote_eval = False
            result.append(line)
            continue

        # ── Skip rules ──

        # Skip page.mouse.click(x, y) — coordinate-based
        if 'mouse.click' in line:
            result.append(line)
            continue

        # Skip single-line page.evaluate(...) — already DOM code inside
        if 'page.evaluate' in line:
            result.append(line)
            continue

        # Skip comment lines
        stripped = line.lstrip()
        if stripped.startswith('#') or stripped.startswith('//'):
            result.append(line)
            continue

        # ── Transform .click(...) → .evaluate("el => el.click()") ──
        new_line = re.sub(r'\.click\([^)]*\)', '.evaluate("el => el.click()")', line)

        if new_line != original:
            changes.append({
                'line': base_line + i + 1,
                'old': original.rstrip(),
                'new': new_line.rstrip()
            })

        result.append(new_line)

    return '\n'.join(result), changes


def process_py_file(filepath):
    """Transform a .py file."""
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()

    new_content, changes = transform_clicks(content)

    if changes and not DRY_RUN:
        with open(filepath, 'w', encoding='utf-8', newline='') as f:
            f.write(new_content)

    return changes


def find_template_literal_end(content, start_pos):
    """
    Find the end of a JS template literal starting from the backtick at start_pos.
    Handles ${...} expressions (with nested braces) and \\` escapes.
    Returns the position of the closing backtick, or -1 if not found.
    """
    pos = start_pos + 1
    brace_depth = 0

    while pos < len(content):
        ch = content[pos]

        # Handle escape sequences
        if ch == '\\':
            pos += 2
            continue

        # Inside ${...} expression
        if brace_depth > 0:
            if ch == '{':
                brace_depth += 1
            elif ch == '}':
                brace_depth -= 1
            pos += 1
            continue

        # Start of ${...} expression
        if ch == '$' and pos + 1 < len(content) and content[pos + 1] == '{':
            brace_depth = 1
            pos += 2
            continue

        # Found closing backtick
        if ch == '`':
            return pos

        pos += 1

    return -1


def extract_genPython_templates(content):
    """
    Find ALL genPython/genPythonInline template literals in a JS file.
    Returns list of (template_start, template_end, base_line) tuples,
    where template_start/end are positions of the backtick characters.
    """
    templates = []

    # Search for all genPython-like functions
    for match in re.finditer(r'function\s+genPython(?:Inline)?\s*\([^)]*\)\s*\{', content):
        func_body_start = match.end()

        # Bound search to this function only — stop at next `function` declaration
        next_func = re.search(r'\nfunction\s+', content[func_body_start:])
        search_end = func_body_start + next_func.start() if next_func else len(content)
        search_region = content[func_body_start:search_end]

        # Find the template literal: look for `return ` followed by a backtick
        return_match = re.search(r'return\s*`', search_region)
        if not return_match:
            continue

        backtick_pos = func_body_start + return_match.end() - 1  # position of opening `
        end_pos = find_template_literal_end(content, backtick_pos)
        if end_pos == -1:
            continue

        # Calculate base line number for the template content
        base_line = content[:backtick_pos + 1].count('\n')

        templates.append((backtick_pos + 1, end_pos, base_line))

    return templates


def process_js_file(filepath):
    """
    Transform a .js file — only inside genPython/genPythonInline template literals.
    """
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        content = f.read()

    templates = extract_genPython_templates(content)
    if not templates:
        return []

    all_changes = []

    # Process templates in reverse order (so positions stay valid after replacement)
    for tmpl_start, tmpl_end, base_line in reversed(templates):
        template_content = content[tmpl_start:tmpl_end]
        new_template, changes = transform_clicks(template_content, base_line=base_line)

        if changes:
            content = content[:tmpl_start] + new_template + content[tmpl_end:]
            all_changes.extend(changes)

    if all_changes and not DRY_RUN:
        with open(filepath, 'w', encoding='utf-8', newline='') as f:
            f.write(content)

    # Sort by line number for reporting
    all_changes.sort(key=lambda c: c['line'])
    return all_changes


def main():
    total_files = 0
    total_changes = 0
    all_results = []

    # Process .py files
    py_files = sorted(glob.glob(str(VERBS_DIR / "**" / "*.py"), recursive=True))
    # Exclude utility files and this script itself
    exclude = {'cdp_utils.py', 'convert_clicks.py', 'convert_to_cdp.py',
               'fix_js_genpython.py', 'open_browser.py'}
    py_files = [f for f in py_files if os.path.basename(f) not in exclude
                and '__pycache__' not in f]

    for filepath in py_files:
        changes = process_py_file(filepath)
        if changes:
            total_files += 1
            total_changes += len(changes)
            rel = os.path.relpath(filepath, VERBS_DIR)
            all_results.append((rel, changes))

    # Process .js files (genPython templates only)
    js_files = sorted(glob.glob(str(VERBS_DIR / "**" / "*.js"), recursive=True))
    js_files = [f for f in js_files if '__pycache__' not in f
                and os.path.basename(f) not in {'stagehand-utils.js'}]

    for filepath in js_files:
        changes = process_js_file(filepath)
        if changes:
            total_files += 1
            total_changes += len(changes)
            rel = os.path.relpath(filepath, VERBS_DIR)
            all_results.append((rel, changes))

    # Report
    mode = "DRY RUN" if DRY_RUN else "APPLIED"
    print(f"\n{'='*70}")
    print(f"  .click() -> .evaluate(\"el => el.click()\")  [{mode}]")
    print(f"{'='*70}")
    print(f"  Files modified: {total_files}")
    print(f"  Total changes:  {total_changes}")
    print(f"{'='*70}\n")

    for rel_path, changes in all_results:
        print(f"── {rel_path} ({len(changes)} changes) ──")
        for c in changes:
            print(f"  L{c['line']:>4}: {c['old']}")
            print(f"     ->  {c['new']}")
        print()


if __name__ == "__main__":
    main()
