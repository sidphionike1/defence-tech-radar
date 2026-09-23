# ML Document
## Low-Observable Target Radar — Sensor Fusion + ML Detection System, v1

---

## 1. Objective & ML Problem Framing
This system combines **three distinct techniques**, each solving a different piece of the detection problem:

1. **Supervised multi-class classification** — "what is this target?" (drone/bird/plane/vehicle/clutter)
2. **Unsupervised anomaly detection** — "does this reading look statistically unusual?" independent of class labels
3. **Sensor fusion (non-ML, applied math)** — "when I combine multiple imperfect sensor readings, does confidence cross the detection threshold even though any single sensor alone would not?"

The combination of these three — rather than a single classifier — is the actual technical story: it mirrors how real counter-stealth systems work (multiple independent, imperfect signals combined statistically beat any single high-precision sensor working alone).

## 2. Feature Engineering

| Feature | Used by | Notes |
|---|---|---|
| `range_m` | RF, IsoForest | Distance — larger range generally correlates with lower SNR |
| `doppler_velocity` | RF, IsoForest | Helps distinguish plane (fast, steady) from bird/drone (slow, erratic) |
| `rcs` | RF, IsoForest | The single strongest class-discriminating feature |
| `snr_db` | RF, IsoForest, baseline detector | Primary-sensor detectability |
| `sensor_2_snr_db` | RF, IsoForest, fusion score | Secondary receiver's independent read |
| `sensor_3_snr_db` | RF, IsoForest, fusion score | Tertiary receiver's independent read |

- No categorical encoding needed — all features are already numeric.
- No scaling/normalization strictly required for tree-based models (RandomForest, IsolationForest are scale-invariant), which is one reason these algorithms were chosen over e.g. SVM or k-NN — one less pipeline step under time pressure.

## 3. Model 1 — RandomForestClassifier (target classification)

- **Why RandomForest:** robust to small/noisy datasets, trains in milliseconds, requires no feature scaling, and produces feature-importance output you can show a judge if asked "how does it decide" (e.g., "RCS and SNR were the top two features, as expected physically").
- **Hyperparameters:** `n_estimators=100`, default max_depth (let it grow — dataset is small enough that overfitting risk is low and irrelevant for a live demo), `random_state=42` for reproducibility.
- **Training procedure:**
  1. Load the generated DataFrame (Data Ingestion Doc §9).
  2. `X = df[[range_m, doppler_velocity, rcs, snr_db, sensor_2_snr_db, sensor_3_snr_db]]`, `y = df[true_label]`.
  3. Fit on the full set (see §10 for the honest limitation of not doing a held-out split).
  4. Store the fitted model in memory for the FastAPI process lifetime.
- **Inference:** `predict()` for the class label, `predict_proba()` optionally exposed if you want a confidence number in the UI.

## 4. Model 2 — IsolationForest (anomaly scoring)

- **Why IsolationForest:** unsupervised, so it doesn't need labels to flag "this reading looks statistically unusual" — this is important because in a real deployment you wouldn't always have labeled examples of every possible anomaly type in advance.
- **Hyperparameters:** `contamination=0.15` (expect roughly 15% of the set to be anomalous — tuned to match the proportion of injected stealth targets, `random_state=42`).
- **Output:** `decision_function()` gives a continuous anomaly score; more negative = more anomalous. Normalize to a 0–1 `anomaly_score` for display (e.g., min-max scale across the current set).
- **Role in the demo:** gives a second, independent signal alongside classification — a target can be BOTH classified as "drone" AND flagged as anomalous, which is a stronger, more layered story than classification alone.

## 5. Fusion Confidence Scoring (applied math, not ML)

- **Formula (simple, explainable):**
  ```
  fusion_confidence = weighted_avg(snr_db, sensor_2_snr_db, sensor_3_snr_db) normalized to 0-1
  ```
  A simple unweighted mean is defensible and easiest to explain live; if you want a slightly more sophisticated version:
  ```
  p_i = normalized detection probability from sensor i (e.g., sigmoid over SNR)
  fusion_confidence = 1 - (1-p_1)(1-p_2)(1-p_3)   # "probability at least one sensor detects it" style combination
  ```
