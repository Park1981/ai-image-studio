"""
studio/router.py — facade. 실제 endpoint 정의는 studio.routes 패키지로 분리됨.

태스크 #16 (pipelines/ 추출) + #17 (routes/ 분리) 후 본 모듈은:
  - 통합 APIRouter (`router`) 노출 — main.py 가 include 하는 진입점
  - 외부 호환을 위해 storage/tasks/schemas/pipelines/routes 의 핵심 심볼 re-export
    (tests/studio/* 가 `from studio.router import X` 로 잡고 있는 이름들)

엔드포인트:
  POST /api/studio/generate          → { task_id, stream_url }
  GET  /api/studio/generate/stream/{task_id}  → SSE
  POST /api/studio/edit              → { task_id, stream_url } (multipart)
  GET  /api/studio/edit/stream/{task_id}      → SSE
  POST /api/studio/video             → { task_id, stream_url } (multipart, LTX-2.3 i2v)
  GET  /api/studio/video/stream/{task_id}     → SSE
  POST /api/studio/upgrade-only      → { upgradedPrompt, ... } (sync)
  POST /api/studio/research          → { hints: [] } (sync)
  POST /api/studio/interrupt         → { ok }
  POST /api/studio/vision-analyze    → { en, ko, provider, ... } (multipart, sync)
  POST /api/studio/compare-analyze   → { analysis, saved } (multipart, sync · mutex 보호)
  GET  /api/studio/models            → 모델 프리셋 (프론트 lib/model-presets.ts 미러)
  GET  /api/studio/ollama/models     → 설치된 Ollama 모델 목록
  GET  /api/studio/process/status    → {ollama:{running}, comfyui:{running}}
  POST /api/studio/process/{name}/{action}  → {ok, message}
  GET  /api/studio/history[/{id}]    → studio_history 조회
  DELETE /api/studio/history[/{id}]  → 삭제
"""

from __future__ import annotations

# ─────────────────────────────────────────────
# 통합 APIRouter — main.py 의 진입점.
# ─────────────────────────────────────────────
from .routes import studio_router as router  # noqa: F401 — main.py 진입점

# ─────────────────────────────────────────────
# 외부 호환 re-export — tests/studio/* 가 from studio.router import ... 로 잡는 이름.
# 실 코드는 본 별칭을 더이상 사용하지 않음. (lookup module 기준 mock.patch 는 새 위치에서)
# ─────────────────────────────────────────────

# storage 계층
from .storage import (  # noqa: F401
    EDIT_SOURCE_DIR,
    EDIT_SOURCE_URL_PREFIX,
    STUDIO_OUTPUT_DIR,
    STUDIO_URL_PREFIX,
    TASK_ID_RE as _TASK_ID_RE,
    _cleanup_edit_source_file,
    _cleanup_result_file,
    _edit_source_path_from_url,
    _EDIT_SOURCE_FILENAME_RE,
    _next_save_path,
    _persist_history,
    _resolve_save_dir,
    _result_path_from_url,
    _RESULT_FILENAME_RE,
)

# Pydantic 모델
from .schemas import (  # noqa: F401
    GenerateBody,
    ProcessAction,
    ResearchBody,
    TaskCreated,
    UpgradeOnlyBody,
)

# 메모리 내 태스크 큐 + 클린업 루프 (main.py lifespan 이 직접 import)
from .tasks import (  # noqa: F401
    TASK_TTL_SEC,
    TASKS,
    Task,
    _cleanup_stale_tasks,
    _new_task,
    _TASKS_LOCK,
    start_cleanup_loop,
    stop_cleanup_loop,
)

# 파이프라인 (test_comparison_pipeline 등이 _run_edit_pipeline 등 직접 import)
from .pipelines import (  # noqa: F401
    COMFY_MOCK_FALLBACK,
    ComfyDispatchResult,
    SaveOutputFn,
    _cleanup_comfy_temp,
    _COMFYUI_OUTPUT_BASE,
    _dispatch_to_comfy,
    _EDIT_MAX_IMAGE_BYTES,
    _extract_image_dims,
    _mark_generation_complete,
    _mock_ref_or_raise,
    _OUR_COMFY_PREFIXES,
    _run_edit_pipeline,
    _run_generate_pipeline,
    _run_video_pipeline_task,
    _save_comfy_output,
    _save_comfy_video,
    STUDIO_MAX_IMAGE_BYTES,
    _VIDEO_MAX_IMAGE_BYTES,
)

# routes 의 공용 SSE/태스크 유틸 — 일부 통합 테스트가 직접 호출.
from .routes._common import (  # noqa: F401
    _BACKGROUND_TASKS,
    _proc_mgr,
    _spawn,
    _sse_format,
    _stream_task,
)

# routes 안에서 사용하던 endpoint-bound 헬퍼/심볼들 — 패치 호환 목적.
# (테스트가 `studio.router.X` 로 patch 하는 케이스 — 모두 routes/* 로 이동했지만
#  re-export 로 import 자체는 깨지지 않게 한다.)
from .comparison_pipeline import analyze_pair  # noqa: F401  (analyze_pair_generic 은 Task 14 에서 v2_generic 과 함께 폐기)
from .prompt_pipeline import clarify_edit_intent, upgrade_generate_prompt  # noqa: F401
from .vision_pipeline import (  # noqa: F401
    analyze_image_detailed,
    run_vision_pipeline,
)
