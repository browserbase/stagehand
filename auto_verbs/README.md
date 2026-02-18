# auto_verbs

Automated browser interaction scripts using [Stagehand](https://github.com/browserbasehq/stagehand) that record interactions and generate Playwright scripts.

## Prerequisites

1. OAuth proxy server running (from `my-stagehand-app/`):
   ```bash
   cd my-stagehand-app
   node oauth-proxy-server.js
   ```
2. Node.js dependencies installed in `my-stagehand-app/`

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
