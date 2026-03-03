#!/usr/bin/env python3
"""
Batch conversion script: Apply CDP technique to all verb scripts.

1. JS files: Comment out fs.writeFileSync lines that write .py files
2. PY files: Convert from launch_persistent_context / chromium.launch
             to CDP approach (subprocess Chrome + connect_over_cdp)

Run from: auto_verbs/verbs/ directory
"""

import os
import re
import sys
import glob
import textwrap

VERBS_DIR = os.path.dirname(os.path.abspath(__file__))

# Files to skip (already converted or special)
SKIP_PY = {
    "expedia_com/expedia_search.py",  # Already CDP
    "open_browser.py",                # Top-level utility, not a site script
}

SKIP_JS = {
    "ebay_com/ebay_search.js",        # Already commented out
    "expedia_com/expedia_search.js",  # Already commented out
    "southwest_com/southwest_search.js",  # Already commented out
}

# Stats
stats = {"js_commented": 0, "py_converted": 0, "py_skipped": 0, "py_failed": []}


# ── JS: Comment out writeFileSync ────────────────────────────────────────

def process_js_file(filepath):
    """Comment out fs.writeFileSync lines that write .py files."""
    rel = os.path.relpath(filepath, VERBS_DIR).replace("\\", "/")
    if rel in SKIP_JS:
        return False

    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    if "fs.writeFileSync" not in content:
        return False

    lines = content.split("\n")
    changed = False
    for i, line in enumerate(lines):
        stripped = line.strip()
        # Skip already commented lines
        if stripped.startswith("//"):
            continue
        # Must be a writeFileSync that writes a .py file or uses genPython
        if "fs.writeFileSync" in stripped and (
            ".py" in stripped
            or "genPython" in stripped
            or "PythonScript" in stripped
            or "pyPath" in stripped
            or "pyScript" in stripped
        ):
            indent = line[: len(line) - len(line.lstrip())]
            lines[i] = f"{indent}// {stripped}  // .py is hand-maintained via CDP"
            changed = True

    if changed:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        stats["js_commented"] += 1
        print(f"  JS ✓ {rel}")
    return changed


# ── PY: Convert to CDP ──────────────────────────────────────────────────

def get_site_name(folder_name):
    """Derive a short site name from the folder, e.g. 'airbnb_com' -> 'airbnb'."""
    return folder_name


def find_indent(line):
    """Return the whitespace prefix of a line."""
    return line[: len(line) - len(line.lstrip())]


