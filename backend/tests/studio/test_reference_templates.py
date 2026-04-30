"""
reference_templates 테이블 + CRUD + reference_storage 단위 테스트 (v8 라이브러리 plan).

스코프:
  - v8 마이그레이션 — reference_templates 테이블/인덱스 생성 확인
  - insert / get / list (정렬) / touch / delete CRUD 함수 동작
  - 존재하지 않는 id 처리 (False fallback)
  - reference_storage.save_reference_image — PIL 재인코딩 + 정상 URL 반환
  - reference_path_from_url — path traversal 공격 벡터 거부

production DB 오염 방지: monkeypatch 로 history_db._config._DB_PATH 를 tmp_path 로 강제.
"""

from __future__ import annotations

import io
from pathlib import Path

import aiosqlite
import pytest
from PIL import Image, UnidentifiedImageError


def _set_temp_db(monkeypatch, tmp_path: Path) -> Path:
    """history_db._config._DB_PATH 를 임시 디렉토리로 강제."""
    db_path = tmp_path / "test_history.db"
    monkeypatch.setattr("studio.history_db._config._DB_PATH", str(db_path))
    return db_path


@pytest.mark.asyncio
async def test_init_db_creates_reference_templates_table(
    monkeypatch, tmp_path: Path
) -> None:
    """init 후 reference_templates 테이블 + lastused 인덱스 생성 확인."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    async with aiosqlite.connect(history_db._config._DB_PATH) as db:
        # 테이블 컬럼 8개 확인
        cur = await db.execute("PRAGMA table_info(reference_templates)")
        cols = {row[1] for row in await cur.fetchall()}
    assert cols == {
        "id",
        "image_ref",
        "name",
        "vision_description",
        "user_intent",
        "role_default",
        "created_at",
        "last_used_at",
    }
    # 인덱스 존재 확인
    async with aiosqlite.connect(history_db._config._DB_PATH) as db:
        cur = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND tbl_name='reference_templates'"
        )
        indexes = {row[0] for row in await cur.fetchall()}
    assert "idx_reference_templates_lastused" in indexes


@pytest.mark.asyncio
async def test_init_db_idempotent(monkeypatch, tmp_path: Path) -> None:
    """init 두 번 호출해도 안전 (CREATE IF NOT EXISTS)."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()
    await history_db.init_studio_history_db()  # 재호출 — 에러 없으면 OK


@pytest.mark.asyncio
async def test_insert_and_get_reference_template(
    monkeypatch, tmp_path: Path
) -> None:
    """insert 후 get 으로 조회 — camelCase shape 검증."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    new_id = await history_db.insert_reference_template(
        {
            "imageRef": "/images/studio/reference-templates/abc.png",
            "name": "테스트 의상",
            "visionDescription": "가벼운 흰색 셔츠",
            "userIntent": "여름 캐주얼",
            "roleDefault": "outfit",
        }
    )
    assert new_id.startswith("tpl-")

    fetched = await history_db.get_reference_template(new_id)
    assert fetched is not None
    assert fetched["id"] == new_id
    assert fetched["imageRef"] == "/images/studio/reference-templates/abc.png"
    assert fetched["name"] == "테스트 의상"
    assert fetched["visionDescription"] == "가벼운 흰색 셔츠"
    assert fetched["userIntent"] == "여름 캐주얼"
    assert fetched["roleDefault"] == "outfit"
    assert isinstance(fetched["createdAt"], int) and fetched["createdAt"] > 0
    assert fetched["lastUsedAt"] is None  # insert 직후엔 NULL


@pytest.mark.asyncio
async def test_get_reference_template_not_found(
    monkeypatch, tmp_path: Path
) -> None:
    """존재하지 않는 id → None."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    assert await history_db.get_reference_template("tpl-nonexistent") is None


