"""
prompt_favorites 테이블 + CRUD + route 테스트.

저장 대상은 AI 보강 결과가 아니라 시계 아이콘 프롬프트 히스토리에 쌓이는
사용자 원문 prompt 이다.
"""

from __future__ import annotations

from pathlib import Path

import aiosqlite
import pytest


def _set_temp_db(monkeypatch, tmp_path: Path) -> Path:
    db_path = tmp_path / "test_history.db"
    monkeypatch.setattr("studio.history_db._config._DB_PATH", str(db_path))
    return db_path


@pytest.mark.asyncio
async def test_init_db_creates_prompt_favorites_table(
    monkeypatch, tmp_path: Path
) -> None:
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    async with aiosqlite.connect(history_db._config._DB_PATH) as db:
        cur = await db.execute("PRAGMA table_info(prompt_favorites)")
        cols = {row[1] for row in await cur.fetchall()}
        cur = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='index' "
            "AND tbl_name='prompt_favorites'"
        )
        indexes = {row[0] for row in await cur.fetchall()}

    assert cols == {
        "id",
        "mode",
        "prompt",
        "prompt_hash",
        "created_at",
        "updated_at",
    }
    assert "idx_prompt_favorites_mode" in indexes


@pytest.mark.asyncio
async def test_prompt_favorite_upsert_dedupes_by_mode_and_prompt(
    monkeypatch, tmp_path: Path
) -> None:
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    first = await history_db.upsert_prompt_favorite("generate", "  cat portrait  ")
    second = await history_db.upsert_prompt_favorite("generate", "cat portrait")
    edit = await history_db.upsert_prompt_favorite("edit", "cat portrait")

    assert first["id"] == second["id"]
    assert second["prompt"] == "cat portrait"
    assert edit["id"] != second["id"]

    generate_items = await history_db.list_prompt_favorites("generate")
    all_items = await history_db.list_prompt_favorites()
    assert [x["id"] for x in generate_items] == [second["id"]]
    assert {x["mode"] for x in all_items} == {"generate", "edit"}


@pytest.mark.asyncio
async def test_prompt_favorite_delete(monkeypatch, tmp_path: Path) -> None:
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    item = await history_db.upsert_prompt_favorite("video", "slow camera push")
    assert await history_db.delete_prompt_favorite(item["id"]) is True
    assert await history_db.delete_prompt_favorite(item["id"]) is False
    assert await history_db.list_prompt_favorites("video") == []


@pytest.mark.asyncio
async def test_prompt_favorites_route_crud(monkeypatch, tmp_path: Path) -> None:
    from httpx import ASGITransport, AsyncClient

    from main import app
    from studio import history_db

    _set_temp_db(monkeypatch, tmp_path)
    await history_db.init_studio_history_db()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as cli:
        create_res = await cli.post(
            "/api/studio/prompt-favorites",
            json={"mode": "compare", "prompt": "compare lighting"},
        )
        assert create_res.status_code == 200
        item = create_res.json()["item"]
        assert item["mode"] == "compare"
        assert item["prompt"] == "compare lighting"

        list_res = await cli.get("/api/studio/prompt-favorites?mode=compare")
        assert list_res.status_code == 200
        assert [x["id"] for x in list_res.json()["items"]] == [item["id"]]

        delete_res = await cli.delete(f"/api/studio/prompt-favorites/{item['id']}")
        assert delete_res.status_code == 200

        list_res = await cli.get("/api/studio/prompt-favorites?mode=compare")
        assert list_res.json()["items"] == []
