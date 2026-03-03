#!/usr/bin/env python3
"""
fix_js_genpython.py
Batch-update genPython() in all JS files so they emit CDP-based Python code.
Also restores the writeFileSync lines that were incorrectly commented out.

Usage:  python fix_js_genpython.py
"""
import os, re

VERBS_DIR = os.path.dirname(os.path.abspath(__file__))


def site_of(path):
    return os.path.basename(os.path.dirname(path))


def find_affected_files():
    """Walk the verbs tree and find .js files with the marker comment."""
    out = []
    for root, _, fnames in os.walk(VERBS_DIR):
        for fn in fnames:
            if not fn.endswith(".js"):
                continue
            fp = os.path.join(root, fn)
            with open(fp, encoding="utf-8") as f:
                txt = f.read()
            if "// .py is hand-maintained via CDP" in txt:
                out.append(fp)
    return sorted(out)


def process_file(fp):
    site = site_of(fp)
    with open(fp, encoding="utf-8") as f:
        txt = f.read()
    original = txt
    log = []

    # ── 0. Skip if already converted ──────────────────────────────────────
    if "from cdp_utils import" in txt:
        return ["Already has cdp_utils – skipped"]

    # ── 1. Uncomment writeFileSync lines ──────────────────────────────────
    txt, n = re.subn(
        r'(\s*)// (fs\.writeFileSync\([^;]+\);)\s*// \.py is hand-maintained via CDP',
        r'\1\2',
        txt,
    )
    if n:
        log.append(f"Uncommented {n} writeFileSync line(s)")

    # Detect which Python template pattern is used
    has_lpc = "launch_persistent_context" in txt
    has_pw_launch = bool(re.search(r'pw\.chromium\.launch\(', txt))

    if not has_lpc and has_pw_launch:
        # Pattern 2 (walmart / target / homedepot) — very different structure
        log.append("PATTERN-2 (pw.chromium.launch) – needs separate handling")
        if txt != original:
            with open(fp, "w", encoding="utf-8") as f:
                f.write(txt)
        return log

    if not has_lpc:
        log.append("WARNING: No launch_persistent_context found in template")
        if txt != original:
            with open(fp, "w", encoding="utf-8") as f:
                f.write(txt)
        return log

    # ── 2. Add sys / shutil to existing Python imports ────────────────────
    pw_marker = "from playwright.sync_api import"
    idx = txt.find(pw_marker)
    if idx == -1:
        log.append("WARNING: No 'from playwright.sync_api import' found")
        if txt != original:
            with open(fp, "w", encoding="utf-8") as f:
                f.write(txt)
        return log

    preceding = txt[:idx]

    # Try combined import line first (e.g. "import re, os, traceback")
    combined_m = re.search(r'^(import [\w, ]*\bos\b[\w, ]*)$', preceding, re.MULTILINE)
    if combined_m:
        old_line = combined_m.group(1)
        mods = [m.strip() for m in old_line.replace("import ", "", 1).split(",")]
        added = []
        for mod in ("sys", "shutil"):
            if mod not in mods:
                mods.append(mod)
                added.append(mod)
        if added:
            new_line = "import " + ", ".join(mods)
            txt = txt.replace(old_line, new_line, 1)
            log.append(f"Added {', '.join(added)} to combined import")
    else:
        # Individual import lines — insert before from playwright...
        ins = ""
        if not re.search(r'^import sys\b', preceding, re.MULTILINE):
            ins += "import sys\n"
        if not re.search(r'^import shutil\b', preceding, re.MULTILINE):
            ins += "import shutil\n"
        if ins:
            txt = txt.replace(pw_marker, ins + pw_marker, 1)
            log.append("Added individual imports: sys, shutil")

    # ── 3. Add cdp_utils import block ─────────────────────────────────────
    cdp_block = (
        '\n\nsys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))'
        '\nfrom cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws'
    )
    txt = re.sub(
        r'(from playwright\.sync_api import [^\n]+)',
        r'\1' + cdp_block,
        txt, count=1,
    )
    log.append("Added cdp_utils import block")

    # ── 4. Replace user_data_dir + launch_persistent_context → CDP ────────
    lpc_re = re.compile(
        r'(\s+)user_data_dir\s*=\s*os\.path\.join\([^)]+\)\s*\n'
        r'(?:\s*\n)*'
        r'(\s+)context\s*=\s*playwright\.chromium\.launch_persistent_context\([^)]+\)\s*\n'
        r'(\s+)(page\s*=\s*context\.pages\[0\].*)',
    )
    m = lpc_re.search(txt)
    if m:
        ind = m.group(2)
        page_ind = m.group(3)
        page_line = m.group(4)
        repl = (
            f'\n{ind}port = get_free_port()\n'
            f'{ind}profile_dir = get_temp_profile_dir("{site}")\n'
            f'{ind}chrome_proc = launch_chrome(profile_dir, port)\n'
            f'{ind}ws_url = wait_for_cdp_ws(port)\n'
            f'{ind}browser = playwright.chromium.connect_over_cdp(ws_url)\n'
            f'{ind}context = browser.contexts[0]\n'
            f'{page_ind}{page_line}'
        )
        txt = txt[:m.start()] + repl + txt[m.end():]
        log.append("Replaced launch_persistent_context → CDP launch")
    else:
        log.append("WARNING: Could not match launch_persistent_context block")

    # ── 5. Replace context.close() → CDP cleanup ─────────────────────────
    def _cleanup(m):
        ind = m.group(1)
        return (
            f'{ind}try:\n'
            f'{ind}    browser.close()\n'
            f'{ind}except Exception:\n'
            f'{ind}    pass\n'
            f'{ind}chrome_proc.terminate()\n'
            f'{ind}shutil.rmtree(profile_dir, ignore_errors=True)'
        )

    txt, n = re.subn(r'(\s+)context\.close\(\)', _cleanup, txt)
    if n:
        log.append(f"Replaced context.close() → CDP cleanup ({n}x)")

    # ── Save ──────────────────────────────────────────────────────────────
    if txt != original:
        with open(fp, "w", encoding="utf-8") as f:
            f.write(txt)
    return log


def main():
    files = find_affected_files()
    print(f"Found {len(files)} JS files with commented-out writeFileSync\n")

    ok, warn, skip = 0, 0, 0
    pattern2_files = []
    warning_files = []

    for fp in files:
        site = site_of(fp)
        fn = os.path.basename(fp)
        log = process_file(fp)

        has_warn = any("WARNING" in l or "PATTERN-2" in l for l in log)
        is_skip = any("skipped" in l.lower() for l in log)

        if is_skip:
            skip += 1
            sym = "SKIP"
        elif has_warn:
            warn += 1
            sym = "WARN"
            if "PATTERN-2" in " ".join(log):
                pattern2_files.append(fp)
            else:
                warning_files.append(fp)
        else:
            ok += 1
            sym = " OK "

        print(f"[{sym}] {site}/{fn}")
        for l in log:
            print(f"        {l}")

    print(f"\n{'='*60}")
    print(f"Converted: {ok}  |  Warnings: {warn}  |  Skipped: {skip}")
    if pattern2_files:
        print(f"\nPattern-2 files (writeFileSync uncommented, CDP not applied):")
        for fp in pattern2_files:
            print(f"  {os.path.relpath(fp, VERBS_DIR)}")
    if warning_files:
        print(f"\nWarning files (need manual inspection):")
        for fp in warning_files:
            print(f"  {os.path.relpath(fp, VERBS_DIR)}")


if __name__ == "__main__":
    main()