def process_py_file(filepath):
    """Convert a Python file from old Playwright launch to CDP approach."""
    rel = os.path.relpath(filepath, VERBS_DIR).replace("\\", "/")
    if rel in SKIP_PY:
        print(f"  PY skip {rel} (already CDP)")
        return False

    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # Skip if already uses CDP
    if "connect_over_cdp" in content:
        print(f"  PY skip {rel} (already CDP)")
        stats["py_skipped"] += 1
        return False

    # Skip if doesn't use playwright at all
    if "playwright" not in content.lower() and "sync_playwright" not in content:
        print(f"  PY skip {rel} (no playwright)")
        stats["py_skipped"] += 1
        return False

    # Determine site name from folder
    parts = rel.replace("\\", "/").split("/")
    folder_name = parts[0] if len(parts) > 1 else "default"
    site_name = get_site_name(folder_name)

    lines = content.split("\n")
    new_lines = []

    # Track what we need to add
    needs_sys_path = True
    needs_shutil_import = "import shutil" not in content
    has_pattern_a = "launch_persistent_context" in content
    has_pattern_c = (
        "chromium.launch(" in content
        and "launch_persistent_context" not in content
    )

    if not has_pattern_a and not has_pattern_c:
        print(f"  PY skip {rel} (no recognizable launch pattern)")
        stats["py_skipped"] += 1
        return False

    # ── State machine to process lines ──
    i = 0
    state = "normal"  # normal, skip_launch_block
    launch_indent = ""
    inserted_cdp_block = False
    paren_depth = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # ── Insert imports after 'from playwright.sync_api import ...' ──
        if needs_sys_path and (
            stripped.startswith("from playwright.sync_api import")
            or stripped.startswith("from playwright.sync_api import")
        ):
            new_lines.append(line)
            i += 1
            # Add blank line, then sys.path and cdp_utils import
            new_lines.append("")
            new_lines.append("import sys as _sys")
            new_lines.append("import os as _os")
            new_lines.append(
                '_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))'
            )
            new_lines.append(
                "from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws"
            )
            if needs_shutil_import:
                new_lines.append("import shutil")
            needs_sys_path = False
            continue

        # ── Pattern A: Detect user_data_dir block start ──
        if has_pattern_a and state == "normal":
            # Look for user_data_dir = os.path.join(  or  user_data_dir = os.path.join(
            if "user_data_dir" in stripped and (
                "os.path.join" in stripped or "os.environ" in stripped
            ):
                launch_indent = find_indent(line)
                state = "skip_user_data_dir"
                # Count parens to find end of os.path.join(...)
                paren_depth = stripped.count("(") - stripped.count(")")
                i += 1
                continue

        if state == "skip_user_data_dir":
            paren_depth += stripped.count("(") - stripped.count(")")
            if paren_depth <= 0:
                state = "skip_launch_persistent"
            i += 1
            continue

        if state == "skip_launch_persistent":
            if "launch_persistent_context" in stripped:
                paren_depth = stripped.count("(") - stripped.count(")")
                if paren_depth <= 0:
                    state = "find_page_line"
                else:
                    state = "skip_launch_args"
                i += 1
                continue
            # Empty lines or other setup between user_data_dir and launch
            i += 1
            continue

        if state == "skip_launch_args":
            paren_depth += stripped.count("(") - stripped.count(")")
            if paren_depth <= 0:
                state = "find_page_line"
            i += 1
            continue

        if state == "find_page_line":
            # Look for page = context.pages[0] or page = context.new_page()
            if "context.pages" in stripped or "context.new_page" in stripped:
                # Insert CDP block here
                ws = launch_indent
                new_lines.append(f"{ws}port = get_free_port()")
                new_lines.append(
                    f'{ws}profile_dir = get_temp_profile_dir("{site_name}")'
                )
                new_lines.append(f"{ws}chrome_proc = launch_chrome(profile_dir, port)")
                new_lines.append(f"{ws}ws_url = wait_for_cdp_ws(port)")
                new_lines.append(
                    f"{ws}browser = playwright.chromium.connect_over_cdp(ws_url)"
                )
                new_lines.append(f"{ws}context = browser.contexts[0]")
                new_lines.append(
                    f"{ws}page = context.pages[0] if context.pages else context.new_page()"
                )
                inserted_cdp_block = True
                state = "normal"
                i += 1
                continue
            # Skip blank lines or other lines before page line
            i += 1
            continue

        # ── Pattern C: Detect chromium.launch block ──
        if has_pattern_c and state == "normal":
            if "chromium.launch(" in stripped and "connect" not in stripped:
                launch_indent = find_indent(line)
                state = "skip_launch_c"
                paren_depth = stripped.count("(") - stripped.count(")")
                i += 1
                continue

        if state == "skip_launch_c":
            paren_depth += stripped.count("(") - stripped.count(")")
            if paren_depth <= 0:
                state = "skip_new_context"
            i += 1
            continue

        if state == "skip_new_context":
            # Skip ctx = browser.new_context(...) and page = ctx.new_page()
            if "new_context" in stripped:
                paren_depth = stripped.count("(") - stripped.count(")")
                if paren_depth > 0:
                    state = "skip_new_context_args"
                i += 1
                continue
            if "new_page()" in stripped:
                # Insert CDP block here (Pattern C)
                ws = launch_indent
                # Find the variable name used for playwright
                # Usually 'pw' in pattern C
                pw_var = "pw"
                for l in lines:
                    m = re.search(r"with\s+sync_playwright\(\)\s+as\s+(\w+)", l)
                    if m:
                        pw_var = m.group(1)
                        break
                new_lines.append(f"{ws}port = get_free_port()")
                new_lines.append(
                    f'{ws}profile_dir = get_temp_profile_dir("{site_name}")'
                )
                new_lines.append(f"{ws}chrome_proc = launch_chrome(profile_dir, port)")
                new_lines.append(f"{ws}ws_url = wait_for_cdp_ws(port)")
                new_lines.append(
                    f"{ws}browser = {pw_var}.chromium.connect_over_cdp(ws_url)"
                )
                new_lines.append(f"{ws}ctx = browser.contexts[0]")
                new_lines.append(f"{ws}page = ctx.pages[0] if ctx.pages else ctx.new_page()")
                inserted_cdp_block = True
                state = "normal"
                i += 1
                continue
            if stripped == "" or stripped.startswith("#"):
                i += 1
                continue
            # Other lines — stop skipping, insert before this line
            state = "normal"
            continue

        if state == "skip_new_context_args":
            paren_depth += stripped.count("(") - stripped.count(")")
            if paren_depth <= 0:
                state = "skip_new_context"
            i += 1
            continue

        # ── Replace context.close() with CDP cleanup ──
        if state == "normal" and inserted_cdp_block:
            if stripped == "context.close()":
                ws = find_indent(line)
                new_lines.append(f"{ws}try:")
                new_lines.append(f"{ws}    browser.close()")
                new_lines.append(f"{ws}except Exception:")
                new_lines.append(f"{ws}    pass")
                new_lines.append(f"{ws}chrome_proc.terminate()")
                new_lines.append(
                    f"{ws}shutil.rmtree(profile_dir, ignore_errors=True)"
                )
                i += 1
                continue
            # Also handle browser.close() in pattern C
            if stripped == "browser.close()":
                ws = find_indent(line)
                new_lines.append(f"{ws}try:")
                new_lines.append(f"{ws}    browser.close()")
                new_lines.append(f"{ws}except Exception:")
                new_lines.append(f"{ws}    pass")
                new_lines.append(f"{ws}chrome_proc.terminate()")
                new_lines.append(
                    f"{ws}shutil.rmtree(profile_dir, ignore_errors=True)"
                )
                i += 1
                continue

        # ── Default: keep line as-is ──
        new_lines.append(line)
        i += 1

    if not inserted_cdp_block:
        print(f"  PY FAIL {rel} (could not find launch block)")
        stats["py_failed"].append(rel)
        return False

    # ── Also handle Pattern C's tmp_profile() and profile cleanup ──
    # For Pattern C files that had their own tmp_profile + shutil.rmtree,
    # we need to redirect the profile dir
    new_content = "\n".join(new_lines)

    # If the file had a tmp_profile() function, the CDP block now handles profile
    # We need to remove the old `prof = tmp_profile()` call and the cleanup
    # But only for Pattern C files
    if has_pattern_c:
        # Replace `prof = tmp_profile()` with a comment
        new_content = re.sub(
            r"(\s+)prof\s*=\s*tmp_profile\(\)\n",
            r"\1# profile_dir handled by CDP launch below\n",
            new_content,
        )
        # Replace shutil.rmtree(prof, ...) — only if it references 'prof'
        new_content = re.sub(
            r"(\s+)shutil\.rmtree\(prof,.*?\)\n",
            r"\1# profile_dir cleanup handled by CDP\n",
            new_content,
        )
        # Fix: profile_dir is defined inside the with block for pattern C,
        # so we need the cleanup to also be inside

    # ── If sys.path import wasn't added (e.g., no 'from playwright' line) ──
    if needs_sys_path:
        # Insert at top of file, after docstring and initial imports
        import_block = (
            "import sys as _sys\n"
            "import os as _os\n"
            '_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))\n'
            "from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws\n"
        )
        if needs_shutil_import:
            import_block += "import shutil\n"
        # Find first non-comment, non-import, non-blank line after imports
        insert_pos = 0
        in_docstring = False
        for j, l in enumerate(new_content.split("\n")):
            s = l.strip()
            if s.startswith('"""') or s.startswith("'''"):
                if in_docstring:
                    in_docstring = False
                    insert_pos = j + 1
                    continue
                else:
                    in_docstring = True
                    continue
            if in_docstring:
                continue
            if s.startswith("import ") or s.startswith("from ") or s == "" or s.startswith("#"):
                insert_pos = j + 1
                continue
            break
        nlines = new_content.split("\n")
        nlines.insert(insert_pos, import_block)
        new_content = "\n".join(nlines)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)
    stats["py_converted"] += 1
    print(f"  PY ✓ {rel}")
    return True


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  CDP Batch Conversion")
    print("=" * 60)
    print(f"  Verbs dir: {VERBS_DIR}\n")

    # ── Process JS files ──
    print("── JS files: commenting out writeFileSync ──")
    for js_file in sorted(glob.glob(os.path.join(VERBS_DIR, "**", "*.js"), recursive=True)):
        process_js_file(js_file)

    # ── Process PY files ──
    print("\n── PY files: converting to CDP ──")
    for py_file in sorted(glob.glob(os.path.join(VERBS_DIR, "**", "*.py"), recursive=True)):
        rel = os.path.relpath(py_file, VERBS_DIR).replace("\\", "/")
        # Skip probe files, conversion script itself, and cdp_utils
        basename = os.path.basename(py_file)
        if basename in ("convert_to_cdp.py", "cdp_utils.py", "__init__.py"):
            continue
        if "probe_" in basename:
            print(f"  PY skip {rel} (probe file)")
            continue
        process_py_file(py_file)

    # ── Summary ──
    print("\n" + "=" * 60)
    print("  Summary")
    print("=" * 60)
    print(f"  JS files commented:  {stats['js_commented']}")
    print(f"  PY files converted:  {stats['py_converted']}")
    print(f"  PY files skipped:    {stats['py_skipped']}")
    if stats["py_failed"]:
        print(f"  PY files FAILED:     {len(stats['py_failed'])}")
        for f in stats["py_failed"]:
            print(f"    - {f}")
    print()


if __name__ == "__main__":
    main()
