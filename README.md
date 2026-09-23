# LO-Target Radar — Sensor Fusion + ML Detection

> **Single threshold misses it. Fusion + ML catches it.**

A live radar demo built in one hackathon session (Fable 5.1 Build Day, Mumbai). A conventional fixed-threshold detector and a multi-sensor **fusion + ML** pipeline watch the same synthetic airspace side by side — and the low-observable ("stealth") targets that the conventional scope never shows appear on the fusion scope, classified, anomaly-scored, and explainable in plain English via Claude.

**Team:** Pranav (backend/ML) · Sid (frontend) · Shubhangi (docs/demo/QA)

---

## Why this matters

Conventional radar applies a fixed detection threshold to a single receiver's signal-to-noise ratio. High-signature targets pass it easily; small drones and stealth-shaped aircraft can sit at the noise floor and never trigger it. The real-world counter-technique is **multistatic sensor fusion**: a target that is "stealthy" from one receiver's angle usually isn't from another's, so combining several weak, imperfect readings statistically beats any single high-precision sensor.

The same principle powers fraud detection, network intrusion detection, and IoT anomaly monitoring — this is a physics-grounded demo of a genuinely general technique.

## The demo moment

1. Both scopes sweep the same 46 seeded targets.
2. Normal contacts (planes, vehicles, birds, clutter) appear on **both** panels.
3. Six injected low-observable targets (primary SNR 2–8 dB) appear **only on the Fusion + ML panel**, ringed and tagged "Recovered".
4. Click one → sensor bars show *why* (primary below threshold, sensors 2/3 above), ML scores show classification + anomaly, and **Explain** fetches a 2-sentence Claude-generated situation report.

**Measured on the seeded set:** baseline recall on the stealth subset **0%**, fusion recall **100%** (hero target IDs 41–46). Classifier: 100% on the training distribution, clean bird-vs-drone confusion matrix.

## Architecture

```
┌─────────────────────────────┐
│ generator.py  (numpy, seed 42)  40 normal + 6 stealth targets │
└──────────────┬──────────────┘
┌──────────────▼──────────────┐
│ FastAPI backend  :8000       │
│  RandomForest   → class      │
│  IsolationForest → anomaly   │
│  Fusion score   → recovery   │
│  /api/explain   → Claude     │
└──────────────┬──────────────┘
               │ JSON, polled every 1.5 s
┌──────────────▼──────────────┐
│ Frontend  :5500  (vanilla JS + Canvas)         │
│  two live scopes · contact inspector · explain │
└─────────────────────────────┘
```

**Stack:** Python, FastAPI, scikit-learn, numpy/pandas · vanilla HTML/Canvas/JS (no framework, no build step) · Claude API (`claude-sonnet-4-6`), called only on click.

## Quickstart

### 1. Backend (port 8000)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# optional but recommended — live Claude reports instead of the canned fallback:
$env:ANTHROPIC_API_KEY = "sk-ant-..."

.venv\Scripts\python.exe -m uvicorn main:app --port 8000
```

Startup generates the seeded dataset, trains both models (<2 s), and **asserts the demo moment exists** (≥1 target missed by baseline, caught by fusion) before serving. Interactive API docs at `http://localhost:8000/docs`.

### 2. Frontend (port 5500)

```powershell
cd frontend
python -m http.server 5500
```

Open **http://localhost:5500** — the header pill shows `Live · localhost:8000`.

### 3. Pre-demo check

```powershell
cd backend
.venv\Scripts\python.exe verify_demo.py   # recall numbers, confusion matrix, hero target ids
```

## Mock mode — how two people built this in parallel

The API contract (below) was locked in the first five minutes, then each half was built against it independently:

- **`frontend/mock-api.js`** — a seeded in-browser mock of the entire backend (same endpoints, field names, error shapes, even simulated latency and a mulberry32 RNG). The frontend was fully built and rehearsed against this before the backend existed.
- **`frontend/mock_detections.json`** — real captured output from the seeded backend, kept in the repo as the contract's ground truth.
- **Integration was a one-flag swap** (`USE_MOCK` in `frontend/api.js`) plus one coordinate-convention fix — no rebuild.

Mock mode is still available any time — open **`http://localhost:5500?api=mock`** to run the full UI with zero backend (useful for rehearsal, or if anything goes wrong live). `?api=live` forces the real backend.

## API contract

| Endpoint | Returns |
|---|---|
| `GET /api/detections/baseline` | All targets + `detected` (rule: primary `snr_db > 10`) |
| `GET /api/detections/fused` | Same targets + `predicted_class`, `anomaly_score`, `fusion_confidence`, `fused_detected`, `baseline_detected` |
| `POST /api/explain` `{id, class, anomaly_score, rcs, snr_db}` | `{report, fallback?}` — 2-sentence situation report |

`x, y` are precomputed absolute pixels for a 600×600 canvas (centre 300,300) — the backend owns all trig. Unknown id → `404 {"error": "detection not found"}`. If the Claude call fails or exceeds 4 s, the endpoint still returns `200` with a pre-written report and `"fallback": true` — the UI never shows a broken state.

## How detection works

- **Baseline:** `detected = snr_db > 10` on the primary sensor. Misses everything injected near the noise floor.
- **Fusion:** sigmoid over the mean of three sensor SNRs, centred at the same 10 dB — so `fusion_confidence > 0.5` is the exact like-for-like equivalent rule. Stealth targets read 2–8 dB on the primary but 12–18 dB on the spatially separated receivers (angle-dependent RCS), and the combined confidence crosses the line.
- **RandomForest** (100 trees) classifies drone/bird/plane/vehicle/clutter from 6 features; **IsolationForest** (contamination 0.15) provides an independent anomaly score, min-max normalised to 0–1.

## Repo layout

```
backend/    FastAPI app, generator, models, fusion, Claude explain layer
frontend/   index.html, radar.js (scopes), app.js (state/inspector), api.js (live/mock switch), mock-api.js
doc/        BRD, design/architecture, data ingestion, ML doc, build-day plan
slides/     2-slide deck for the showcase
```

Each of `backend/` and `frontend/` has its own `CLAUDE.md` with the locked contract and working rules.

## Honest limitations (v1)

- Fully synthetic, physics-informed data — not calibrated against real radar measurements.
- No held-out test set; accuracy shows the model *can learn the pattern*, not real-world generalisation.
- Fusion uses independent-noise sensors, not true multistatic geometry.
- Static seeded dataset per session — by design, so rehearsal and demo are identical.

Roadmap (v2): real public radar/ADS-B data, Kalman tracking across sweeps, geometry-aware fusion, proper cross-validation. See `doc/` for detail.
