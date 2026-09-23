# CLAUDE.md — Frontend (Radar Sensor Fusion + ML Detection)

Frontend for the Low-Observable Target Radar demo (Fable 5.1 Build Day). Owner: Sid. Backend counterpart lives in `../backend/` (Pranav). Full specs in `../doc/` — this file is the working summary; when in doubt, docs win.

## What this frontend does
A dark "radar console" page with two side-by-side radar sweep panels — **"Conventional Threshold"** vs **"Fusion + ML"** — polling the backend every ~1.5s. The demo's whole point: a stealth blip appears **only on the Fusion+ML panel**. Clicking a blip opens a detail panel with an "Explain" button that fetches a Claude-generated situation report.

## Stack (deliberate — do not upgrade)
- **Vanilla HTML + Canvas + JS + plain CSS.** No React, no bundler, no build step, no websockets. These were explicitly rejected (Design Doc §5); polling at ~1.5s via `fetch()` is the architecture, not a shortcut.
- Files: `index.html` (+ optionally `app.js`, `style.css` — either single-file or split is fine at this scope).
- Serve via `python -m http.server 5500` or open directly in the browser.

## Build against mock data FIRST
Until integration (~minute 35), develop against a hardcoded mock JSON matching the contract below **exactly** — same field names, same types. Integration is then a data-source swap (mock → `fetch('http://localhost:8000/api/...')`), not a rebuild. Keep the mock in one obvious place so the swap is one line.

Mock must include at least one target with `fused_detected: true, baseline_detected: false, snr_db < 10` (the hero stealth target) so the key visual moment is buildable before the backend exists.

## API contract (LOCKED — matches backend/CLAUDE.md; never invent or rename fields)

### `GET /api/detections/baseline`
```json
[{ "id": 1, "range_m": 4210.5, "azimuth_deg": 132.4, "doppler_velocity": -85.2,
   "rcs": 22.1, "snr_db": 27.3, "x": 312.0, "y": 208.5,
   "true_label": "plane", "detected": true }]
```

### `GET /api/detections/fused`
```json
[{ "id": 7, "range_m": 3100.2, "azimuth_deg": 45.9, "doppler_velocity": 12.4,
   "rcs": 0.12, "snr_db": 4.5, "sensor_2_snr_db": 13.2, "sensor_3_snr_db": 11.8,
   "x": 220.1, "y": 190.7, "true_label": "drone", "predicted_class": "drone",
   "anomaly_score": 0.81, "fusion_confidence": 0.74,
   "fused_detected": true, "baseline_detected": false }]
```

### `POST /api/explain`
Request: `{ "id": 7, "class": "drone", "anomaly_score": 0.81, "rcs": 0.12, "snr_db": 4.5 }`
Response: `{ "report": "..." }`. May include `"fallback": true` — still render the report normally (never an error state).

Key contract facts:
- `x`, `y` are **precomputed pixel coordinates for a 600×600 canvas centered at origin** — the frontend does zero trig.
- Baseline panel shows a blip iff `detected` is true; Fusion panel iff `fused_detected` is true.
- Classes: `drone | bird | plane | vehicle | clutter` — one color per class, legible from a distance.

## UI architecture (Design Doc §7)
- **State:** two in-memory arrays (`baselineDetections`, `fusedDetections`), replaced on each poll.
- **Render loop:** `requestAnimationFrame` drives the rotating sweep line, independent of the poll cycle. A blip fades in when the sweep line has passed its azimuth in the current rotation, then slowly fades.
- **Click handling:** canvas click → nearest-blip hit-test by distance to `(x, y)` → side panel with detection details + "Explain" button → button fires `POST /api/explain`.
- **Explain UX:** show a loading state; **disable the Explain button while a request is in-flight** (rapid multi-clicks must not stack requests). Render whatever `report` comes back.

## Visual theme
Dark radar-console look: near-black background, green sweep/grid, class-colored blips, clear panel titles ("Conventional Threshold" / "Fusion + ML"). Judges watch from a distance — prioritize legibility (font size, blip size, contrast) over subtlety.

## Guardrails
- Do not add frameworks, build tooling, websockets, or state libraries — speed and zero-build-step is the whole point.
- Poll interval ~1.5s; never call `/api/explain` on a timer — click-only.
- Animation smoothness matters more than exact FPS; avoid visible jank.
- The demo's success criterion: within the first 2 sweep rotations, a viewer can see a blip on Fusion+ML that's absent on Conventional, click it, and read a report in <3s.
