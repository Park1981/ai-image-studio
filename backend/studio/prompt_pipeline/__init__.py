"""
prompt_pipeline — gemma4 기반 프롬프트 업그레이드 (Ollama 연동) facade.

흐름:
1. 사용자가 자연어 프롬프트 입력 (한글 OK)
2. gemma4-un 에 시스템 프롬프트 + 사용자 프롬프트 전달
3. "업그레이드된 영어 프롬프트" 반환 (Qwen Image 2512 / Edit 2511 / LTX Video 2.3 에 최적화)
4. 실패/타임아웃 시 원본 프롬프트 + warn 플래그 반환 (폴백)

조사(Claude CLI) 컨텍스트가 있으면 시스템 프롬프트에 참고자료로 주입한다.

Phase 4.3 (2026-04-30) 4 sub-module 분할:
- _common: UpgradeResult / _strip_repeat_noise / _DEFAULT_OLLAMA_URL / DEFAULT_TIMEOUT / log
- _ollama: _call_ollama_chat (HTTP wire)
- translate: SYSTEM_TRANSLATE_KO / SYSTEM_CLARIFY_INTENT / clarify_edit_intent / translate_to_korean
- upgrade: 모든 SYSTEM_GENERATE/EDIT/VIDEO_* + ROLE_* + DOMAIN_VALID_SLOTS +
           build_reference_clause / build_system_video / _run_upgrade_call /
           _slot_label / _build_matrix_directive_block /
           upgrade_generate/edit/video_prompt

신규 코드는 sub-module 직접 import 권장 (production import 호환을 위해 facade
re-export 유지). 단 lazy import / mock.patch 는 sub-module path 사용 — facade
attribute 는 import 시점 reference snapshot 이라 submodule patch 가 facade 에
반영 안 됨 (Phase 4.3 codex C2 정책).
"""

from __future__ import annotations

from ._common import (  # noqa: F401 — facade re-export (production import 호환)
    DEFAULT_TIMEOUT,
    PromptEnhanceMode,
    UpgradeResult,
    _DEFAULT_OLLAMA_URL,
    _resolve_mode_options,
    _strip_repeat_noise,
    log,
)
from ._ollama import _call_ollama_chat  # noqa: F401 — facade re-export
from .translate import (  # noqa: F401 — facade re-export
    SYSTEM_CLARIFY_INTENT,
    SYSTEM_TRANSLATE_KO,
    clarify_edit_intent,
    translate_to_korean,
)
from .tools import (  # noqa: F401 — facade re-export (Phase 5 · 2026-05-01)
    ALLOWED_SECTION_KEYS,
    PromptSection,
    PromptSplitResult,
    PromptTranslateResult,
    TranslateDirection,
    split_prompt_cards,
    translate_prompt,
)
from .upgrade import (  # noqa: F401 — facade re-export
    DOMAIN_VALID_SLOTS,
    ROLE_INSTRUCTIONS,
    ROLE_TO_SLOTS,
    SYSTEM_EDIT,
    SYSTEM_GENERATE,
    SYSTEM_VIDEO_ADULT_CLAUSE,
    SYSTEM_VIDEO_BASE,
    SYSTEM_VIDEO_RULES,
    SYSTEM_VIDEO_WAN22_BASE,  # NEW (2026-05-11 · Wan 2.2 전용)
    _build_matrix_directive_block,
    _role_target_slots,
    _run_upgrade_call,
    _slot_label,
    build_reference_clause,
    build_system_video,
    upgrade_edit_prompt,
    upgrade_generate_prompt,
    upgrade_video_prompt,
)

__all__ = [
    # _common
    "UpgradeResult",
    "PromptEnhanceMode",
    "_resolve_mode_options",
    "_strip_repeat_noise",
    "_DEFAULT_OLLAMA_URL",
    "DEFAULT_TIMEOUT",
    "log",
    # _ollama
    "_call_ollama_chat",
    # translate
    "SYSTEM_TRANSLATE_KO",
    "SYSTEM_CLARIFY_INTENT",
    "clarify_edit_intent",
    "translate_to_korean",
    # tools (Phase 5 · 2026-05-01)
    "ALLOWED_SECTION_KEYS",
    "PromptSection",
    "PromptSplitResult",
    "PromptTranslateResult",
    "TranslateDirection",
    "split_prompt_cards",
    "translate_prompt",
    # upgrade — system prompts
    "SYSTEM_GENERATE",
    "SYSTEM_EDIT",
    "SYSTEM_VIDEO_BASE",
    "SYSTEM_VIDEO_WAN22_BASE",  # NEW (2026-05-11)
    "SYSTEM_VIDEO_ADULT_CLAUSE",
    "SYSTEM_VIDEO_RULES",
    # upgrade — role/clause
    "ROLE_INSTRUCTIONS",
    "ROLE_TO_SLOTS",
    "DOMAIN_VALID_SLOTS",
    "_role_target_slots",
    "build_reference_clause",
    "build_system_video",
    # upgrade — pipeline
    "_run_upgrade_call",
    "_slot_label",
    "_build_matrix_directive_block",
    "upgrade_generate_prompt",
    "upgrade_edit_prompt",
    "upgrade_video_prompt",
]
