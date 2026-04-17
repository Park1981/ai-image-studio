"""
AI Image Studio 환경 설정
pydantic-settings로 .env 파일에서 자동 로드
모든 설정의 진입점 — 하드코딩 금지
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """앱 전체 설정 (환경변수 / .env에서 로드)"""

    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ComfyUI 설정
    comfyui_url: str = "http://127.0.0.1:8188"
    comfyui_executable: str = ""
    comfyui_models_path: str = ""
    comfyui_auto_shutdown_minutes: int = 10

    # Ollama 설정
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "gemma4-un"  # 비전(멀티모달) 지원 모델

    # LLM 폴백 설정 (Ollama 실패 시)
    claude_cli_path: str = "claude"  # Claude CLI 실행 경로
    llm_fallback_enabled: bool = True  # Ollama 실패 시 Claude CLI 폴백

    # VRAM 모니터링
    vram_total_gb: float = 16.0  # GPU VRAM 총량

    # 기본 워크플로우
    default_workflow: str = "qwen_image"

    # 앱 설정
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    frontend_url: str = "http://localhost:3000"

    # 데이터 경로
    history_db_path: str = "./data/history.db"
    output_image_path: str = "./data/images"
    upload_path: str = "./data/uploads"

    # 워크플로우 템플릿 경로
    workflows_path: str = "./workflows"

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
        """
        return [url.strip() for url in self.frontend_url.split(",") if url.strip()]

    def ensure_data_dirs(self) -> None:
        """데이터 디렉토리 자동 생성"""
        Path(self.output_image_path).mkdir(parents=True, exist_ok=True)
        Path(self.history_db_path).parent.mkdir(parents=True, exist_ok=True)
        Path(self.upload_path).mkdir(parents=True, exist_ok=True)


# 싱글톤 인스턴스
settings = Settings()
