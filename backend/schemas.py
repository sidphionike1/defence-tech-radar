"""Pydantic models mirroring the locked API contract (Design Doc §6)."""
from pydantic import BaseModel, Field


class BaselineDetection(BaseModel):
    id: int
    range_m: float
    azimuth_deg: float
    doppler_velocity: float
    rcs: float
    snr_db: float
    x: float
    y: float
    true_label: str
    detected: bool


class FusedDetection(BaseModel):
    id: int
    range_m: float
    azimuth_deg: float
    doppler_velocity: float
    rcs: float
    snr_db: float
    sensor_2_snr_db: float
    sensor_3_snr_db: float
    x: float
    y: float
    true_label: str
    predicted_class: str
    anomaly_score: float
    fusion_confidence: float
    fused_detected: bool
    baseline_detected: bool


class ExplainRequest(BaseModel):
    # "class" is a Python keyword, so expose it via alias per the contract.
    id: int
    target_class: str = Field(alias="class")
    anomaly_score: float
    rcs: float
    snr_db: float

    model_config = {"populate_by_name": True}


class ExplainResponse(BaseModel):
    report: str
    fallback: bool = False
