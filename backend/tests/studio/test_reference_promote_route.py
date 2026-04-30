"""POST /reference-templates/promote/{history_id} 통합 테스트 (v9 · Phase A.5).

Plan: docs/superpowers/plans/2026-04-29-reference-library-v9.md
"""

from __future__ import annotations

import io
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image


def _make_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (256, 256), color="green").save(buf, format="PNG")
    return buf.getvalue()


def _set_temp_db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    db_path = tmp_path / "test_history.db"
    monkeypatch.setattr("studio.history_db._config._DB_PATH", str(db_path))
    return db_path


@pytest.fixture
def tmp_pool_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    pool_dir = tmp_path / "reference-pool"
    pool_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("studio.reference_pool.POOL_DIR", pool_dir)
    return pool_dir


@pytest.fixture
def tmp_template_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Path:
    """영구 라이브러리 디렉토리 monkeypatch."""
    tpl_dir = tmp_path / "reference-templates"
    tpl_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr("studio.reference_storage.REFERENCE_DIR", tpl_dir)
    return tpl_dir


def _make_history_item(
    item_id: str,
    *,
    reference_ref: str | None = None,
    reference_role: str | None = None,
) -> dict:
    return {
        "id": item_id,
        "mode": "edit",
        "prompt": "test",
        "label": "test",
        "imageRef": f"/images/studio/result/{item_id}.png",
        "createdAt": int(time.time() * 1000),
        "referenceRef": reference_ref,
        "referenceRole": reference_role,
        "lightning": False,
    }


# ─────────────────────────────────────────────
# 정상 흐름
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_promote_from_history_swaps_reference_ref(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tmp_pool_dir: Path,
    tmp_template_dir: Path,
) -> None:
    """promote 성공 → 영구 URL 응답 + history.referenceRef swap (Codex I3)."""
    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    pool_ref = await save_to_pool(_make_png_bytes(), "image/png")
    await history_db.insert_item(
        _make_history_item("h1", reference_ref=pool_ref, reference_role="outfit")
    )

    with patch(
        "studio.routes.reference_templates.analyze_reference",
        new_callable=AsyncMock,
    ) as mock_v:
        mock_v.return_value = "test description"

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            resp = await ac.post(
                "/api/studio/reference-templates/promote/h1",
                json={"name": "내 셔츠"},
            )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    tpl = data["template"]
    assert tpl["name"] == "내 셔츠"
    assert tpl["imageRef"].startswith("/images/studio/reference-templates/")
    assert tpl["visionDescription"] == "test description"
    assert tpl["roleDefault"] == "outfit"
    assert data["visionFailed"] is False

    # history.referenceRef 가 영구 URL 로 swap
    item = await history_db.get_item("h1")
    assert item["referenceRef"] == tpl["imageRef"]
    assert item["referenceRef"].startswith("/images/studio/reference-templates/")


# ─────────────────────────────────────────────
# 에러 케이스
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_promote_invalid_history_404(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from main import app  # type: ignore
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/reference-templates/promote/nonexistent",
            json={"name": "x"},
        )

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_promote_history_without_pool_ref_400(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """referenceRef 가 NULL 인 history 는 promote 거부."""
    from main import app  # type: ignore
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()
    await history_db.insert_item(_make_history_item("h1", reference_ref=None))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/reference-templates/promote/h1",
            json={"name": "ok"},
        )

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_promote_permanent_ref_400(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """이미 영구 라이브러리 URL 인 history 는 promote 거부 (중복 방지)."""
    from main import app  # type: ignore
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()
    await history_db.insert_item(
        _make_history_item(
            "h1",
            reference_ref="/images/studio/reference-templates/already.png",
        )
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/reference-templates/promote/h1",
            json={"name": "ok"},
        )

    assert resp.status_code == 400


# ─────────────────────────────────────────────
# 이름 검증
# ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "invalid_name",
    [
        "",  # 빈 문자열
        "   ",  # 공백만 (strip 후 빈)
        "a" * 65,  # 65자 초과
        "name<script>",  # HTML 메타
        "a/b",  # path separator
        "a:b",  # 콜론
    ],
)
@pytest.mark.asyncio
async def test_promote_name_validation_400(
    invalid_name: str,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tmp_pool_dir: Path,
) -> None:
    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    pool_ref = await save_to_pool(_make_png_bytes(), "image/png")
    await history_db.insert_item(_make_history_item("h1", reference_ref=pool_ref))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/reference-templates/promote/h1",
            json={"name": invalid_name},
        )

    assert resp.status_code == 400


