"""Claude explain layer (ML Doc §8): on-demand only, with a hardcoded fallback.

The fallback exists so the UI never shows a broken state during the live
demo, even if venue WiFi or the API fails (Design Doc §6 error table).
"""
import os

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 150
TIMEOUT_S = 10.0

FALLBACK_REPORT = (
    "Low-RCS contact near the primary sensor noise floor, confirmed via fused "
    "secondary receivers and classified by the onboard model. Signature is "
    "consistent with a small low-observable airframe. Recommend visual or "
    "operator confirmation before escalation."
)

PROMPT_TEMPLATE = (
    "You are a radar operator's assistant. A target was detected with: "
    "class={target_class}, anomaly_score={anomaly_score}, RCS={rcs} m², "
    "SNR={snr_db} dB. Write a 2-sentence plain-English situation report as it "
    "would appear on a tactical display. Be concise and factual."
)

_client = None


def _get_client():
    global _client
    if _client is None:
        from anthropic import Anthropic
        # Key comes from ANTHROPIC_API_KEY env var — never hardcoded.
        _client = Anthropic(timeout=TIMEOUT_S)
    return _client


def generate_report(target_class: str, anomaly_score: float, rcs: float, snr_db: float) -> tuple[str, bool]:
    """Return (report, fallback_used). Never raises — the demo must not break."""
    prompt = PROMPT_TEMPLATE.format(
        target_class=target_class,
        anomaly_score=round(anomaly_score, 2),
        rcs=round(rcs, 3),
        snr_db=round(snr_db, 1),
    )
    try:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            return FALLBACK_REPORT, True
        message = _get_client().messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text.strip(), False
    except Exception:
        return FALLBACK_REPORT, True
