# CLAUDE.md — Backend (Radar Sensor Fusion + ML Detection)

Backend for the Low-Observable Target Radar demo (Fable 5.1 Build Day). Owner: Pranav (backend/ML). Frontend counterpart lives in `../frontend/` (Sid). Full specs in `../doc/` — this file is the working summary; when in doubt, docs win.

## What this backend does
1. Generates a **fully synthetic, seeded** radar target set once at startup (no external data, ever).
2. Trains RandomForestClassifier + IsolationForest on it at startup (<2s), computes fusion confidence per target.
3. Serves precomputed detection state over REST; calls Claude **only** on an explicit `/api/explain` request.

The entire demo hinges on one moment: injected "stealth" targets (low primary SNR) are **missed by the baseline threshold but caught by fusion**. Nothing may break that.

## Stack
- Python, FastAPI + uvicorn (port 8000), scikit-learn, numpy, pandas, `anthropic` SDK.
- No DB, no auth, no websockets, no model persistence (pickle/joblib) — everything in-memory per process. These are deliberate exclusions (BRD §6.2), not TODOs.

## File structure (Design Doc §8)
```
backend/
  main.py        # FastAPI app, routes; train models BEFORE accepting requests
  generator.py   # synthetic data generation (Data Ingestion Doc)
  models.py      # RandomForest + IsolationForest training & inference
  fusion.py      # fusion confidence scoring
  explain.py     # Claude API wrapper + hardcoded fallback report
  schemas.py     # Pydantic models mirroring the API contract below
```

## API contract (LOCKED — do not rename fields without updating frontend/CLAUDE.md and telling Sid)

### `GET /api/detections/baseline`
```json
[{ "id": 1, "range_m": 4210.5, "azimuth_deg": 132.4, "doppler_velocity": -85.2,
   "rcs": 22.1, "snr_db": 27.3, "x": 312.0, "y": 208.5,
   "true_label": "plane", "detected": true }]
```
Baseline rule: `detected = snr_db > 10` (primary sensor only — this is what misses stealth targets).

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
Response: `{ "report": "..." }` — 2–3 sentence situation report.

Errors: unknown id → `404 {"error": "detection not found"}`; Claude failure/timeout → **`200` with pre-written fallback string + `"fallback": true`** (UI must never show a broken state live); malformed body → 422 (FastAPI default).

## Data generation rules (Data Ingestion Doc)
- `np.random.seed(42)` once at module load. Same seed → identical target set every run. **Never regenerate live during the demo.**
- ~40 normal targets + 6–8 stealth-injected = ~46–48 total.
- Class profiles: plane (RCS 20–50, SNR 25–40, fast steady doppler), vehicle (RCS 5–15, SNR 18–30, near-zero doppler), bird (RCS 0.01–0.05, SNR 10–20, erratic), drone (RCS 0.05–0.5, overlaps birds — intentional), clutter (random low-mid, SNR 5–15).
- Stealth injection: label `drone`/`plane`, primary `snr_db` forced to 2–8 dB, but `sensor_2_snr_db`/`sensor_3_snr_db` redrawn from ~10–18 dB (angle-dependent RCS justification).
- Field ranges: `range_m` 500–8000, `azimuth_deg` [0, 360), `doppler_velocity` −300..+300, `rcs > 0`, `snr_db` clipped to ≥1.
- `x`, `y`: backend converts range/azimuth → Cartesian pixel coords for a **600×600 canvas centered at origin**. The frontend never does trig.
- **Startup assertion (mandatory):** at least 1 target has `snr_db < 10 AND fused_detected == true AND baseline_detected == false`. Fail loudly at startup if not — never let a bad draw silently kill the demo moment.

## ML rules (ML Doc)
- Features (both models): `range_m, doppler_velocity, rcs, snr_db, sensor_2_snr_db, sensor_3_snr_db`. No scaling needed (tree models).
- `RandomForestClassifier(n_estimators=100, random_state=42)`, fit on full set (no held-out split — accepted v1 limitation, ML Doc §10).
- `IsolationForest(contamination=0.15, random_state=42)`; normalize `decision_function` output to 0–1 `anomaly_score` via min-max across the set (more anomalous → higher score).
- Fusion: weighted/mean combination of the 3 sensor SNRs normalized to 0–1; `fused_detected = fusion_confidence > threshold` chosen as a fair equivalent of the baseline's `snr_db > 10`.
- Everything computed once at startup into the DataFrame; endpoints serve from memory (<200ms).

## Claude explain layer
- Model `claude-sonnet-4-6`, `max_tokens: 150`. Called only on click, never on a timer.
- Prompt: "You are a radar operator's assistant. A target was detected with: class={class}, anomaly_score={score}, RCS={rcs} m², SNR={snr} dB. Write a 2-sentence plain-English situation report as it would appear on a tactical display. Be concise and factual."
- API key from `ANTHROPIC_API_KEY` env var only — never hardcoded, never sent to the frontend.
- Always have the fallback report string ready (venue WiFi risk).

## Run
```bash
cd backend
pip install fastapi uvicorn scikit-learn numpy pandas anthropic
uvicorn main:app --reload --port 8000
```
Enable CORS for the frontend origin (it's served separately, e.g. `python -m http.server 5500`).

## Guardrails
- Resist scope creep: no Kalman filter, no CNN, no real datasets, no websockets, no DB. Out of scope per BRD §6.2.
- Train models synchronously before the server accepts requests (no 503 race with the frontend's first poll).
- Reproducibility beats realism: it must behave identically in every rehearsal.
