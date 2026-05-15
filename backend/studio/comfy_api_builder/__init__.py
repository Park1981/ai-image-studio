"""
comfy_api_builder — ComfyUI API 포맷(flat graph) 프롬프트 빌더 facade.

에디터 포맷 JSON 을 runtime 에 flatten 하는 대신, Python 에서 목표 결과를
직접 조립. Qwen Image 2512 (생성) / Edit 2511 (수정) / LTX Video 2.3 (영상)
워크플로우에 특화.

ComfyUI `/prompt` 엔드포인트는 다음 형식의 dict 를 기대한다:

    {
      "<node_id_str>": {
        "class_type": "<ComfyUI node class>",
        "inputs": {
          "<param>": <직접값> | [<source_node_id_str>, <output_slot_int>]
        }
      },
      ...
    }

Phase 4.5 (2026-04-30) 4 sub-module 분할:
- _common: ApiPrompt / NodeRef types + log + 7 헬퍼 (_make_id_gen / _snap_dimension /
           _build_loaders / _apply_lora_chain / _build_lora_chain /
           _apply_model_sampling / _save_image_node)
- generate: GenerateApiInput / build_generate_api / build_generate_from_request
- edit: EditApiInput / build_edit_api dispatcher / _multi_ref_negative_prompt /
        _build_edit_api_single / _build_edit_api_multi_ref / build_edit_from_request
- video: _build_video_lora_chain / build_video_from_request (LTX-2.3 i2v 2-stage)

신규 코드는 sub-module 직접 import 권장. mock.patch 0건 (Phase 4.5 의 가장 큰 안전).
"""

from __future__ import annotations

from ._common import (  # noqa: F401 — facade re-export (production + test 호환)
    ApiPrompt,
    NodeRef,
    _apply_lora_chain,
    _apply_model_sampling,
    _build_loaders,
    _build_lora_chain,
    _make_id_gen,
    _save_image_node,
    _snap_dimension,
    log,
)
from .edit import (  # noqa: F401 — facade re-export
    EditApiInput,
    _build_edit_api_multi_ref,
    _build_edit_api_single,
    _multi_ref_negative_prompt,
    build_edit_api,
    build_edit_from_request,
)
from .generate import (  # noqa: F401 — facade re-export
    GenerateApiInput,
    build_generate_api,
    build_generate_from_request,
)
from .video import (  # noqa: F401 — facade re-export
    _build_video_lora_chain,
    build_ltx_from_model_preset,
    build_video_from_request,
)
from .video_lab import (  # noqa: F401 — facade re-export
    build_ltx_lab_from_request,
    resolve_lab_video_loras,
)

__all__ = [
    # _common — types
    "ApiPrompt",
    "NodeRef",
    # _common — helpers
    "log",
    "_make_id_gen",
    "_snap_dimension",
    "_build_loaders",
    "_apply_lora_chain",
    "_build_lora_chain",
    "_apply_model_sampling",
    "_save_image_node",
    # generate
    "GenerateApiInput",
    "build_generate_api",
    "build_generate_from_request",
    # edit
    "EditApiInput",
    "build_edit_api",
    "_multi_ref_negative_prompt",
    "_build_edit_api_single",
    "_build_edit_api_multi_ref",
    "build_edit_from_request",
    # video
    "_build_video_lora_chain",
    "build_ltx_from_model_preset",
    "build_video_from_request",
    "build_ltx_lab_from_request",
    "resolve_lab_video_loras",
]