@pytest.mark.asyncio
async def test_list_reference_templates_sort_by_lastused(
    monkeypatch, tmp_path: Path
) -> None:
    """list 정렬: last_used_at DESC → created_at DESC fallback."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    id_a = await history_db.insert_reference_template(
        {"imageRef": "/x/a.png", "name": "A"}
    )
    id_b = await history_db.insert_reference_template(
        {"imageRef": "/x/b.png", "name": "B"}
    )
    id_c = await history_db.insert_reference_template(
        {"imageRef": "/x/c.png", "name": "C"}
    )

    # 모두 last_used_at NULL → created_at DESC fallback (최신 insert 먼저)
    items = await history_db.list_reference_templates()
    assert [it["id"] for it in items] == [id_c, id_b, id_a]

    # B 만 touch → last_used_at 채워짐 → 정렬 1위로
    assert await history_db.touch_reference_template(id_b) is True
    items = await history_db.list_reference_templates()
    assert items[0]["id"] == id_b


@pytest.mark.asyncio
async def test_touch_reference_template(monkeypatch, tmp_path: Path) -> None:
    """touch 후 last_used_at 채워짐."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    new_id = await history_db.insert_reference_template(
        {"imageRef": "/x/y.png", "name": "T"}
    )
    assert (await history_db.get_reference_template(new_id))["lastUsedAt"] is None

    assert await history_db.touch_reference_template(new_id) is True
    fetched = await history_db.get_reference_template(new_id)
    assert isinstance(fetched["lastUsedAt"], int) and fetched["lastUsedAt"] > 0


@pytest.mark.asyncio
async def test_touch_reference_template_not_found(
    monkeypatch, tmp_path: Path
) -> None:
    """존재하지 않는 id touch → False."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    assert await history_db.touch_reference_template("tpl-missing") is False


@pytest.mark.asyncio
async def test_delete_reference_template(
    monkeypatch, tmp_path: Path
) -> None:
    """delete 후 (True, image_ref) 반환 + DB 행 사라짐."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    new_id = await history_db.insert_reference_template(
        {"imageRef": "/x/del.png", "name": "삭제 대상"}
    )

    deleted, image_ref = await history_db.delete_reference_template(new_id)
    assert deleted is True
    assert image_ref == "/x/del.png"
    assert await history_db.get_reference_template(new_id) is None


@pytest.mark.asyncio
async def test_delete_reference_template_not_found(
    monkeypatch, tmp_path: Path
) -> None:
    """존재하지 않는 id delete → (False, None)."""
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    deleted, image_ref = await history_db.delete_reference_template("tpl-no")
    assert deleted is False
    assert image_ref is None


# ─────────────────────────────────────────────
# reference_storage — 영구 저장 + path traversal 보안
# ─────────────────────────────────────────────


def _make_png_bytes(width: int = 16, height: int = 16) -> bytes:
    """단순 단색 PNG bytes 생성 — 테스트용."""
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color="red").save(buf, format="PNG")
    return buf.getvalue()


def test_save_reference_image_returns_valid_url(monkeypatch, tmp_path: Path):
    """정상 PNG bytes → URL 형식 반환 + 파일 실제 저장."""
    from studio import reference_storage

    monkeypatch.setattr(reference_storage, "REFERENCE_DIR", tmp_path)

    url = reference_storage.save_reference_image(_make_png_bytes())
    assert url.startswith(reference_storage.REFERENCE_URL_PREFIX + "/")
    assert url.endswith(".png")
    # 파일 실 저장 확인
    saved = list(tmp_path.glob("*.png"))
    assert len(saved) == 1
    # 32 hex char uuid
    assert len(saved[0].stem) == 32


def test_save_reference_image_rejects_invalid_bytes():
    """이미지가 아닌 bytes → UnidentifiedImageError 전파."""
    from studio.reference_storage import save_reference_image

    with pytest.raises(UnidentifiedImageError):
        save_reference_image(b"not an image")


