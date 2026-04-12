"""
생성 라우터 통합 테스트
- httpx AsyncClient + FastAPI 앱
- 서비스 레이어는 mock으로 격리
"""

import io

import pytest
from unittest.mock import AsyncMock, patch



# ─────────────────────────────────────────────
# POST /api/generate
# ─────────────────────────────────────────────

class TestGenerateEndpoint:
    """이미지 생성 엔드포인트"""

    @pytest.mark.asyncio
    async def test_생성_요청_task_id_반환(self, async_client):
        """POST /api/generate → task_id 즉시 반환"""
        # 백그라운드 태스크 실행 방지 (실제 ComfyUI 없음)
        with patch("routers.generate._run_generation", new_callable=AsyncMock):
            resp = await async_client.post("/api/generate", json={
                "prompt": "a beautiful mountain",
                "steps": 20,
                "cfg": 7.0,
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "task_id" in data["data"]
        assert data["data"]["status"] == "queued"

    @pytest.mark.asyncio
    async def test_빈_프롬프트_검증(self, async_client):
        """prompt 필드 누락 → 422 검증 에러"""
        resp = await async_client.post("/api/generate", json={
            "steps": 20,
        })
        assert resp.status_code == 422


# ─────────────────────────────────────────────
# GET /api/generate/status/{task_id}
# ─────────────────────────────────────────────

class TestStatusEndpoint:
    """태스크 상태 조회"""

    @pytest.mark.asyncio
    async def test_상태_조회(self, async_client):
        """존재하는 태스크 상태 조회"""
        # 먼저 태스크 생성
        with patch("routers.generate._run_generation", new_callable=AsyncMock):
            create_resp = await async_client.post("/api/generate", json={
                "prompt": "test prompt",
            })
        task_id = create_resp.json()["data"]["task_id"]

        # 상태 조회
        resp = await async_client.get(f"/api/generate/status/{task_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["data"]["task_id"] == task_id
        assert data["data"]["status"] == "queued"

    @pytest.mark.asyncio
    async def test_없는_태스크_조회(self, async_client):
        """존재하지 않는 태스크 → success=False"""
        resp = await async_client.get("/api/generate/status/nonexistent")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is False
        assert "존재하지 않는" in data["error"]


# ─────────────────────────────────────────────
# POST /api/generate/cancel/{task_id}
# ─────────────────────────────────────────────

class TestCancelEndpoint:
    """생성 취소"""

    @pytest.mark.asyncio
    async def test_취소_요청(self, async_client):
        """queued 상태 태스크 취소"""
        # 태스크 생성
        with patch("routers.generate._run_generation", new_callable=AsyncMock):
            create_resp = await async_client.post("/api/generate", json={
                "prompt": "cancel me",
            })
        task_id = create_resp.json()["data"]["task_id"]

        # 취소 요청 (ComfyUI interrupt mock)
        with patch("routers.generate.comfyui_client.interrupt", new_callable=AsyncMock, return_value=True):
            resp = await async_client.post(f"/api/generate/cancel/{task_id}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["data"]["interrupted"] is True

    @pytest.mark.asyncio
    async def test_없는_태스크_취소(self, async_client):
        """존재하지 않는 태스크 취소 → 에러"""
        resp = await async_client.post("/api/generate/cancel/nonexistent")
        data = resp.json()
        assert data["success"] is False


# ─────────────────────────────────────────────
# POST /api/images/upload
# ─────────────────────────────────────────────

class TestUploadEndpoint:
    """이미지 업로드"""

    @pytest.mark.asyncio
    async def test_이미지_업로드(self, async_client, tmp_path):
        """정상 파일 업로드 → 파일명+사이즈 반환"""
        # upload_path를 임시 디렉토리로 패치
        with patch("routers.generate.settings") as mock_settings:
            mock_settings.upload_path = str(tmp_path / "uploads")

            # multipart 파일 전송
            fake_image = io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100)
            resp = await async_client.post(
                "/api/images/upload",
                files={"file": ("test.png", fake_image, "image/png")},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "filename" in data["data"]
        assert data["data"]["size"] > 0


# ─────────────────────────────────────────────
# POST /api/generate/edit
# ─────────────────────────────────────────────

class TestEditEndpoint:
    """이미지 수정 엔드포인트"""

    @pytest.mark.asyncio
    async def test_수정_요청_task_id_반환(self, async_client):
        """POST /api/generate/edit → task_id 즉시 반환"""
        with patch("routers.generate._run_edit_generation", new_callable=AsyncMock):
            resp = await async_client.post("/api/generate/edit", json={
                "source_image": "test.png",
                "edit_prompt": "change background to blue",
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "task_id" in data["data"]
        assert data["data"]["status"] == "queued"

    @pytest.mark.asyncio
    async def test_edit_prompt_누락(self, async_client):
        """edit_prompt 필드 누락 → 422"""
        resp = await async_client.post("/api/generate/edit", json={
            "source_image": "test.png",
        })
        assert resp.status_code == 422


# ─────────────────────────────────────────────
# 헬스 체크
# ─────────────────────────────────────────────

class TestHealthEndpoints:
    """기본 엔드포인트"""

    @pytest.mark.asyncio
    async def test_root(self, async_client):
        """GET / → 앱 정보"""
        resp = await async_client.get("/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["data"]["name"] == "AI Image Studio"

    @pytest.mark.asyncio
    async def test_health(self, async_client):
        """GET /api/health → 프로세스 상태"""
        with patch("main.process_manager.check_ollama", new_callable=AsyncMock, return_value=False):
            with patch("main.process_manager.check_comfyui", new_callable=AsyncMock, return_value=False):
                resp = await async_client.get("/api/health")

        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["backend"] == "ok"
