"""Synthetic radar target generation (Data Ingestion Doc).

All data is generated in-process, seeded, once at startup. No external
datasets. The stealth-injection pass (§5) is what creates the demo's key
moment: targets near the noise floor on the primary sensor but visible to
the fused multi-sensor score.
"""
import numpy as np
import pandas as pd

SEED = 42

# Canvas geometry — backend owns all trig (contract: 600x600, centered).
CANVAS_SIZE = 600
CENTER_PX = CANVAS_SIZE / 2
DRAW_RADIUS_PX = 280.0  # leave a margin inside the 300px half-width
MAX_RANGE_M = 8000.0
MIN_RANGE_M = 500.0

# Class-wise generation profiles (Data Ingestion Doc §4).
# rcs in m^2, snr in dB, doppler magnitude in m/s.
CLASS_PROFILES = {
    "plane":   {"rcs": (20.0, 50.0),   "snr": (25.0, 40.0), "doppler": (150.0, 300.0)},
    "vehicle": {"rcs": (5.0, 15.0),    "snr": (18.0, 30.0), "doppler": (0.0, 30.0)},
    "bird":    {"rcs": (0.01, 0.05),   "snr": (10.0, 20.0), "doppler": (2.0, 25.0)},
    "drone":   {"rcs": (0.05, 0.5),    "snr": (12.0, 22.0), "doppler": (0.0, 15.0)},
    "clutter": {"rcs": (0.05, 5.0),    "snr": (5.0, 15.0),  "doppler": (0.0, 50.0)},
}

NORMAL_PER_CLASS = 8          # 5 classes x 8 = 40 normal targets
STEALTH_LABELS = ["drone", "drone", "drone", "drone", "plane", "plane"]  # 6 injected
STEALTH_SNR_RANGE = (2.0, 8.0)        # primary sensor: near/at the noise floor
STEALTH_SECONDARY_RANGE = (12.0, 18.0)  # sensors 2/3 see it more clearly
SENSOR_NOISE_STD = 2.0                # normal targets: sensors 2/3 = snr + N(0, std)
SNR_FLOOR_DB = 1.0                    # validation: clip to a realistic floor

# The fused mean-SNR must clear this for the injected targets so the
# "missed by baseline, caught by fusion" moment is guaranteed, not lucky.
STEALTH_MIN_FUSED_MEAN_DB = 10.5


def _polar_to_canvas(range_m: np.ndarray, azimuth_deg: np.ndarray):
    """Convert range/azimuth to canvas pixels. North = up, azimuth clockwise."""
    r_px = (range_m / MAX_RANGE_M) * DRAW_RADIUS_PX
    az_rad = np.deg2rad(azimuth_deg)
    x = CENTER_PX + r_px * np.sin(az_rad)
    y = CENTER_PX - r_px * np.cos(az_rad)
    return x, y


def _generate_normal_targets() -> list[dict]:
    rows = []
    for label, profile in CLASS_PROFILES.items():
        for _ in range(NORMAL_PER_CLASS):
            snr = np.random.uniform(*profile["snr"])
            doppler_mag = np.random.uniform(*profile["doppler"])
            rows.append({
                "range_m": np.random.uniform(MIN_RANGE_M, MAX_RANGE_M),
                "azimuth_deg": np.random.uniform(0.0, 359.9),
                "doppler_velocity": doppler_mag * np.random.choice([-1.0, 1.0]),
                "rcs": np.random.uniform(*profile["rcs"]),
                "snr_db": snr,
                # Independent noise draws per receiver (Data Ingestion Doc §6).
                "sensor_2_snr_db": snr + np.random.normal(0.0, SENSOR_NOISE_STD),
                "sensor_3_snr_db": snr + np.random.normal(0.0, SENSOR_NOISE_STD),
                "true_label": label,
                "is_stealth": False,
            })
    return rows


def _generate_stealth_targets() -> list[dict]:
    """Low-observable injection (Data Ingestion Doc §5).

    Primary SNR forced to the noise floor; sensors 2/3 redrawn from a higher
    range (angle-dependent RCS justification). Redraw until the 3-sensor mean
    clears the recovery threshold so the demo moment can never silently break.
    """
    rows = []
    for label in STEALTH_LABELS:
        profile = CLASS_PROFILES[label]
        while True:
            snr = np.random.uniform(*STEALTH_SNR_RANGE)
            s2 = np.random.uniform(*STEALTH_SECONDARY_RANGE)
            s3 = np.random.uniform(*STEALTH_SECONDARY_RANGE)
            if (snr + s2 + s3) / 3.0 >= STEALTH_MIN_FUSED_MEAN_DB:
                break
        doppler_mag = np.random.uniform(*profile["doppler"])
        rows.append({
            "range_m": np.random.uniform(MIN_RANGE_M, MAX_RANGE_M),
            "azimuth_deg": np.random.uniform(0.0, 359.9),
            "doppler_velocity": doppler_mag * np.random.choice([-1.0, 1.0]),
            # Stealthy end of the class's RCS range.
            "rcs": np.random.uniform(profile["rcs"][0], profile["rcs"][0] * 3),
            "snr_db": snr,
            "sensor_2_snr_db": s2,
            "sensor_3_snr_db": s3,
            "true_label": label,
            "is_stealth": True,
        })
    return rows


def generate_targets() -> pd.DataFrame:
    """Full pipeline (Data Ingestion Doc §9): generate → inject → validate."""
    np.random.seed(SEED)

    rows = _generate_normal_targets() + _generate_stealth_targets()
    df = pd.DataFrame(rows)
    df.insert(0, "id", range(1, len(df) + 1))

    # Validation rules (§8).
    df["rcs"] = df["rcs"].clip(lower=0.01)
    df["azimuth_deg"] = df["azimuth_deg"] % 360.0
    for col in ("snr_db", "sensor_2_snr_db", "sensor_3_snr_db"):
        df[col] = df[col].clip(lower=SNR_FLOOR_DB)
    assert df["true_label"].isin(CLASS_PROFILES.keys()).all()

    # Backend owns the trig — frontend renders (x, y) directly.
    df["x"], df["y"] = _polar_to_canvas(df["range_m"].values, df["azimuth_deg"].values)

    return df