@pytest.mark.parametrize(
    "evil_url",
    [
        "../../etc/passwd",
        "/images/studio/reference-templates/../leak.png",
        # Codex Phase A 리뷰 fix: query/hash 거부를 *uuid32 기반* 으로 직접 검증.
        "/images/studio/reference-templates/" + "0" * 32 + ".png?query=1",
        "/images/studio/reference-templates/" + "0" * 32 + ".png#hash",
        # query 만 단독, prefix 통과 후 query
        "/images/studio/reference-templates/" + "0" * 32 + ".png?",
        "/images/studio/reference-templates/sub/file.png",
        "/images/studio/reference-templates/file.exe",
        "/images/studio/edit-source/file.png",  # 다른 prefix
        "/images/studio/reference-templates/abc.png",  # uuid32 아님
        "/images/studio/reference-templates/abc\\evil.png",  # backslash
        "",  # 빈 문자열
    ],
)
def test_reference_path_from_url_rejects_evil(evil_url):
    """Path traversal + query/hash 공격 벡터 모두 거부 → None."""
    from studio.reference_storage import reference_path_from_url

    assert reference_path_from_url(evil_url) is None


def test_reference_path_from_url_accepts_valid_uuid32():
    """정상 uuid32 + 허용 확장자 통과 (실제 파일 존재 여부와 무관)."""
    from studio.reference_storage import reference_path_from_url

    valid_url = "/images/studio/reference-templates/" + "0" * 32 + ".png"
    result = reference_path_from_url(valid_url)
    assert result is not None
    assert result.name == "0" * 32 + ".png"


def test_delete_reference_file_evil_url_returns_false():
    """악성 URL 은 False 반환 (파일 삭제 시도 자체 안 함)."""
    from studio.reference_storage import delete_reference_file

    assert delete_reference_file("../../etc/passwd") is False
    assert delete_reference_file("") is False


def test_delete_reference_file_round_trip(monkeypatch, tmp_path: Path):
    """save → URL 으로 delete → 파일 사라짐."""
    from studio import reference_storage

    monkeypatch.setattr(reference_storage, "REFERENCE_DIR", tmp_path)

    url = reference_storage.save_reference_image(_make_png_bytes())
    saved_files = list(tmp_path.glob("*.png"))
    assert len(saved_files) == 1

    assert reference_storage.delete_reference_file(url) is True
    assert not list(tmp_path.glob("*.png"))


# ─────────────────────────────────────────────
# routes/reference_templates — meta 검증 (Codex Phase A 리뷰 fix)
# ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_edit_route_reference_template_id_overrides_client_referenceref(
    monkeypatch, tmp_path,
) -> None:
    """라이브러리 픽 케이스: referenceTemplateId 로 DB 조회 → image_ref 가 권위.

    Codex C3 fix (2026-04-30): 옛 흐름은 DB image_ref 를 history 기록만 하고
    ComfyUI 에는 클라이언트 multipart bytes 전달 (신뢰 경계 깨짐). 이제는
    multipart 동시 전송 자체를 거부 + templateId 만 전송 시 서버가 파일 read.
    """
    import json as _json
    from unittest.mock import AsyncMock

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore
    from studio import reference_storage

    # tmp REFERENCE_DIR 격리 + 실제 파일 작성 (서버가 read 함)
    tmp_ref_dir = tmp_path / "ref-templates"
    tmp_ref_dir.mkdir()
    monkeypatch.setattr(reference_storage, "REFERENCE_DIR", tmp_ref_dir)
    fname = "00000000000000000000000000000abc.png"
    template_bytes = _make_png_bytes()
    (tmp_ref_dir / fname).write_bytes(template_bytes)
    image_url = f"/images/studio/reference-templates/{fname}"

    monkeypatch.setattr(
        "studio.history_db.get_reference_template",
        AsyncMock(
            return_value={
                "id": "tpl-test",
                "imageRef": image_url,
                "name": "db",
            }
        ),
    )

    captured_kwargs: dict[str, object] = {}

    def _fake_run_edit(*_args: object, **kwargs: object):
        captured_kwargs.update(kwargs)

        async def _noop() -> None:
            return None

        return _noop()

    monkeypatch.setattr(
        "studio.routes.streams._run_edit_pipeline", _fake_run_edit
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", _make_png_bytes(), "image/png"),
                # Codex C3: templateId 만 전송, multipart reference_image 동시 전송 금지
            },
            data={
                "meta": _json.dumps(
                    {
                        "prompt": "test",
                        "useReferenceImage": True,
                        "referenceRole": "outfit",
                        "referenceTemplateId": "tpl-test",
                        # 클라이언트가 보낸 absolute (조작 가능) URL — 백엔드가 무시해야 함
                        "referenceRef": (
                            "http://evil.example/images/studio/"
                            "reference-templates/wrong.png"
                        ),
                    }
                )
            },
        )

    assert resp.status_code == 200, resp.text
    # 핵심 검증: DB 조회한 상대 URL 이 pipeline 으로 전달
    assert captured_kwargs.get("reference_ref_url") == image_url
    assert captured_kwargs.get("reference_template_id") == "tpl-test"
    # C3 핵심 — 서버가 read 한 templateId 의 실제 파일 bytes 가 ComfyUI 로 전달됨
    assert captured_kwargs.get("reference_bytes") == template_bytes


