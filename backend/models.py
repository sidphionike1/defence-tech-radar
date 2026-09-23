"""ML layer (ML Doc §3–§4): RandomForest classification + IsolationForest anomaly scoring.

Both models train in milliseconds on the ~46-row synthetic set, at startup,
and live in process memory — no persistence, no per-request retraining.
"""
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier

FEATURES = [
    "range_m",
    "doppler_velocity",
    "rcs",
    "snr_db",
    "sensor_2_snr_db",
    "sensor_3_snr_db",
]


def train_and_score(df: pd.DataFrame) -> tuple[pd.DataFrame, RandomForestClassifier]:
    """Fit both models on the full set and add predicted_class + anomaly_score.

    Trained and evaluated on the same synthetic distribution — an accepted,
    explicit v1 limitation (ML Doc §10).
    """
    X = df[FEATURES]
    y = df["true_label"]

    clf = RandomForestClassifier(n_estimators=100, random_state=42)
    clf.fit(X, y)

    iso = IsolationForest(contamination=0.15, random_state=42)
    iso.fit(X)

    df = df.copy()
    df["predicted_class"] = clf.predict(X)

    # decision_function: more negative = more anomalous. Min-max normalize
    # to 0-1 so higher anomaly_score = more anomalous (ML Doc §4).
    raw = -iso.decision_function(X)
    df["anomaly_score"] = (raw - raw.min()) / (raw.max() - raw.min())

    return df, clf
