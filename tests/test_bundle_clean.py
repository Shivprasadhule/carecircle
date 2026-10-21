"""The shipped web bundle must not contain provider, model or region names (view-source and bundle searches included)."""
import re
from pathlib import Path

import pytest

DIST = Path(__file__).resolve().parents[1] / "web" / "dist"
FORBIDDEN = re.compile(r"claude|anthropic|bedrock|haiku|sonnet|strands|\bllm\b|polly|ap-southeast|us-east-1|arn:aws|AWS_BEARER", re.I)


@pytest.mark.skipif(not DIST.exists(), reason="run `npm run build` in web/ first")
def test_no_provider_names_anywhere_in_the_built_web_app():
    files = [DIST / "index.html", *DIST.glob("assets/*.js"), *DIST.glob("assets/*.css")]
    assert len(files) >= 3
    hits = {}
    for f in files:
        found = sorted({m.group(0).lower() for m in FORBIDDEN.finditer(f.read_text(errors="ignore"))})
        if found:
            hits[f.name] = found
    assert not hits, hits
