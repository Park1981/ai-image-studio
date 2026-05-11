"""
video_pipeline + upgrade_video_prompt + history_db 마이그레이션 검증.
2026-04-24 · V3.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import aiosqlite
import pytest
from PIL import Image
import io

from studio.history_db import (
    CREATE_IDX_CREATED,
    CREATE_IDX_MODE,
    _needs_video_mode_migration,
    _migrate_add_video_mode,
)
from studio.prompt_pipeline import (
    UpgradeResult,
    build_system_video,
    upgrade_video_prompt,
)
from studio.video_pipeline import VideoPipelineResult, run_video_pipeline


# ═════════════════════════════════════════════
# spec 19 옵션 B — 단계별 unload (Video)
# ═════════════════════════════════════════════


def test_run_video_pipeline_unloads_vision_before_text_spec19() -> None:
    """spec 19 옵션 B — vision (qwen2.5vl) 호출 후 / text (gemma4) 호출 전 unload.

    16GB VRAM 한계 → 두 모델 동시 점유 시 swap. 단계별 unload 로 차단.
    """
    unload_calls: list[str] = []

    async def _spy_unload(model: str, **_kwargs):
        unload_calls.append(model)
        return True

    async def _no_sleep(_sec):
        return None

    fake_upgrade_result = UpgradeResult(
        upgraded="final video prompt",
        fallback=False,
        provider="ollama",
        original="user direction",
        translation=None,
    )

    with (
        patch(
            "studio.video_pipeline._describe_image",
            new=AsyncMock(return_value="vision caption"),
        ),
        patch(
            "studio.video_pipeline.upgrade_video_prompt",
            new=AsyncMock(return_value=fake_upgrade_result),
        ),
        patch(
            "studio.ollama_unload.unload_model",
            new=_spy_unload,
        ),
        patch(
            "studio.video_pipeline.asyncio.sleep",
            new=_no_sleep,
        ),
    ):
        asyncio.run(
            run_video_pipeline(
                _tiny_png_bytes(),
                "panning shot",
                vision_model="qwen2.5vl:7b",
                text_model="gemma4-un:latest",
            )
        )

    # vision (qwen) 호출 후 unload 한 번 (text 호출 전)
    assert unload_calls == ["qwen2.5vl:7b"], (
        f"video pipeline 단계별 unload 누락 (예상: [qwen2.5vl:7b] / 실제: {unload_calls})"
    )


def _tiny_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (2, 2), color=(30, 40, 60)).save(buf, "PNG")
    return buf.getvalue()


# ═════════════════════════════════════════════
# SYSTEM_VIDEO 상수 검증 (LTX 기준 · v1.1 이후 build_system_video(model_id="ltx") 경유)
# ═════════════════════════════════════════════


def test_system_video_has_required_cues() -> None:
    """LTX-2.3 영상 프롬프트 지시 키워드가 포함됐는지."""
    system_ltx = build_system_video(adult=False, model_id="ltx")
    assert "60-150 words" in system_ltx
    for cue in ("motion", "camera", "lighting", "ambient"):
        assert cue in system_ltx.lower()
    # 금지 지시
    assert "cartoon" in system_ltx.lower()
    assert "game" in system_ltx.lower()
    # 출력 포맷 강제
    assert "no bullets" in system_ltx.lower()


# ═════════════════════════════════════════════
# upgrade_video_prompt
# ═════════════════════════════════════════════


def test_upgrade_video_success() -> None:
    """정상 경로 — en/ko 둘 다."""
    chat_mock = AsyncMock(
        return_value=(
            "A cinematic close-up pans slowly across the subject as warm "
            "sunlight filters through a window..."
        )
    )
    translate_mock = AsyncMock(return_value="시네마틱 클로즈업이 피사체를 따라 천천히 팬...")
    with (
        patch("studio.prompt_pipeline._ollama._call_ollama_chat", new=chat_mock),
        patch("studio.prompt_pipeline.translate.translate_to_korean", new=translate_mock),
    ):
        result: UpgradeResult = asyncio.run(
            upgrade_video_prompt(
                user_direction="피사체 클로즈업",
                image_description="A woman in soft window light",
                model_id="ltx",  # 기존 LTX 동작 보존 (v1.1)
            )
        )
    assert result.fallback is False
    assert result.provider == "ollama"
    assert "cinematic" in result.upgraded.lower()
    assert result.translation and "클로즈업" in result.translation


def test_upgrade_video_fallback_on_ollama_fail() -> None:
    """gemma4 호출 실패 시 원본 direction 보존 + fallback=True."""
    chat_mock = AsyncMock(side_effect=RuntimeError("ollama down"))
    translate_mock = AsyncMock(return_value="not called")
    with (
        patch("studio.prompt_pipeline._ollama._call_ollama_chat", new=chat_mock),
        patch("studio.prompt_pipeline.translate.translate_to_korean", new=translate_mock),
    ):
        result = asyncio.run(
            upgrade_video_prompt(
                user_direction="카메라가 위로 팬",
                image_description="A landscape",
                model_id="ltx",  # 기존 LTX 동작 보존 (v1.1)
            )
        )
    assert result.fallback is True
    assert result.provider == "fallback"
    assert result.upgraded == "카메라가 위로 팬"
    assert result.translation is None


def test_upgrade_video_empty_direction() -> None:
    """빈 direction 은 즉시 fallback."""
    result = asyncio.run(
        upgrade_video_prompt(user_direction="  ", image_description="x", model_id="ltx")
    )
    assert result.fallback is True


def test_upgrade_video_uses_system_video_prompt() -> None:
    """adult=False (기본) 호출 시 SFW build_system_video(model_id="ltx") 전달."""
    chat_mock = AsyncMock(return_value="out")
    translate_mock = AsyncMock(return_value=None)
    with (
        patch("studio.prompt_pipeline._ollama._call_ollama_chat", new=chat_mock),
        patch("studio.prompt_pipeline.translate.translate_to_korean", new=translate_mock),
    ):
        asyncio.run(
            upgrade_video_prompt(
                user_direction="move",
                image_description="desc",
                model_id="ltx",  # 기존 LTX 동작 보존 (v1.1)
            )
        )
    _, kwargs = chat_mock.call_args
    assert kwargs["system"] == build_system_video(adult=False, model_id="ltx")
    # SFW 에선 ADULT_CLAUSE 미포함
    assert "ADULT MODE" not in kwargs["system"]


def test_upgrade_video_adult_injects_nsfw_clause() -> None:
    """adult=True 시 시스템 프롬프트에 ADULT MODE clause 주입."""
    chat_mock = AsyncMock(return_value="out")
    translate_mock = AsyncMock(return_value=None)
    with (
        patch("studio.prompt_pipeline._ollama._call_ollama_chat", new=chat_mock),
        patch("studio.prompt_pipeline.translate.translate_to_korean", new=translate_mock),
    ):
        asyncio.run(
            upgrade_video_prompt(
                user_direction="move",
                image_description="desc",
                adult=True,
                model_id="ltx",  # 기존 LTX 동작 보존 (v1.1)
            )
        )
    _, kwargs = chat_mock.call_args
    sys_prompt = kwargs["system"]
    assert "ADULT MODE" in sys_prompt
    # 핵심 키워드들 — gemma4 가 이 지침대로 답하는지가 핵심
    for cue in ("sensual", "seductive", "intimate", "erotic"):
        assert cue in sys_prompt.lower(), f"missing cue: {cue}"
    # identity clause 는 adult 토글과 무관하게 보존되어야 함
    assert "identical face" in sys_prompt.lower()


def test_build_system_video_sfw_vs_adult_divergence() -> None:
    """SFW 버전은 ADULT 블록이 없고, 나머지는 동일 패턴 유지."""
    sfw = build_system_video(adult=False, model_id="ltx")
    nsfw = build_system_video(adult=True, model_id="ltx")
    assert "ADULT MODE" not in sfw
    assert "ADULT MODE" in nsfw
    # 둘 다 RULES 섹션은 끝에 있어야 함
    assert sfw.rstrip().endswith("required).")
    assert nsfw.rstrip().endswith("required).")


# ═════════════════════════════════════════════
# run_video_pipeline (vision + upgrade)
# ═════════════════════════════════════════════


def test_run_video_pipeline_success() -> None:
    desc_mock = AsyncMock(return_value="A moody studio portrait at dusk.")
    upgrade_mock = AsyncMock(
        return_value=UpgradeResult(
            upgraded="cinematic dusk scene, slow dolly in, amber light, ambient wind",
            fallback=False,
            provider="ollama",
            original="dusk mood",
            translation="저녁 분위기 무드",
        )
    )
    with (
        patch("studio.video_pipeline._describe_image", new=desc_mock),
        patch("studio.video_pipeline.upgrade_video_prompt", new=upgrade_mock),
    ):
        result: VideoPipelineResult = asyncio.run(
            run_video_pipeline(_tiny_png_bytes(), "dusk mood")
        )
    assert result.vision_ok is True
    assert "dusk" in result.image_description.lower()
    assert "cinematic" in result.final_prompt.lower()
    assert result.upgrade.translation == "저녁 분위기 무드"


def test_run_video_pipeline_vision_fail_still_upgrades() -> None:
    """vision 실패 → description="" 지만 upgrade 는 진행 (fallback 메세지)."""
    desc_mock = AsyncMock(return_value="")  # vision 실패
    upgrade_mock = AsyncMock(
        return_value=UpgradeResult(
            upgraded="generic video prompt",
            fallback=False,
            provider="ollama",
            original="x",
            translation=None,
        )
    )
    with (
        patch("studio.video_pipeline._describe_image", new=desc_mock),
        patch("studio.video_pipeline.upgrade_video_prompt", new=upgrade_mock),
    ):
        result = asyncio.run(run_video_pipeline(_tiny_png_bytes(), "x"))
    assert result.vision_ok is False
    assert "vision model unavailable" in result.image_description
    # upgrade 는 호출됐음 (실패한 설명 포함)
    upgrade_mock.assert_called_once()
    _, kwargs = upgrade_mock.call_args
    assert "vision model unavailable" in kwargs["image_description"]


# ═════════════════════════════════════════════
# history_db 마이그레이션 (video mode CHECK 확장)
# ═════════════════════════════════════════════


_LEGACY_CREATE = """
CREATE TABLE studio_history (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('generate','edit')),
  prompt TEXT NOT NULL,
  label TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  seed INTEGER,
  steps INTEGER,
  cfg REAL,
  lightning INTEGER,
  model TEXT,
  created_at INTEGER NOT NULL,
  image_ref TEXT NOT NULL,
  upgraded_prompt TEXT,
  upgraded_prompt_ko TEXT,
  prompt_provider TEXT,
  research_hints TEXT,
  vision_description TEXT,
  comfy_error TEXT
)
"""


async def _setup_legacy_db(db_path: str) -> None:
    async with aiosqlite.connect(db_path) as db:
        await db.execute(_LEGACY_CREATE)
        await db.execute(CREATE_IDX_CREATED)
        await db.execute(CREATE_IDX_MODE)
        # 샘플 데이터
        await db.execute(
            "INSERT INTO studio_history "
            "(id, mode, prompt, label, created_at, image_ref) "
            "VALUES ('g1', 'generate', 'p', 'l', 100, '/images/x.png')"
        )
        await db.execute(
            "INSERT INTO studio_history "
            "(id, mode, prompt, label, created_at, image_ref) "
            "VALUES ('e1', 'edit', 'p', 'l', 101, '/images/y.png')"
        )
        await db.commit()


@pytest.mark.asyncio
async def test_migration_detects_legacy_check(tmp_path: Path) -> None:
    """'video' 가 포함 안 된 레거시 CHECK → 마이그레이션 필요."""
    db_path = str(tmp_path / "legacy.db")
    await _setup_legacy_db(db_path)
    async with aiosqlite.connect(db_path) as db:
        needs = await _needs_video_mode_migration(db)
    assert needs is True


@pytest.mark.asyncio
async def test_migration_adds_video_mode(tmp_path: Path) -> None:
    """마이그레이션 실행 후 'video' insert 가능, 기존 데이터 보존."""
    db_path = str(tmp_path / "legacy.db")
    await _setup_legacy_db(db_path)

    async with aiosqlite.connect(db_path) as db:
        await _migrate_add_video_mode(db)

        # video insert 성공해야
        await db.execute(
            "INSERT INTO studio_history "
            "(id, mode, prompt, label, created_at, image_ref) "
            "VALUES ('v1', 'video', 'p', 'l', 200, '/images/v.mp4')"
        )
        await db.commit()

        # 기존 데이터 2건 + 새 video 1건 = 3건
        cur = await db.execute("SELECT COUNT(*) FROM studio_history")
        row = await cur.fetchone()
        assert row[0] == 3

        # 인덱스 살아있는지
        cur = await db.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='index' AND tbl_name='studio_history'"
        )
        idx_names = {r[0] for r in await cur.fetchall()}
        assert "idx_studio_history_created" in idx_names
        assert "idx_studio_history_mode" in idx_names

        # 재호출 — idempotent (다시 video 있는 DB 면 needs=False)
        needs = await _needs_video_mode_migration(db)
        assert needs is False


@pytest.mark.asyncio
async def test_migration_rejects_invalid_mode(tmp_path: Path) -> None:
    """마이그레이션 후에도 CHECK 는 여전히 동작 — 'foobar' 같은 모드는 거부."""
    db_path = str(tmp_path / "legacy.db")
    await _setup_legacy_db(db_path)
    async with aiosqlite.connect(db_path) as db:
        await _migrate_add_video_mode(db)
        with pytest.raises(aiosqlite.IntegrityError):
            await db.execute(
                "INSERT INTO studio_history "
                "(id, mode, prompt, label, created_at, image_ref) "
                "VALUES ('bad', 'foobar', 'p', 'l', 300, '/x')"
            )
            await db.commit()
