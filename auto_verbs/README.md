# auto_verbs

Automated browser interaction scripts using [Stagehand](https://github.com/browserbasehq/stagehand) that record interactions and generate Playwright scripts.

## Prerequisites

1. Azure CLI authenticated (`az login`)
2. Node.js dependencies installed

## Programs

### `google_maps_directions.js`

Searches Google Maps for driving directions from **Bellevue Square** to **Redmond Town Center**, records every browser interaction, and generates a Python Playwright script.

**Run:**
```bash
node google_maps_directions.js
```

**Outputs:**
- `google_maps_directions.py` — Replay-ready Python Playwright script
- `recorded_actions.json` — Raw action log (JSON)
- `directions_result.png` — Screenshot of the directions result

**Generated Python script requires:**
```bash
pip install playwright
playwright install chromium
python google_maps_directions.py
```


**How to run a js in GitHub Codespace**
`CHROME_PATH` is preconfigured in workspace terminal settings for Linux Codespace terminals.

*** Using xvfb ***
xvfb-run -a python auto_verbs/verbs/ubereats_com/ubereats_search.py

*** Using noVNC ***
/workspaces/stagehand/auto_verbs/start-browser-desktop.sh
Visit https://glowing-carnival-wrv6q4v5q77h9wpj-6080.app.github.dev/vnc.html in the browser on local machine.
DISPLAY=:99 python auto_verbs/verbs/trulia_com/trulia_search.py