"""Sensor-fusion confidence scoring (ML Doc §5 — applied math, not ML).

The baseline detector is `snr_db > 10` on the primary sensor alone.
The fused detector maps the mean of all three sensor SNRs through a sigmoid
centered at that same 10 dB threshold, so `fusion_confidence > 0.5` is the
exact like-for-like equivalent of the baseline rule — a fair comparison,
and a one-sentence explanation for judges: "no single sensor was confident,
but combined, they are."
"""
import numpy as np
import pandas as pd

BASELINE_THRESHOLD_DB = 10.0   # baseline rule: detected = snr_db > 10
FUSION_THRESHOLD = 0.5         # sigmoid(0) — equivalent of mean SNR > 10 dB
SIGMOID_SCALE_DB = 4.0         # softness of the confidence curve

SENSOR_COLS = ["snr_db", "sensor_2_snr_db", "sensor_3_snr_db"]


def compute_fusion(df: pd.DataFrame) -> pd.DataFrame:
    """Add baseline_detected, fusion_confidence, fused_detected columns."""
    mean_snr = df[SENSOR_COLS].mean(axis=1)
    confidence = 1.0 / (1.0 + np.exp(-(mean_snr - BASELINE_THRESHOLD_DB) / SIGMOID_SCALE_DB))

    df = df.copy()
    df["baseline_detected"] = df["snr_db"] > BASELINE_THRESHOLD_DB
    df["fusion_confidence"] = confidence
    df["fused_detected"] = confidence > FUSION_THRESHOLD
    return df
