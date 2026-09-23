# Data Ingestion Document
## Low-Observable Target Radar — Sensor Fusion + ML Detection System, v1

---

## 1. Purpose & Scope
This document specifies exactly how data enters the system: its source, schema, generation logic, validation rules, and reproducibility guarantees. For v1, **all data is synthetic** — generated in-process at backend startup — to eliminate any external dependency or network risk during the live build and demo.

## 2. Data Source Overview
- **No external dataset is used.** This is a deliberate risk-reduction decision (see BRD §9, §10): downloading or cleaning a real dataset (e.g., NSL-KDD-style intrusion data, or a public radar/ADS-B dataset) introduces schema mismatches, license checks, and network dependency — all unacceptable risks inside a 50-minute window.
- Instead, `numpy`/`pandas` generate a small, fully labeled, physics-plausible synthetic dataset directly in the backend process.
- This also has a genuine technical benefit: since ground-truth labels are known exactly (we generated them), the classifier's "accuracy" numbers are trustworthy and explainable to judges without caveats about label noise.

## 3. Full Schema Definition

| Field | Type | Unit/Range | Description |
|---|---|---|---|
| `id` | int | unique, sequential | Target identifier |
| `range_m` | float | 500–8000 | Distance from radar origin, meters |
| `azimuth_deg` | float | 0.0–359.9 | Bearing angle, degrees |
| `doppler_velocity` | float | -300 to +300 m/s | Radial velocity; negative = approaching |
| `rcs` | float | 0.01–50 m² | Radar cross-section — the key "stealth" variable |
| `snr_db` | float | 2–40 dB | Signal-to-noise ratio on primary sensor |
| `sensor_2_snr_db` | float | independent noise draw | SNR as seen by a second, spatially separated simulated receiver |
| `sensor_3_snr_db` | float | independent noise draw | SNR as seen by a third simulated receiver |
| `true_label` | string | drone / bird / plane / vehicle / clutter | Ground truth class, known exactly since we generate it |
| `x`, `y` | float | canvas pixel coords | Precomputed Cartesian position for frontend rendering (backend owns trig conversion — see Design Doc §6) |

## 4. Class-wise Generation Profiles (grounded in real radar physics)

| Class | Typical RCS (m²) | Typical SNR (dB) | Doppler pattern | Rationale |
|---|---|---|---|---|
| **Plane** | 20–50 | 25–40 | Large magnitude, steady | Large metal airframes reflect strongly; steady cruise velocity |
| **Vehicle** | 5–15 | 18–30 | Low/near-zero, ground-adjacent | Smaller metal mass than aircraft, near-zero radial velocity relative to airborne radar |
| **Bird** | 0.01–0.05 | 10–20 | Erratic, low magnitude | Genuinely tiny RCS in reality; included specifically to test whether the classifier confuses birds with drones (a known real-world radar challenge — "bird vs. drone" misclassification is a documented problem in counter-drone systems) |
| **Drone** | 0.05–0.5 | varies — this is the class used for "low-observable" injection | Slow, hovering-capable, erratic | Deliberately overlaps RCS range with birds — the hardest real classification boundary, which makes it the most credible technical story |
| **Clutter** | random low-mid, no consistent pattern | 5–15 | Random/noisy | Ground clutter, weather returns, multipath — represents "noise" the classifier must learn to reject as `clutter` rather than a real target |

## 5. Stealth / Low-Observable Target Injection Logic
- Generate 5–8 targets explicitly labeled `drone` or `plane` but with:
  - `snr_db` (primary sensor) forced into 2–8 dB — near/at the noise floor.
  - `sensor_2_snr_db` and `sensor_3_snr_db` drawn from a *higher* independent range (roughly 10–18 dB) — simulating that a second/third receiver, at a different geometry, happens to see the target more clearly (this is physically realistic: RCS is angle-dependent, so a target "stealthy" from one receiver's angle is often not stealthy from another's).
- This is the crux of the entire demo: **baseline detector only looks at `snr_db`** (primary sensor) and will mark these `detected: false`. **The fusion score considers all three sensors** and will correctly flag them.

## 6. Multi-Sensor Simulation Logic
- `sensor_2_snr_db` and `sensor_3_snr_db` are generated as `snr_db + independent_gaussian_noise`, EXCEPT for the injected stealth targets, where they are deliberately redrawn from a higher-mean distribution (per §5) to create the fusion "recovery" effect.
- This keeps the simulation simple (no actual angle/geometry modeling needed) while still being a defensible simplification of a real multistatic radar setup when explaining it to judges.

## 7. Data Volume & Refresh Strategy
- **Volume:** ~46–48 total targets (40 normal + 6–8 stealth-injected) — enough to look populated on the radar display without being visually cluttered or slow to train on.
- **Refresh strategy for v1:** generated ONCE at backend startup, held statically in memory for the session. No live regeneration during the demo (this is intentional — see BRD Risk table, §10: reproducibility for rehearsal matters more than "live" data generation for this build).
- If time allows post-core-build, a "regenerate" endpoint could be added as a nice-to-have, but it is explicitly NOT required for v1 success.

## 8. Data Validation Rules
- `rcs > 0` always (physically, RCS cannot be zero or negative).
- `azimuth_deg` wrapped to `[0, 360)`.
- `snr_db` values clipped to a realistic floor (e.g., minimum 1 dB) to avoid nonsensical negative-noise edge cases.
- `true_label` must be one of the 5 defined classes — enforced by generating from a fixed class list, not free text.
- At generation time, assert at least 1 target satisfies `snr_db < 10 AND fusion_confidence > baseline_threshold_equivalent` — i.e., programmatically verify the "recovery" moment exists before the server finishes startup, so a bad random draw can never silently break the demo (even with a fixed seed, this assertion is cheap insurance).

## 9. Data Pipeline Flow
```
[Class profile tables, §4]
        │
        ▼
[numpy random generation, seeded]  ──►  [Stealth injection pass, §5]
        │
        ▼
[Multi-sensor noise simulation, §6]
        │
        ▼
[Validation assertions, §8]
        │
        ▼
[In-memory pandas DataFrame]  ──►  served to ML training (ML Doc) and API layer (Design Doc §6)
```

## 10. Reproducibility
- `np.random.seed(42)` set once at module load, before any generation calls.
- Because generation is fully deterministic given the seed, the exact same target set (including which ones qualify as "recovered by fusion") will appear on every run — critical for rehearsing the demo script multiple times before showcasing.
- **Action item before demo:** run the generator once ahead of time, manually confirm the assertion in §8 held, and note which `id` will be your "hero" stealth target to click during the live explain step.

## 11. Future Data Sources (v2, not for this build)
- Real public radar/ADS-B datasets for aircraft trajectories.
- Realistic multistatic geometry modeling (actual angle-dependent RCS variation) instead of simplified independent-noise sensors.
- Streaming/live data ingestion from an actual SDR (software-defined radio) receiver for a genuinely live radar feed.
- Larger labeled dataset with proper train/validation/test split for rigorous accuracy claims (see ML Doc §10 for current limitation).
