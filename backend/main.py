"""FastAPI app — Low-Observable Target Radar demo backend.

Everything (generation, training, scoring) happens synchronously at import
time, BEFORE uvicorn accepts requests, so the frontend's first poll can never
race a half-initialized model (Design Doc §11). Endpoints serve precomputed
in-memory state; the only live outbound call is /api/explain → Claude.

Run:  uvicorn main:app --reload --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import explain as explain_layer
from fusion import compute_fusion
from generator import generate_targets
from models import train_and_score
from schemas import BaselineDetection, ExplainRequest, ExplainResponse, FusedDetection

# ---- Startup pipeline (ML Doc §6): generate → fuse → train → hold in memory ----
_df = generate_targets()
_df = compute_fusion(_df)
_df, _classifier = train_and_score(_df)

# Startup assertion (Data Ingestion Doc §8): the demo's key moment MUST exist —
# at least one target near the noise floor that fusion catches and baseline misses.
_recovered = _df[(_df["snr_db"] < 10) & _df["fused_detected"] & ~_df["baseline_detected"]]
assert len(_recovered) >= 1, (
    "No 'missed by baseline, caught by fusion' target exists — demo moment broken. "
    "Check stealth injection parameters in generator.py."
)
print(
    f"[startup] {len(_df)} targets | "
    f"{len(_recovered)} recovered by fusion (hero ids: {_recovered['id'].tolist()})"
)

_ROUND = {
    "range_m": 1, "azimuth_deg": 1, "doppler_velocity": 1, "rcs": 3,
    "snr_db": 1, "sensor_2_snr_db": 1, "sensor_3_snr_db": 1,
    "x": 1, "y": 1, "anomaly_score": 3, "fusion_confidence": 3,
}
_records = _df.round(_ROUND).to_dict(orient="records")

BASELINE_FIELDS = [
    "id", "range_m", "azimuth_deg", "doppler_velocity", "rcs", "snr_db",
    "x", "y", "true_label",
]
FUSED_FIELDS = BASELINE_FIELDS + [
    "sensor_2_snr_db", "sensor_3_snr_db", "predicted_class",
    "anomaly_score", "fusion_confidence", "fused_detected", "baseline_detected",
]

app = FastAPI(title="Low-Observable Target Radar — Fusion + ML Backend")

# Frontend is served from a different origin (file:// or :5500) — allow it.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/detections/baseline", response_model=list[BaselineDetection])
def detections_baseline():
    return [
        {**{k: r[k] for k in BASELINE_FIELDS}, "detected": r["baseline_detected"]}
        for r in _records
    ]


@app.get("/api/detections/fused", response_model=list[FusedDetection])
def detections_fused():
    return [{k: r[k] for k in FUSED_FIELDS} for r in _records]


@app.post("/api/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest):
    if not (_df["id"] == req.id).any():
        # Contract-exact error body (Design Doc §6): {"error": "detection not found"}
        return JSONResponse(status_code=404, content={"error": "detection not found"})
    report, fallback = explain_layer.generate_report(
        target_class=req.target_class,
        anomaly_score=req.anomaly_score,
        rcs=req.rcs,
        snr_db=req.snr_db,
    )
    return ExplainResponse(report=report, fallback=fallback)
