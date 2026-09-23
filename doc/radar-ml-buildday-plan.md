# Low-Observable Target Radar — Build Day Plan (v1)
**Event:** Fable 5.1 Build Day, Mumbai | **Team:** You + Sid (build) + Shubhangi (docs/demo/QA) | **Window:** 50–55 min build

---

## 0. Team & Roles

| Person | Device | Role |
|---|---|---|
| You | Laptop 1 | **Backend + ML**: data generator, models, FastAPI, Claude explanation layer |
| Sid | Laptop 2 | **Frontend**: radar sweep canvas, blip rendering, live UI, polling/wiring |
| Shubhangi | No laptop | **Docs, QA, demo**: keeps time, tests via phone/browser once live, writes the 90-sec pitch, watches for bugs to report verbally, handles judge Q&A prep |

**Golden rule:** Agree on the API contract (Section 3.3) in the first 5 minutes, then work in parallel without blocking each other. Don't integrate until minute 35.

---

## 1. BRD — Business Requirements Doc

- **Why it matters:** Conventional threshold-based radar/sensor systems miss low-signal ("stealth-like") targets because a single fixed detection threshold can't distinguish a weak-but-real return from noise. This is a real, documented problem in air-defense and drone-detection systems.
- **Who cares:** Defense-tech, airport/drone-perimeter security, and any anomaly-detection-adjacent buyer (the underlying technique — multi-sensor fusion beating single-threshold detection — generalizes to network security, fraud detection, IoT monitoring).
- **Value metric for demo:** # of targets detected by our fusion+ML approach that a naive fixed-threshold detector misses, shown side-by-side, live.
- **Out of scope for v1:** real RF hardware, real classified data, live network/radar integration, authentication, persistence beyond the session.

---

## 2. PRD — Product Requirements Doc

- **Problem:** Naive radar/sensor detection uses a fixed signal threshold and misses low-RCS ("stealth-like") or noisy-but-real targets.
- **User:** Judge/demo viewer playing the role of a radar operator.
- **Core feature (ONE):** A live radar sweep showing simulated targets, where a **baseline threshold detector** misses some targets, but our **ML fusion + classification pipeline** catches them, classifies them (drone/bird/plane/clutter), and Claude generates a plain-English "situation report."
- **Secondary feature (only if ahead of schedule):** Smooth blip movement (simple linear/Kalman-lite tracking) so it feels alive, not static.
- **Success = demo shows:** sweep runs → normal targets appear on both panels → a low-RCS target appears ONLY on the "Fusion+ML" panel, not the "Conventional" panel → click it → classification label + Claude-generated alert text appears.

---

## 3. Architecture / Design Doc

### 3.1 System diagram
```
┌─────────────────────────┐
│ Data Generator (Python)  │  synthetic multi-sensor radar returns
│ numpy, seeded random     │  (normal targets + injected low-RCS targets)
└────────────┬─────────────┘
             │
┌────────────▼─────────────┐
│ FastAPI backend           │
│  - /detections (baseline) │  fixed-threshold filter
│  - /detections/fused      │  ML: fusion score + RandomForest class + IsolationForest anomaly
│  - /explain (POST)        │  → calls Claude API → plain-English report
└────────────┬─────────────┘
             │ JSON polled every ~1.5s
┌────────────▼─────────────┐
│ Frontend (HTML/Canvas/JS) │
│  - Radar sweep animation  │
│  - Two panels: Conventional vs Fusion+ML
│  - Click blip → explain panel
└───────────────────────────┘
```

### 3.2 Tech stack (final)
- **Backend:** Python, FastAPI, `uvicorn`
- **ML:** `scikit-learn` (RandomForestClassifier, IsolationForest), `numpy`, `pandas`
- **Data:** synthetic, generated in-process (no external dataset needed → zero download risk)
- **Frontend:** plain HTML + Canvas + vanilla JS (no React — avoids build tooling overhead in 50 min). `fetch()` polling, no websockets needed.
- **LLM layer:** Claude API (`claude-sonnet-4-6` or latest available), one call per "explain" click — NOT called continuously (saves credits + latency).
- **No auth, no DB** — everything in-memory for the session.

### 3.3 API contract (LOCK THIS IN MINUTE 0–5, before splitting up)

```
GET  /api/detections/baseline
  → [{id, range, azimuth, rcs, snr, doppler, x, y, detected: bool}]

GET  /api/detections/fused
  → [{id, range, azimuth, rcs, snr, doppler, x, y,
      detected: bool, class: "drone"|"bird"|"plane"|"vehicle"|"clutter",
      anomaly_score: float, fusion_confidence: float}]

POST /api/explain
  body: {id, class, anomaly_score, rcs, snr}
  → {report: string}   # Claude-generated 2-3 sentence situation report
```

