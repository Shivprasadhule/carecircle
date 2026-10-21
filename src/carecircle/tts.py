"""Optional AWS voice: Amazon Polly (Kajal) for English (India), Hindi and Hinglish.

Enabled only when CARECIRCLE_POLLY_ACCESS_KEY_ID / CARECIRCLE_POLLY_SECRET_ACCESS_KEY are set. Deliberately NOT the default
credential chain, so a stray ~/.aws profile for some other account is never used by accident. Without them the UI simply
uses the browser's own voices.
"""
from __future__ import annotations

import io
import os
from functools import lru_cache

# app language -> Polly LanguageCode. Kajal is bilingual (English India + Hindi); Hinglish is Roman script, so it uses her English setting.
POLLY_LANGS = {"en-IN": "en-IN", "hi-IN": "hi-IN", "hi-Latn": "en-IN"}
POLLY_VOICE = os.environ.get("CARECIRCLE_POLLY_VOICE", "Kajal")


def polly_configured() -> bool:
    return bool(os.environ.get("CARECIRCLE_POLLY_ACCESS_KEY_ID") and os.environ.get("CARECIRCLE_POLLY_SECRET_ACCESS_KEY"))


@lru_cache(maxsize=1)
def _polly_client():
    import boto3

    session = boto3.Session(
        aws_access_key_id=os.environ["CARECIRCLE_POLLY_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["CARECIRCLE_POLLY_SECRET_ACCESS_KEY"],
        aws_session_token=os.environ.get("CARECIRCLE_POLLY_SESSION_TOKEN") or None,
        region_name=os.environ.get("CARECIRCLE_POLLY_REGION") or os.environ.get("AWS_REGION", "ap-southeast-2"),
    )
    return session.client("polly")


def available_languages() -> list[str]:
    return list(POLLY_LANGS) if polly_configured() else []


def synthesize(text: str, lang: str, client=None) -> tuple[bytes, str]:
    """Return (mp3 bytes, media type). Tries the generative engine first, then neural.
    ValueError for bad input, RuntimeError when Polly is not configured or fails."""
    if lang not in POLLY_LANGS:
        raise ValueError(f"No server voice for language '{lang}'")
    text = " ".join(text.split())[:3000]
    if not text:
        raise ValueError("Nothing to say")
    if client is None:
        if not polly_configured():
            raise RuntimeError("Amazon Polly is not configured (set CARECIRCLE_POLLY_ACCESS_KEY_ID and CARECIRCLE_POLLY_SECRET_ACCESS_KEY)")
        client = _polly_client()
    engines = [os.environ["CARECIRCLE_POLLY_ENGINE"]] if os.environ.get("CARECIRCLE_POLLY_ENGINE") else ["generative", "neural"]
    last: Exception | None = None
    for engine in engines:
        try:
            r = client.synthesize_speech(Text=text, VoiceId=POLLY_VOICE, Engine=engine, LanguageCode=POLLY_LANGS[lang], OutputFormat="mp3")
            return r["AudioStream"].read(), "audio/mpeg"
        except Exception as e:  # noqa: BLE001 - engine/voice not offered in this region: try the next engine
            last = e
            if "ValidationException" not in type(e).__name__ and "ValidationException" not in str(e):
                raise
    raise RuntimeError(f"Polly could not speak this: {last}")
