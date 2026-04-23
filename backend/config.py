"""
AI Image Studio 환경 설정
pydantic-settings로 .env 파일에서 자동 로드
모든 설정의 진입점 — 하드코딩 금지
"""

from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ 디렉토리 절대 경로 — 모든 상대 경로는 여기를 기준으로 해석
_BACKEND_DIR = Path(__file__).resolve().parent

# .env 경로를 cwd 의존 없이 config.py 파일 위치 기준으로 탐색
# (backend/config.py 상위를 올라가며 첫 번째 .env 사용 — worktree/일반 실행 모두 지원)
def _find_env_file() -> Path:
    here = Path(__file__).resolve().parent
    # 1순위: backend/../.env (일반 프로젝트 구조)
    candidate = here.parent / ".env"
    if candidate.exists():
        return candidate
    # 2순위: 상위 폴더 탐색 (worktree 환경 등)
    for ancestor in here.parents:
        candidate = ancestor / ".env"
        if candidate.exists():
            return candidate
    # 최종 폴백 (없어도 pydantic이 환경변수에서 읽으려 시도)
    return here.parent / ".env"


_ENV_PATH = _find_env_file()


class Settings(BaseSettings):
    """앱 전체 설정 (환경변수 / .env에서 로드)"""

    model_config = SettingsConfigDict(
        env_file=str(_ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ComfyUI 설정
    # 기본값: ComfyUI Desktop 설치(8000) 기준. 원본 ComfyUI 기본 8188 을 쓰는 환경에선 .env 로 override.
    comfyui_url: str = "http://127.0.0.1:8000"
    comfyui_executable: str = ""
    comfyui_models_path: str = ""
    comfyui_auto_shutdown_minutes: int = 10

    # Ollama 설정
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "gemma4-un"  # 비전(멀티모달) 지원 모델
    ollama_executable: str = ""  # ollama.exe 전체 경로 (.env에서 설정 필요 — 수동 시작용)

    # LLM 폴백 설정 (Ollama 실패 시)
    claude_cli_path: str = "claude"  # Claude CLI 실행 경로
    llm_fallback_enabled: bool = True  # Ollama 실패 시 Claude CLI 폴백

    # VRAM 모니터링
    vram_total_gb: float = 16.0  # GPU VRAM 총량

    # 기본 워크플로우
    default_workflow: str = "qwen_image"

    # LTX-2.3 Video i2v — VRAM 16GB 대응용 unet override.
    # 기본 fp8 체크포인트(29GB)가 로컬에서 너무 크면, .env 에
    # LTX_UNET_NAME=ltx-2.3-22b-dev_transformer_only_fp8_scaled.safetensors
    # 같이 지정해 Kijai/축소 variant 로 교체 가능.
    ltx_unet_name: str | None = None

    # 앱 설정
    # ComfyUI(8000)와 충돌 회피를 위해 백엔드는 8001 기본 사용
    app_host: str = "127.0.0.1"
    app_port: int = 8001
    frontend_url: str = "http://localhost:3000"

    # 데이터 경로
    history_db_path: str = "./data/history.db"
    output_image_path: str = "./data/images"
    upload_path: str = "./data/uploads"

    # 워크플로우 템플릿 경로
    workflows_path: str = "./workflows"

    # ── 경로 validator: 상대 경로를 backend/ 기준 절대 경로로 정규화 ──
    # cwd가 달라도(worktree/일반 실행 모두) 동일하게 해석되도록 강제.
    @field_validator(
        "history_db_path",
        "output_image_path",
        "upload_path",
        "workflows_path",
        mode="before",
    )
    @classmethod
    def _resolve_relative_to_backend(cls, v: str) -> str:
        p = Path(v)
        if p.is_absolute():
            return str(p)
        return str((_BACKEND_DIR / v).resolve())

    @property
    def comfyui_ws_url(self) -> str:
        """ComfyUI WebSocket URL 생성"""
        return self.comfyui_url.replace("http", "ws")

    @property
    def frontend_origins(self) -> list[str]:
        """
        CORS 허용 origin 리스트 — frontend_url을 comma-separated로 파싱
        개발 시 여러 포트(3000, 3001) 병행 지원
        예: frontend_url="http://localhost:3000,http://localhost:3001"

        추가 처리:
         - trailing slash 제거 (브라우저 Origin 헤더는 slash 없이 옴)
         - localhost ↔ 127.0.0.1 자동 대응 (브라우저는 두 origin을 다르게 취급)
        """
        # 1) 파싱 + trailing slash 제거
        raw = [url.strip().rstrip("/") for url in self.frontend_url.split(",") if url.strip()]
        # 2) localhost ↔ 127.0.0.1 쌍 자동 생성
        expanded: list[str] = []
        for url in raw:
            expanded.append(url)
            if "://localhost" in url:
                expanded.append(url.replace("://localhost", "://127.0.0.1"))
            elif "://127.0.0.1" in url:
                expanded.append(url.replace("://127.0.0.1", "://localhost"))
        # 3) 중복 제거 (입력 순서 유지)
        seen: set[str] = set()
        out: list[str] = []
        for u in expanded:
            if u not in seen:
                seen.add(u)
                out.append(u)
        return out

    def ensure_data_dirs(self) -> None:
        """데이터 디렉토리 자동 생성"""
        Path(self.output_image_path).mkdir(parents=True, exist_ok=True)
        Path(self.history_db_path).parent.mkdir(parents=True, exist_ok=True)
        Path(self.upload_path).mkdir(parents=True, exist_ok=True)


# 싱글톤 인스턴스
settings = Settings()
