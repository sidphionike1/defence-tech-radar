# Design / Architecture Document
## Low-Observable Target Radar — Sensor Fusion + ML Detection System, v1

---

## 1. Overview & Goals
This document specifies the full technical architecture: components, data flow, API contract, frontend/backend structure, non-functional requirements, and deployment steps needed to build the system live in ~50 minutes with two developers working in parallel.

**Primary design principle:** minimize coupling between frontend and backend by locking the API contract first, so both developers can build simultaneously against a shared, agreed schema rather than serially.

## 2. System Context Diagram
```
                         ┌───────────────────────────┐
                         │        You / Sid           │
                         │   (operators of the demo)  │
                         └──────────────┬─────────────┘
                                        │ views/clicks
                         ┌──────────────▼─────────────┐
                         │   Frontend (browser, HTML/  │
                         │   Canvas/JS) — Sid owns      │
                         └──────────────┬─────────────┘
                                        │ HTTP (fetch, polling)
                         ┌──────────────▼─────────────┐
                         │  FastAPI Backend — You own   │
                         │  - Data generator             │
                         │  - ML models (RF, IsoForest)  │
                         │  - Fusion scoring              │
                         └──────────────┬─────────────┘
                                        │ HTTPS (on-demand only)
                         ┌──────────────▼─────────────┐
                         │   Claude API (explain layer) │
                         └───────────────────────────┘
```

## 3. Component Breakdown

### 3.1 Data Generator (backend, Python module)
Generates the full synthetic target set once at startup (seeded), held in memory for the session. See Data Ingestion Doc for full detail.

### 3.2 ML Layer (backend, Python module)
- RandomForestClassifier — target type classification.
- IsolationForest — unsupervised anomaly scoring.
- Fusion confidence function — weighted combination of multi-sensor SNR.
See ML Doc for full detail.

### 3.3 FastAPI Backend (Python)
Exposes REST endpoints (§6) serving both the "baseline" (naive threshold) and "fused" (ML) detection views, plus the on-demand explain endpoint.

### 3.4 LLM Explain Layer
A thin wrapper around the Claude API, called only when a user clicks a specific detection — not on a timer/loop, to control latency and API spend.

### 3.5 Frontend (HTML + Canvas + vanilla JS)
- Radar sweep animation (rotating line, fading blips).
- Two side-by-side panels: "Conventional Threshold" vs "Fusion + ML".
- Click-to-inspect side panel showing detection details + explain button.
- Polls backend every ~1.5s to refresh state (simulating a live radar refresh cycle) — NOT a websocket, to keep build complexity low.

## 4. Detailed Data Flow (sequence)
1. Backend starts → generator produces N synthetic targets (in memory, seeded).
2. Backend trains RandomForest + IsolationForest on the generated set at startup (sub-second).
3. Frontend loads → begins polling `GET /api/detections/baseline` and `GET /api/detections/fused` every ~1.5s.
4. Backend recomputes/serves current detection state (static per session unless you choose to add slow drift — not required for v1).
5. Frontend renders sweep animation; as the sweep line passes each target's azimuth, its blip fades in on the appropriate panel(s) if `detected`/`fused_detected` is true.
6. User clicks a blip → frontend sends `POST /api/explain` with that target's fields.
7. Backend calls Claude API → returns a 2–3 sentence situation report → frontend displays it in the side panel.

## 5. Technology Stack & Justification

| Layer | Choice | Why |
|---|---|---|
| Backend framework | FastAPI + uvicorn | Async-ready, auto docs at `/docs` for quick manual testing during build, minimal boilerplate |
| ML | scikit-learn | Trains in milliseconds on small synthetic data, zero GPU/infra needed, well-understood by both devs |
| Data | numpy/pandas, synthetic | Removes all external dependency/network risk from the critical path |
| Frontend | Vanilla HTML/Canvas/JS | No build step, no bundler, no framework learning curve — fastest path to a working animation in under an hour |
| LLM | Claude API, on-demand only | Keeps latency and cost bounded; avoids continuous-call architecture that would burn credits and risk rate limits mid-demo |
| Styling | Plain CSS, dark "radar console" theme | Fast to hand-write, thematically appropriate, judges respond well to a cohesive visual theme |

**Explicitly rejected for v1 (see BRD §6.2 for rationale):** React/frontend framework (build tooling overhead), WebSockets (unnecessary complexity for a ~1.5s refresh cadence), a real database (no persistence requirement), CNN/image-based detection (training risk too high for the time budget).

## 6. API Design (full contract)

### `GET /api/detections/baseline`
Returns all targets with the naive fixed-threshold detection applied.
```json
[
  {
    "id": 1,
    "range_m": 4210.5,
    "azimuth_deg": 132.4,
    "doppler_velocity": -85.2,
    "rcs": 22.1,
    "snr_db": 27.3,
    "x": 312.0,
    "y": 208.5,
    "true_label": "plane",
    "detected": true
  }
]
```

