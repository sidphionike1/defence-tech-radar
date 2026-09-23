# Business Requirements Document (BRD)
## Low-Observable Target Radar — Sensor Fusion + ML Detection System, v1

**Document control:** v1.0 | Build Day, Fable 5.1, Mumbai | Owners: [Your Name], Sid, Shubhangi

---

## 1. Executive Summary
Conventional radar and sensor systems rely on a fixed detection threshold applied to a single receiver's signal-to-noise ratio (SNR). This works for high-signature targets (large aircraft, vehicles) but systematically **fails on low radar-cross-section (RCS) targets** — small drones, stealth-shaped aircraft, or any object engineered/positioned to sit near the noise floor. This project builds a working demonstration of the real-world counter-technique — **multistatic sensor fusion combined with machine learning classification** — that catches targets a single-threshold system misses, and layers an LLM-generated plain-English situation report on top for human interpretability.

## 2. Business Context & Motivation
- Low-observable (stealth) target detection is a live, well-documented problem in air-defense, airport perimeter security, and counter-drone systems.
- The core insight — that combining multiple imperfect/noisy signals statistically outperforms any single high-threshold sensor — is not unique to radar. The same principle underlies fraud detection, network intrusion detection, and IoT anomaly monitoring, which makes this a technically generalizable story, not a narrow defense demo.
- For a hackathon audience, this combination (real physics-grounded problem + classic ML + LLM explainability layer) differentiates from generic "upload data, get a chatbot answer" projects.

## 3. Problem Statement
**Given** a fixed-threshold detector monitoring a single radar/sensor feed, **some real targets** (especially small drones and low-RCS aircraft) **will not be detected**, creating a security/safety blind spot. **We need** a system that demonstrates, live and visually, how combining multiple weak signals + ML classification recovers these missed detections.

## 4. Goals & Objectives

### 4.1 Business goals
- Demonstrate a technically credible, physics-grounded application of ML beyond a plain LLM wrapper.
- Deliver a fully working, visually compelling demo within a 50–55 minute build window.
- Leave judges with one clear, memorable takeaway: *"single threshold misses it, fusion + ML catches it."*

### 4.2 Product goals (v1)
- Simulate realistic multi-class radar returns (drone, bird, plane, vehicle, clutter).
- Run a baseline fixed-threshold detector alongside a fusion+ML detector, side by side.
- Visually and provably show the fusion+ML approach catching targets the baseline misses.
- Generate a natural-language situation report for any selected detection using Claude.

## 5. Stakeholders & Personas

| Stakeholder | Interest |
|---|---|
| Hackathon judges | Technical credibility, clarity of "wow moment," working live demo, ability to answer follow-up questions |
| You (backend/ML) | Build velocity, model correctness, API stability under demo conditions |
| Sid (frontend) | Visual clarity, animation smoothness, ability to work against a mock before integration |
| Shubhangi (docs/demo/QA) | A pitch that's easy to deliver in 90 seconds, a system she can test without writing code, confidence nothing breaks live |
| (Simulated) end user — radar/security operator | Not a real user for v1, but referenced as the "persona" the demo is designed for: someone who needs a fast, trustworthy, explainable alert, not raw numbers |

## 6. Scope

### 6.1 In scope (v1, this build)
- Fully synthetic data generation (no external dataset dependency).
- RandomForest classification of target type.
- IsolationForest + weighted sensor-fusion confidence scoring for anomaly/low-observable detection.
- Baseline fixed-threshold detector for comparison.
- Live-updating radar sweep UI with two side-by-side panels.
- Click-to-explain panel powered by the Claude API.
- Seeded, reproducible demo run.

### 6.2 Out of scope (v1)
- Real RF hardware / SDR (software-defined radio) integration.
- Real classified or proprietary defense datasets.
- Real-time streaming from an actual network/radar source.
- Authentication, multi-user support, persistence beyond the browser session.
- Formal statistical validation (train/test split rigor, cross-validation) — acceptable for a same-distribution synthetic demo, explicitly flagged as a v2 item (see ML Doc §10).
- Real trajectory prediction (Kalman filter) — linear extrapolation only, if time allows.

## 7. Success Metrics / KPIs

| Metric | Target for demo success |
|---|---|
| Working end-to-end pipeline (generate → classify → display → explain) | Must work live, no manual restarts needed |
| Stealth target caught by fusion but missed by baseline | At least 1 clearly visible instance within first 2 sweep rotations |
| Time to first "explain" response after click | Under ~3 seconds (keep `max_tokens` low, no continuous polling of Claude) |
| Judge comprehension | Judges can articulate what the demo showed without you re-explaining it |
| Build time | Core pipeline functional within 50 minutes; last 5 minutes is buffer only |

## 8. Assumptions
- Venue WiFi is stable enough for Claude API calls during the demo (test this early — have a cached fallback explanation string ready as a backup).
- $100 API credit is more than sufficient — this app makes at most a handful of Claude calls (one per "explain" click), not a call per sweep frame.
- Both devs are comfortable with Python + basic JS; no framework learning curve is introduced mid-build.

## 9. Constraints
- Hard 50–55 minute build window.
- Two coding laptops only (you + Sid); Shubhangi contributes without a machine.
- No internet-dependent external datasets — must be self-contained to avoid demo-day network risk.
- Must be rehearsable — outcomes should be deterministic (seeded), not left to random chance during the live pitch.

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Random seed doesn't reliably produce a visible "missed by baseline, caught by fusion" moment | Fix `np.random.seed(42)` and hand-verify at least one qualifying target exists in the generated set before demo |
| Claude API call is slow/fails live | Low `max_tokens`, and hardcode one fallback pre-written report string to show if the call errors |
| Integration (frontend ↔ backend) breaks late | Build frontend against a mock JSON matching the exact contract from minute 5, so integration is a data-source swap, not a rebuild |
| Scope creep (Kalman filter, CNN, real datasets) | Explicitly out-of-scope per §6.2 — resist mid-build additions |
| Judges ask "is this real stealth technology" | Be upfront: this is a physics-grounded simulation of the real technique (multistatic fusion), using synthetic data, not real defense-grade signal processing |

## 11. Comparable Real-World Systems (for judge Q&A credibility)
- **Passive/multistatic radar** — uses existing broadcast signals (FM/TV/cellular) as illuminators and multiple separated receivers to detect targets that evade single-transmitter systems.
- **Low-frequency (VHF/UHF) early-warning radar** — longer wavelengths interact with aircraft-scale structures differently than the higher frequencies stealth shaping is optimized against.
- **Infrared Search and Track (IRST)** — passive heat-signature detection, independent of RCS entirely.
- This project focuses on the **sensor-fusion + ML classification** piece of that broader picture, which is the most buildable-in-an-hour analog of the real technique.

## 12. Value Proposition / Cost-Benefit
- **Cost:** ~1 hour of two developers' time, minimal Claude API spend (a handful of short calls).
- **Benefit:** A demo that is (a) technically defensible under questioning, (b) visually self-explanatory, (c) generalizes the underlying technique to non-defense domains (fraud/network security), broadening its relevance to a wider judge panel.

## 13. Timeline (Hackathon-specific)
| Phase | Duration |
|---|---|
| Problem selection + docs | 20 min (already complete) |
| Build | 50–55 min (see Design Doc §13 for minute-by-minute) |
| Test | Folded into last 5–10 min buffer |
| Showcase | Per event schedule |

## 14. Sign-off
Approved for build by: You, Sid, Shubhangi — [timestamp at build start]