# ─────────────────────────────────────────────
# Vision 실패 silent (Codex I6)
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_promote_vision_failure_silent_partial_success(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tmp_pool_dir: Path,
    tmp_template_dir: Path,
) -> None:
    """analyze_reference 예외 → visionFailed=True + DB row 는 정상 (부분 성공)."""
    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    pool_ref = await save_to_pool(_make_png_bytes(), "image/png")
    await history_db.insert_item(_make_history_item("h1", reference_ref=pool_ref))

    async def _fake_vision(*args, **kwargs) -> None:
        raise RuntimeError("ollama down")

    monkeypatch.setattr(
        "studio.routes.reference_templates.analyze_reference", _fake_vision
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/reference-templates/promote/h1",
            json={"name": "ok"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["visionFailed"] is True
    # DB row 는 정상 저장 (description 만 None)
    assert data["template"]["visionDescription"] is None


# ─────────────────────────────────────────────
# DB rollback (Codex I5)
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_promote_db_failure_rolls_back_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tmp_pool_dir: Path,
    tmp_template_dir: Path,
) -> None:
    """DB insert 실패 → dst 파일 unlink rollback."""
    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    pool_ref = await save_to_pool(_make_png_bytes(), "image/png")
    await history_db.insert_item(_make_history_item("h1", reference_ref=pool_ref))

    async def _fake_insert(*args, **kwargs) -> None:
        raise RuntimeError("simulated DB failure")

    with patch(
        "studio.routes.reference_templates.analyze_reference",
        new_callable=AsyncMock,
    ) as mock_v:
        mock_v.return_value = "ok"
        monkeypatch.setattr(
            "studio.history_db.insert_reference_template", _fake_insert
        )

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            resp = await ac.post(
                "/api/studio/reference-templates/promote/h1",
                json={"name": "ok"},
            )

    assert resp.status_code == 500
    # tmp_template_dir 가 비어있어야 (rollback)
    files = list(tmp_template_dir.iterdir())
    assert files == []


# ─────────────────────────────────────────────
# C4 — race condition (refactor doc 2026-04-30)
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_promote_race_lost_409_and_rollback(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tmp_pool_dir: Path,
    tmp_template_dir: Path,
) -> None:
    """Codex C4 — 동시 promote 시 race 패자는 409 + template/파일 rollback.

    시나리오:
      1. history h1.reference_ref = pool_ref (임시 풀)
      2. 첫 promote 시작 → step 1~5 성공 (영구 파일 생성 + DB row insert)
      3. 직전 (step 5 와 6 사이) 다른 promote 가 먼저 history 의
         reference_ref 를 swap 했다고 가정 (DB 직접 UPDATE 로 시뮬레이션)
      4. 첫 promote 의 step 6 conditional UPDATE 실패 (rowcount==0)
      5. 검증: 첫 promote 는 409 + template row 삭제 + 영구 파일 삭제
    """
    import aiosqlite

    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    pool_ref = await save_to_pool(_make_png_bytes(), "image/png")
    await history_db.insert_item(
        _make_history_item("h1", reference_ref=pool_ref, reference_role="outfit")
    )

    # insert_reference_template 호출 직후 — 다른 요청이 먼저 swap 한 상황 시뮬레이션.
    # 원본 함수를 wrap 해서 호출 후 history.reference_ref 를 가짜 영구 URL 로 바꿈.
    real_insert = history_db.insert_reference_template

    async def _insert_then_simulate_race(item: dict) -> str:
        new_id = await real_insert(item)
        # 다른 promote 요청이 먼저 swap 한 상태를 만듦 — DB 직접 UPDATE.
        async with aiosqlite.connect(history_db._config._DB_PATH) as db:
            await db.execute(
                "UPDATE studio_history SET reference_ref = ? WHERE id = ?",
                ("/images/studio/reference-templates/winner.png", "h1"),
            )
            await db.commit()
        return new_id

    monkeypatch.setattr(
        "studio.history_db.insert_reference_template",
        _insert_then_simulate_race,
    )

    with patch(
        "studio.routes.reference_templates.analyze_reference",
        new_callable=AsyncMock,
    ) as mock_v:
        mock_v.return_value = "ok"
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            resp = await ac.post(
                "/api/studio/reference-templates/promote/h1",
                json={"name": "loser"},
            )

    # 패자는 409 (race lost)
    assert resp.status_code == 409, resp.text

    # 우리가 만든 template row 는 rollback 됐어야 — 'loser' 이름의 row 0건
    async with aiosqlite.connect(history_db._config._DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT COUNT(*) AS c FROM reference_templates WHERE name = ?",
            ("loser",),
        )
        row = await cur.fetchone()
        assert row["c"] == 0, "패자 template row 가 rollback 안 됨 (orphan)"

    # 우리가 만든 영구 파일도 rollback (디렉토리 비어있어야)
    files = list(tmp_template_dir.iterdir())
    assert files == [], f"패자 영구 파일 rollback 안 됨 (orphan): {files}"


@pytest.mark.asyncio
async def test_promote_conditional_update_uses_correct_pool_ref(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    tmp_pool_dir: Path,
    tmp_template_dir: Path,
) -> None:
    """Codex C4 — UPDATE WHERE reference_ref = ? 조건이 정상 흐름은 막지 않음.

    insert_reference_template 호출 중 race 시뮬레이션 없이 정상 promote 가
    여전히 200 으로 성공하는지 — C4 fix 가 정상 흐름 회귀 차단.
    """
    from main import app  # type: ignore
    from studio import history_db
    from studio.reference_pool import save_to_pool

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    pool_ref = await save_to_pool(_make_png_bytes(), "image/png")
    await history_db.insert_item(
        _make_history_item("h1", reference_ref=pool_ref, reference_role="outfit")
    )

    with patch(
        "studio.routes.reference_templates.analyze_reference",
        new_callable=AsyncMock,
    ) as mock_v:
        mock_v.return_value = "ok"
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as ac:
            resp = await ac.post(
                "/api/studio/reference-templates/promote/h1",
                json={"name": "winner"},
            )

    assert resp.status_code == 200, resp.text
    # history.reference_ref 가 영구 URL 로 swap 됐는지 (정상 흐름 회귀 차단)
    item = await history_db.get_item("h1")
    assert item["referenceRef"].startswith("/images/studio/reference-templates/")