### `GET /api/detections/fused`
Same targets, with ML classification, anomaly score, and fusion confidence added.
```json
[
  {
    "id": 7,
    "range_m": 3100.2,
    "azimuth_deg": 45.9,
    "doppler_velocity": 12.4,
    "rcs": 0.12,
    "snr_db": 4.5,
    "sensor_2_snr_db": 13.2,
    "sensor_3_snr_db": 11.8,
    "x": 220.1,
    "y": 190.7,
    "true_label": "drone",
    "predicted_class": "drone",
    "anomaly_score": 0.81,
    "fusion_confidence": 0.74,
    "fused_detected": true,
    "baseline_detected": false
  }
]
```

### `POST /api/explain`
Request:
```json
{ "id": 7, "class": "drone", "anomaly_score": 0.81, "rcs": 0.12, "snr_db": 4.5 }
```
Response:
```json
{ "report": "Low-RCS contact classified as a drone at bearing 046, near the sensor noise floor on the primary receiver but confirmed via fused secondary sensors. Recommend visual/operator confirmation." }
```

### Error handling
| Scenario | Response |
|---|---|
| `/api/explain` called with unknown `id` | `404 {"error": "detection not found"}` |
| Claude API call fails/times out | `200` with a pre-written fallback report string + `"fallback": true` flag, so the UI never shows a broken state live |
| Malformed request body | `422` (FastAPI default validation error) |

## 7. Frontend Architecture
- **Single HTML file** (or `index.html` + `app.js` + `style.css` if you prefer separation — either is fine for this scope).
- **State:** two arrays in memory (`baselineDetections`, `fusedDetections`), refreshed on each poll.
- **Rendering loop:** `requestAnimationFrame` drives the sweep line rotation independent of the poll cycle; blip opacity/visibility is a function of "has the sweep passed this azimuth in the current rotation."
- **Click handling:** canvas click → nearest-blip hit-test by distance to `(x,y)` → open side panel with that detection's data → "Explain" button fires the POST.

## 8. Backend Architecture (suggested file structure)
```
backend/
  main.py           # FastAPI app, route definitions
  generator.py       # synthetic data generation (Data Ingestion Doc)
  models.py           # RandomForest + IsolationForest training & inference
  fusion.py           # fusion confidence scoring
  explain.py          # Claude API wrapper + fallback report
  schemas.py          # Pydantic request/response models (mirrors §6 contract)
```

## 9. Non-Functional Requirements
| Requirement | Target |
|---|---|
| Model training time (startup) | < 2 seconds total |
| API response time (`/detections/*`) | < 200ms (served from precomputed in-memory state) |
| `/api/explain` response time | < 3 seconds (single Claude call, low token count) |
| Frontend frame rate | Smooth enough visually — exact FPS not critical, avoid obviously janky animation |
| Reproducibility | Same seed → same detection set every run (critical for rehearsal) |

## 10. Security & Privacy Notes
- No PII, no real network/radar data — entirely synthetic, so no data privacy concerns.
- Claude API key handled server-side only (FastAPI backend), never exposed to the frontend/browser.
- No auth needed for v1 (single-session, local/demo-network use only) — explicitly noted as out of scope, not an oversight.

## 11. Error Handling & Edge Cases to Test
- What happens if the frontend polls before the backend has finished training models at startup? → Backend should block/return 503 briefly, or better: train synchronously before the server starts accepting requests (simplest for a demo).
- What if a user clicks rapidly on multiple blips before an explain response returns? → Disable the Explain button while a request is in-flight, or queue/cancel previous requests.
- What if all targets happen to be "detected" by baseline (bad luck on regeneration)? → This is why the seed is fixed — verify manually once, don't regenerate live.

## 12. Deployment / Run Instructions (for the demo laptop)
```bash
# Backend
cd backend
pip install fastapi uvicorn scikit-learn numpy pandas anthropic
uvicorn main:app --reload --port 8000

# Frontend
# just open index.html directly in the browser, or serve via:
python -m http.server 5500
```
Set the Claude API key as an environment variable before starting the backend (`ANTHROPIC_API_KEY`), never hardcoded in source.

## 13. Minute-by-Minute Build Plan
See the consolidated plan document / BRD Timeline — reproduced here for architecture-doc completeness:

| Time | You (Backend/ML) | Sid (Frontend) |
|---|---|---|
| 0–5 | Lock API contract (§6) together | Same |
| 5–10 | Scaffold FastAPI + generator | Scaffold canvas + sweep UI against mock JSON matching §6 |
| 10–25 | Train models, wire `/detections/*` endpoints | Build blip rendering, dual panels |
| 25–35 | Wire `/api/explain` + Claude call + fallback | Build click → side panel → explain button |
| 35–45 | Integration: swap mock for real fetch calls, together | Same |
| 45–50 | Polish, verify seed produces the key demo moment | Polish visuals |
| 50–55 | Buffer / bug bash | Buffer / bug bash |

## 14. Future Architecture (v2, not for this build)
- Replace synthetic generator with a real (or realistic public) radar/IQ dataset.
- Real Kalman-filter-based tracking across sweep frames instead of linear extrapolation.
- WebSocket-based push instead of polling, for lower latency at scale.
- Multi-session support with persistence (DB) if this became a real tool rather than a demo.