@pytest.mark.asyncio
async def test_edit_route_template_id_with_multipart_rejected_400(monkeypatch) -> None:
    """Codex C3: referenceTemplateId 와 reference_image multipart 동시 전송 시 400."""
    import json as _json

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", _make_png_bytes(), "image/png"),
                "reference_image": ("ref.png", _make_png_bytes(), "image/png"),
            },
            data={
                "meta": _json.dumps(
                    {
                        "prompt": "test",
                        "useReferenceImage": True,
                        "referenceRole": "outfit",
                        "referenceTemplateId": "tpl-x",
                    }
                )
            },
        )

    assert resp.status_code == 400, resp.text
    assert "동시에 보낼 수 없습니다" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_edit_route_unknown_template_id_returns_404(monkeypatch) -> None:
    """존재하지 않는 referenceTemplateId → 404 (조회 실패).

    Codex C3 fix: multipart reference_image 없이 templateId 만 보내야 함.
    """
    import json as _json
    from unittest.mock import AsyncMock

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    monkeypatch.setattr(
        "studio.history_db.get_reference_template",
        AsyncMock(return_value=None),
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/edit",
            files={
                "image": ("src.png", _make_png_bytes(), "image/png"),
                # Codex C3: templateId 만 전송
            },
            data={
                "meta": _json.dumps(
                    {
                        "prompt": "test",
                        "useReferenceImage": True,
                        "referenceRole": "outfit",
                        "referenceTemplateId": "tpl-missing",
                    }
                )
            },
        )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "non_dict_meta",
    ["null", "[]", '"name"', "42", "true"],
)
async def test_create_template_rejects_non_dict_meta(non_dict_meta: str) -> None:
    """meta JSON 이 dict 가 아니면 400 (옛 .get() 500 폭발 방지)."""
    import json as _json

    from httpx import ASGITransport, AsyncClient

    from main import app  # type: ignore

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/reference-templates",
            files={"image": ("tiny.png", _make_png_bytes(), "image/png")},
            data={"meta": non_dict_meta},
        )

    assert resp.status_code == 400, resp.text
    assert "object" in resp.text.lower()
    # 또 invalid JSON 도 400 (json.loads 실패 case 분리 회귀)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        resp = await ac.post(
            "/api/studio/reference-templates",
            files={"image": ("tiny.png", _make_png_bytes(), "image/png")},
            data={"meta": "{not json"},
        )
    assert resp.status_code == 400, resp.text
    # JSONDecodeError 메시지는 정확한 token 포함 안 함 → 단순 status 만
    _ = _json  # noqa: F841 (lint 호환)