`x, y` are pre-computed pixel/canvas coordinates (range+azimuth converted to Cartesian) so the **frontend never does trig** — backend owns that conversion. This is the single most important contract decision: it lets Sid build the entire UI against a mocked JSON file for the first 25 minutes without waiting on you.

---

## 4. Data Ingestion Doc

### 4.1 Source
100% synthetic — generated with `numpy` at backend startup. No external dataset, no internet dependency, fully deterministic with a fixed seed (`np.random.seed(42)`) so demo behavior is repeatable in rehearsal.

### 4.2 Schema (per detection/target)
| Field | Type | Range/Notes |
|---|---|---|
| `id` | int | unique |
| `range_m` | float | 500–8000 m |
| `azimuth_deg` | float | 0–359.9° |
| `doppler_velocity` | float | -300 to +300 m/s (negative = approaching) |
| `rcs` | float | radar cross-section, m². Normal targets: 1–50. "Stealth" injected targets: 0.01–0.3 |
| `snr_db` | float | signal-to-noise ratio. Normal: 15–40 dB. Stealth: 2–8 dB (near noise floor) |
| `sensor_2_snr_db` | float | second simulated receiver's SNR for the same target (independent noise) — this is what enables "fusion" |
| `sensor_3_snr_db` | float | third simulated receiver |
| `true_label` | string | ground truth: drone/bird/plane/vehicle/clutter (for training + scoring accuracy) |

### 4.3 Generation logic (give this directly to Claude Code)
- Generate ~40 "normal" targets with realistic RCS/SNR per class (planes: high RCS ~20–50; birds: low RCS ~0.01–0.05 but usually short/erratic doppler; drones: RCS ~0.05–0.5, our key "hard to detect" class; vehicles: ground clutter-adjacent).
- Inject 5–8 "low-observable" targets: plausible drone/plane profile but RCS/SNR deliberately near the noise floor (SNR 2–8 dB) on sensor 1, but with sensor_2/sensor_3 SNR that, when combined, pushes fused confidence above threshold.
- Baseline detector rule: `detected = sensor_1_snr_db > 10` (simple fixed threshold) — this is what will visibly MISS the injected stealth targets.
- Fusion score: e.g. `fusion_confidence = mean(snr_1, snr_2, snr_3) weighted, or 1 - (1-p1)(1-p2)(1-p3)` style probability combination — simple weighted average is fine and easy to explain live.

