"""
backend/studio - AI Image Studio 재설계용 신규 서브패키지.

레거시 backend/services 와 분리돼 있고, 현재는 프론트 lib/api-client.ts 의
Mock API 계약을 실제로 구현하는 모듈만 담김.

- presets.py         모델 프리셋 (프론트 lib/model-presets.ts 미러)
- workflow_runner.py ComfyUI 워크플로우 JSON 로드 + proxyWidget 주입
- prompt_pipeline.py gemma4 기반 프롬프트 업그레이드 (Ollama)
- vision_pipeline.py 수정 모드 비전 2단계 체이닝
- claude_cli.py      Claude CLI 비대화 호출 (조사 필요)
- router.py          FastAPI 라우터 (/api/studio/*)
"""
