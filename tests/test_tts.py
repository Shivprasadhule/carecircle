import io

import pytest

from carecircle import tts


class FakePolly:
    """Stands in for boto3's polly client; can refuse the generative engine like some regions do."""

    def __init__(self, refuse=()):
        self.calls, self.refuse = [], set(refuse)

    def synthesize_speech(self, **kw):
        self.calls.append(kw)
        if kw["Engine"] in self.refuse:
            raise type("ValidationException", (Exception,), {})(f"{kw['Engine']} not supported")
        return {"AudioStream": io.BytesIO(b"ID3-fake-mp3")}


def test_polly_is_off_unless_explicitly_configured(monkeypatch):
    for k in ("CARECIRCLE_POLLY_ACCESS_KEY_ID", "CARECIRCLE_POLLY_SECRET_ACCESS_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAOTHERACCOUNT")          # the default AWS credential chain must NOT enable Polly
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "x")
    assert tts.polly_configured() is False
    assert tts.available_languages() == []
    with pytest.raises(RuntimeError, match="not configured"):
        tts.synthesize("hello", "en-IN")


def test_polly_covers_english_hindi_and_hinglish_only(monkeypatch):
    monkeypatch.setenv("CARECIRCLE_POLLY_ACCESS_KEY_ID", "AKIATEST")
    monkeypatch.setenv("CARECIRCLE_POLLY_SECRET_ACCESS_KEY", "secret")
    assert set(tts.available_languages()) == {"en-IN", "hi-IN", "hi-Latn"}


def test_request_uses_kajal_with_the_right_language_and_prefers_generative():
    fake = FakePolly()
    audio, media = tts.synthesize("नमस्कार आशा जी", "hi-IN", client=fake)
    assert media == "audio/mpeg" and audio.startswith(b"ID3")
    assert fake.calls[0] == {"Text": "नमस्कार आशा जी", "VoiceId": "Kajal", "Engine": "generative", "LanguageCode": "hi-IN", "OutputFormat": "mp3"}


def test_hinglish_is_spoken_with_kajals_indian_english_setting():
    fake = FakePolly()
    tts.synthesize("Aapne apni dawai li?", "hi-Latn", client=fake)
    assert fake.calls[0]["LanguageCode"] == "en-IN"


def test_falls_back_to_neural_when_generative_is_unavailable():
    fake = FakePolly(refuse={"generative"})
    tts.synthesize("Good morning", "en-IN", client=fake)
    assert [c["Engine"] for c in fake.calls] == ["generative", "neural"]


def test_rejects_unsupported_languages_and_empty_text():
    with pytest.raises(ValueError):
        tts.synthesize("வணக்கம்", "ta-IN", client=FakePolly())
    with pytest.raises(ValueError):
        tts.synthesize("   ", "hi-IN", client=FakePolly())


def test_reports_real_failures_instead_of_hiding_them():
    class Boom(FakePolly):
        def synthesize_speech(self, **kw):
            raise type("AccessDeniedException", (Exception,), {})("no permission")
    with pytest.raises(Exception, match="no permission"):
        tts.synthesize("hello", "en-IN", client=Boom())
