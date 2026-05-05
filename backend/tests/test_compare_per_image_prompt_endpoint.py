"""compare-analyze per-image t2i prompt endpoint (Task 12).

POST /api/studio/compare-analyze/per-image-prompt — 단일 JSON 응답 (non-SSE).
- on-demand 호출: 메인 분석 후 사용자 클릭 시 observation JSON → 5 슬롯 prompt 합성.
- gpu_slot('compare-per-image-prompt') + GpuBusyError → 503 + code=gpu_busy.

3 케이스:
  1) 정상 — synthesize_prompt mock → 200 + positive_prompt 반환
  2) 빈 observation → 400 또는 422
  3) GPU busy → 503 + code='gpu_busy'
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app


def test_per_image_prompt_endpoint_success() -> None:
    """정상 호출 → 200 + 5 슬롯 + positive_prompt 정상 반환."""
    fake_synth = {
        "summary": "Portrait of a person",
        "positive_prompt": "professional studio portrait...",
        "negative_prompt": "blurry, low quality",
        "key_visual_anchors": ["studio", "soft lighting"],
        "uncertain": [],
    }

    client = TestClient(app)
    with patch(
        "studio.routes.compare.synthesize_prompt",
        new=AsyncMock(return_value=fake_synth),
    ):
        res = client.post(
            "/api/studio/compare-analyze/per-image-prompt",
            json={
                "observation": {
                    "subjects": [{"broad_visible_appearance": "young adult"}]
                },
                "ollamaModel": "gemma4-un:latest",
            },
        )

    assert res.status_code == 200, res.text
    data = res.json()
    assert "positive_prompt" in data
    assert data["positive_prompt"].startswith("professional")
    assert data["summary"] == "Portrait of a person"
    assert data["key_visual_anchors"] == ["studio", "soft lighting"]


def test_per_image_prompt_endpoint_rejects_empty_observation() -> None:
    """빈 observation → 400 또는 422."""
    client = TestClient(app)
    res = client.post(
        "/api/studio/compare-analyze/per-image-prompt",
        json={"observation": {}},
    )
    assert res.status_code in (400, 422)


def test_per_image_prompt_endpoint_busy_returns_503() -> None:
    """gpu_slot busy → 503 + code='gpu_busy'."""
    from studio._gpu_lock import GpuBusyError

    client = TestClient(app)
    with patch(
        "studio.routes.compare.synthesize_prompt",
        new=AsyncMock(side_effect=GpuBusyError("compare-per-image-prompt")),
    ):
        res = client.post(
            "/api/studio/compare-analyze/per-image-prompt",
            json={
                "observation": {
                    "subjects": [{"broad_visible_appearance": "x"}]
                }
            },
        )

    assert res.status_code == 503
    body = res.json()
    detail = body.get("detail", {})
    if isinstance(detail, dict):
        assert detail.get("code") == "gpu_busy"
    else:
        # 옛 string detail fallback (응답 형식이 unwrap 됐을 경우)
        assert "gpu" in str(body).lower()