### 4.4 Train/test approach
No held-out test set needed for the demo — train RandomForest on all synthetic labeled data (it's your own generator, so "labels" are known perfectly). Optionally hold out 20% just to show an accuracy/confusion-matrix number if a judge asks "how do you know it works" — nice-to-have, not core path.

---

## 5. ML Doc

### 5.1 Models (all scikit-learn, train in <2 seconds each)

1. **RandomForestClassifier** — target classification
   - Features: `range_m, doppler_velocity, rcs, snr_db, sensor_2_snr_db, sensor_3_snr_db`
   - Labels: `drone, bird, plane, vehicle, clutter`
   - `n_estimators=100` is plenty; trains instantly on ~50 rows.

2. **IsolationForest** — anomaly scoring (unsupervised)
   - Same feature set, `contamination=0.15`
   - Used to give an `anomaly_score` independent of the classifier — nice second signal ("this doesn't just get classified as a drone, it's also flagged as statistically unusual").

3. **Fusion confidence (not really ML, just math — call it "sensor fusion")**
   - `fusion_confidence = weighted_avg(sensor_1_snr, sensor_2_snr, sensor_3_snr) normalized 0-1`
   - `fused_detected = fusion_confidence > baseline_threshold_equivalent`
   - This is the number that flips a "missed" baseline detection into a "caught" fusion detection — it's the heart of your demo narrative.

4. **(Stretch, only if time allows) Simple position smoothing**
   - Linear extrapolation between polls (`x_next = x + vx*dt`) is enough — do NOT attempt a real Kalman filter under time pressure, it's not worth the risk. Mention "Kalman-filter-style smoothing" in the pitch even if you use linear extrapolation; the visual effect is what matters.

### 5.2 Explainability layer (Claude API)
- Triggered only `on click`, not continuously (keeps it fast + saves credits).
- Prompt template:
  > "You are a radar operator's assistant. A target was detected with: class={class}, anomaly_score={score}, RCS={rcs} m², SNR={snr} dB. Write a 2-sentence plain-English situation report as it would appear on a tactical display. Be concise and factual."
- Keep `max_tokens: 150` — you don't need long output and it'll be faster.

---

## 6. Minute-by-Minute Plan (50–55 min)

| Time | You (Backend/ML) | Sid (Frontend) | Shubhangi |
|---|---|---|---|
| 0–5 | Together: lock API contract (Sec 3.3), agree field names exactly | Same | Writes down the contract as the "spec," starts the pitch doc skeleton |
| 5–10 | Claude Code prompt #1: scaffold FastAPI + data generator (Sec 4) | Claude Code prompt #2: scaffold radar sweep canvas UI against a **hardcoded mock JSON** matching the contract | Preps 3 "judge questions" you'll likely get, starts timing |
| 10–25 | Claude Code prompt #3: train RandomForest + IsolationForest, wire `/detections/baseline` and `/detections/fused` endpoints | Build blip rendering, sweep line animation, class-colored dots, two side-by-side panels (Conventional vs Fusion+ML) — still against mock data | Watches progress, flags anything confusing for a judge to follow |
| 25–35 | Claude Code prompt #4: `/api/explain` endpoint calling Claude API | Add click-to-explain panel UI (loading state → text box) | Starts drafting the 90-second demo script |
| 35–45 | **Integration:** swap Sid's mock JSON for real `fetch()` calls to your running backend. Fix field mismatches together. | Same — pair on this, it's the highest-risk step | Tests it live in browser, calls out anything broken in plain language |
| 45–50 | Polish: seed seed generator so a stealth target reliably appears within the first 2 sweeps (don't leave it to random luck on stage) | Polish: colors/labels legible from a distance, panel titles clear | Finalizes pitch script, rehearses once |
| 50–55 | Buffer / bug bash | Buffer / bug bash | Final timing check, confirms who says what on stage |

---

## 7. Ready-to-paste Claude Code Prompts

**Prompt 1 (You, backend scaffold):**
> Create a FastAPI backend in Python. Generate synthetic radar detection data using numpy with this schema: [paste Section 4.2 table]. Generate ~40 normal targets across classes drone/bird/plane/vehicle/clutter with realistic RCS/SNR ranges, plus 6 "low-observable" targets with SNR 2-8dB on sensor 1 but higher combined SNR across sensor_2 and sensor_3. Seed with np.random.seed(42). Expose GET /api/detections/baseline that applies a fixed threshold (sensor_1_snr_db > 10) and returns which targets are "detected". Precompute x,y pixel coordinates from range_m/azimuth_deg for a 600x600 canvas centered at origin. Return JSON matching this contract: [paste Section 3.3].

**Prompt 2 (Sid, frontend scaffold):**
> Create a single HTML file with an animated radar sweep using Canvas. Rotating sweep line from center, blips fade in at given x,y coordinates when the sweep passes them, colored by "class" field. Two side-by-side panels labeled "Conventional Threshold" and "Fusion + ML". Poll a mock local JSON object (I'll give you the real endpoint later) every 1.5 seconds and re-render. Clicking a blip shows a side panel with its details and a placeholder "Explain" button.

**Prompt 3 (You, ML training):**
> Add a `/api/detections/fused` endpoint. Train a RandomForestClassifier on the synthetic data (features: range_m, doppler_velocity, rcs, snr_db, sensor_2_snr_db, sensor_3_snr_db; label: true_label) to predict class. Train an IsolationForest (contamination=0.15) on the same features for anomaly_score. Compute fusion_confidence as a weighted average of the three sensor SNR values normalized 0-1, and mark fused_detected=true if fusion_confidence exceeds an equivalent threshold. Return this alongside class and anomaly_score in the JSON.

**Prompt 4 (You, explain endpoint):**
> Add a POST /api/explain endpoint that takes {id, class, anomaly_score, rcs, snr_db} and calls the Anthropic API (model claude-sonnet-4-6, max_tokens 150) with a prompt asking for a 2-sentence plain-English radar situation report. Return {report: string}.

---

## 8. 90-Second Demo Script (Shubhangi to finalize/deliver)

1. (10s) "Real radar systems use a fixed signal threshold — but stealth-designed or low-RCS targets like drones can sit right at the noise floor and get missed entirely."
2. (20s) Point at "Conventional" panel — sweep runs, normal targets appear. Point out a spot where nothing shows up on this panel.
3. (20s) Point at "Fusion+ML" panel — same moment, a blip IS there, classified, flagged anomalous.
4. (20s) Click it → Claude-generated situation report appears.
5. (20s) Close: "This mirrors real counter-stealth techniques — multistatic sensor fusion — combined with ML classification and an AI-generated operator report, built end-to-end in under an hour."

---

## 9. Risk Notes (read once before you start)
- **Don't** wait on integration — mock data in the frontend from minute 5 is what makes parallel work possible.
- **Don't** attempt a real Kalman filter or a CNN — both are time sinks with no payoff over the simpler alternatives above.
- **Do** hardcode/seed the RNG so the stealth target reliably shows up early in the sweep during the actual demo — don't leave your best moment to chance.
- **Do** call the Claude API only on click, not on a timer — keeps the app snappy and protects your credits.
