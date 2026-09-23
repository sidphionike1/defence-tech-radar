"""Pre-demo verification (Data Ingestion Doc §10 action item).

Run once before rehearsal/demo: confirms the startup assertion held, prints
stealth-subset recall for baseline vs fusion, and names the hero target ids
to click during the live explain step.
"""
from sklearn.metrics import accuracy_score, confusion_matrix

import main


def run() -> None:
    df = main._df
    rec = main._recovered

    print("total targets:", len(df))
    print("label counts:", df["true_label"].value_counts().to_dict())
    print(
        "baseline detected:", int(df["baseline_detected"].sum()),
        "| fused detected:", int(df["fused_detected"].sum()),
    )

    stealth = df[df["is_stealth"]]
    print(
        "stealth subset — baseline recall:", f"{stealth['baseline_detected'].mean():.0%}",
        "| fused recall:", f"{stealth['fused_detected'].mean():.0%}",
    )
    print("train accuracy:", f"{accuracy_score(df['true_label'], df['predicted_class']):.1%}")

    labels = sorted(df["true_label"].unique())
    print("confusion matrix (rows=true, cols=pred):", labels)
    print(confusion_matrix(df["true_label"], df["predicted_class"], labels=labels))

    cols = [
        "id", "true_label", "predicted_class", "snr_db", "sensor_2_snr_db",
        "sensor_3_snr_db", "fusion_confidence", "anomaly_score",
    ]
    print("\nhero targets (missed by baseline, caught by fusion):")
    print(rec[cols].round(2).to_string(index=False))


if __name__ == "__main__":
    run()