- **Detection rule:** `fused_detected = fusion_confidence > baseline_threshold_equivalent` (choose the equivalent-normalized threshold so it's a fair, like-for-like comparison against the baseline's `snr_db > 10` rule).
- **Why this matters more than it looks:** this is the actual mechanism by which a target invisible to the baseline becomes visible to the fused system — it is the single most important number in the whole demo, and the easiest one to explain to a non-technical judge in one sentence: *"no single sensor was confident, but combined, they are."*

## 6. Training Pipeline (step by step)
```
1. Generate synthetic data (seeded) — Data Ingestion Doc
2. Split into X (features) / y (true_label)
3. Fit RandomForestClassifier(n_estimators=100, random_state=42)
4. Fit IsolationForest(contamination=0.15, random_state=42)
5. Compute fusion_confidence per row (vectorized, pandas)
6. Compute baseline_detected (snr_db > 10) and fused_detected (fusion_confidence > threshold) per row
7. Store trained models + the fully-scored DataFrame in memory
8. Serve via FastAPI endpoints (Design Doc §6)
```
Total expected wall-clock time: well under 2 seconds on any laptop — this is not a bottleneck for your build window.

## 7. Evaluation Strategy & Metrics
Even without a rigorous held-out test set (see §10), you can and should compute and be ready to state:
- **Overall classification accuracy** on the training set (acceptable to caveat as "trained and evaluated on the same synthetic distribution — see limitations").
- **Confusion matrix**, specifically checking bird-vs-drone confusion, since that's the physically realistic hard boundary (§4 of Data Ingestion Doc).
- **The single most important number for this demo:** recall on the injected "stealth" subset — i.e., of the 5–8 low-observable targets, how many does `fused_detected` catch vs. how many `baseline_detected` catches. This should be a stark, visually obvious difference (aim for baseline recall near 0% on this subset, fusion recall near 100%) — if it's not stark, adjust the injection parameters (Data Ingestion Doc §5) until it is, since this comparison IS the entire demo.

## 8. Explainability Layer (Claude API)
- **Trigger:** on-click only, never on a timer (Design Doc §3.4, §9 — latency/cost control).
- **Prompt template:**
  > "You are a radar operator's assistant. A target was detected with: class={predicted_class}, anomaly_score={anomaly_score}, RCS={rcs} m², SNR={snr_db} dB. Write a 2-sentence plain-English situation report as it would appear on a tactical display. Be concise and factual."
- **Model/params:** `claude-sonnet-4-6`, `max_tokens: 150` — short output keeps latency low and is all that's needed for a "situation report" tone.
- **Fallback:** if the API call fails or times out, return a pre-written static report string with a `fallback: true` flag rather than surfacing an error state during the live demo (Design Doc §6, error handling table).

## 9. Model Serving Integration
- Models are trained once at backend startup and held in memory for the process lifetime — no per-request retraining, no model persistence/loading needed (avoids pickle/joblib complexity that isn't necessary at this scale).
- `/api/detections/fused` serves precomputed scores from the in-memory DataFrame — computation happens once at startup, not per-request, keeping API latency near-zero.

## 10. Limitations of the v1 ML Approach (be upfront about these if asked)
- **No held-out test set / cross-validation** — the classifier is trained and evaluated on the same synthetic distribution. This is an accepted, explicit trade-off for a same-day build; it means "accuracy" numbers demonstrate the model *can learn the pattern*, not that it generalizes to unseen real-world data.
- **Synthetic data only** — class profiles (§4 of Data Ingestion Doc) are physics-informed approximations, not calibrated against real radar measurements.
- **Simplified fusion model** — real multistatic radar fusion involves geometry, timing, and angle-dependent RCS variation; this implementation uses independent-noise approximations for buildability within the time constraint.
- **Static dataset per session** — no online/incremental learning, no live data stream.
- These limitations are explicitly acceptable for a 50-minute hackathon build and are worth stating proactively to judges — it signals technical maturity rather than overclaiming.

## 11. Future ML Roadmap (v2, not for this build)
- Proper train/validation/test split with cross-validation for statistically defensible accuracy claims.
- Real trajectory tracking (Kalman filter or a small LSTM) across sweep frames instead of static per-session detections.
- Geometry-aware multistatic fusion modeling (actual angle-dependent RCS, not independent-noise approximation).
- Training on/validating against real or realistic public radar/ADS-B datasets.
- Active learning loop where operator feedback (confirm/reject a detection) retrains the model incrementally.
