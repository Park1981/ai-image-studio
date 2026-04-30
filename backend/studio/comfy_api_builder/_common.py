"""
comfy_api_builder._common — generate / edit / video 빌더 공용 데이터/헬퍼.

types (ApiPrompt / NodeRef) + log + 7 헬퍼 함수.
sub-module 들이 `from . import _common as _c` 또는 `from ._common import (...)` 직접 import.

Phase 4.5 단계 2 (2026-04-30) 분리.
codex C1 fix: log 를 _common 에 두고 모든 sub-module 공유 (build_edit_api L430 호환).
codex C2 fix: from ..presets import LoraEntry 명시 (_build_lora_chain L149 type annotation).
"""

from __future__ import annotations

import logging
from itertools import count
from typing import Any, Callable, Iterable

from ..presets import LoraEntry

log = logging.getLogger(__name__)

ApiPrompt = dict[str, dict[str, Any]]
NodeRef = list[Any]  # [node_id, output_slot] — ComfyUI API 형식


# ─────────────────────────────────
# 공통 빌더 Helpers
# ─────────────────────────────────


def _make_id_gen(start: int = 1) -> Callable[[], str]:
    """단조 증가 문자열 ID 생성기. itertools.count 기반."""
    counter = count(start)
    return lambda: str(next(counter))


def _snap_dimension(v: int) -> int:
    """Qwen/ComfyUI 권장 — 사이즈는 8의 배수 + 256~2048 clamp."""
    v = max(256, min(2048, int(v)))
    return (v // 8) * 8


def _build_loaders(
    api: ApiPrompt,
    nid: Callable[[], str],
    *,
    unet_name: str,
    clip_name: str,
    vae_name: str,
) -> tuple[str, str, str]:
    """UNETLoader + CLIPLoader(qwen_image) + VAELoader 3개 노드 생성.

    Returns:
        (unet_id, clip_id, vae_id)
    """
    unet_id = nid()
    api[unet_id] = {
        "class_type": "UNETLoader",
        "inputs": {"unet_name": unet_name, "weight_dtype": "default"},
    }
    clip_id = nid()
    api[clip_id] = {
        "class_type": "CLIPLoader",
        "inputs": {
            "clip_name": clip_name,
            "type": "qwen_image",
            "device": "default",
        },
    }
    vae_id = nid()
    api[vae_id] = {
        "class_type": "VAELoader",
        "inputs": {"vae_name": vae_name},
    }
    return unet_id, clip_id, vae_id


def _apply_lora_chain(
    api: ApiPrompt,
    nid: Callable[[], str],
    *,
    base_model: NodeRef,
    loras: Iterable[tuple[str, float]],
) -> NodeRef:
    """LoraLoaderModelOnly 노드 체인을 base_model 위에 순차 적용 (공용 헬퍼).

    2026-04-27 (Claude F): 이미지 (_build_lora_chain) + 영상 (_build_video_lora_chain)
    의 동일 LoraLoaderModelOnly 패턴을 단일 helper 로 추출 — 호출자는 (name, strength)
    리스트만 만들면 됨. 노드 class_type / input shape 변경 시 한 곳만 갱신.

    Args:
        loras: (lora_name, strength_model) 튜플 시퀀스. 비어있으면 base_model 그대로 반환.

    Returns:
        체인의 최종 NodeRef. loras 가 비어있으면 base_model 와 동일.
    """
    model_ref: NodeRef = base_model
    for name, strength in loras:
        lid = nid()
        api[lid] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": model_ref,
                "lora_name": name,
                "strength_model": float(strength),
            },
        }
        model_ref = [lid, 0]
    return model_ref


def _build_lora_chain(
    api: ApiPrompt,
    nid: Callable[[], str],
    *,
    base_model: NodeRef,
    lightning: bool,
    lightning_lora_name: str | None,
    extra_loras: list[LoraEntry],
) -> NodeRef:
    """Lightning (optional) + extras 체인을 base_model 위에 쌓아 최종 NodeRef 반환.

    체인 순서:
        base_model → [LightningLoRA 1.0] → [Extra LoRA n (strength 각각)] → ...

    2026-04-27 (Claude F): 핵심 노드 체인 로직은 _apply_lora_chain 위임.
    이 함수는 Lightning 분기를 처리해 (name, strength) 리스트를 만든다.
    """
    chain: list[tuple[str, float]] = []
    if lightning and lightning_lora_name:
        chain.append((lightning_lora_name, 1.0))
    for extra in extra_loras:
        chain.append((extra.name, float(extra.strength)))
    return _apply_lora_chain(api, nid, base_model=base_model, loras=chain)


def _apply_model_sampling(
    api: ApiPrompt,
    nid: Callable[[], str],
    *,
    model_ref: NodeRef,
    shift: float,
) -> NodeRef:
    """ModelSamplingAuraFlow 노드를 얹어 새 model_ref 반환."""
    shift_id = nid()
    api[shift_id] = {
        "class_type": "ModelSamplingAuraFlow",
        "inputs": {"model": model_ref, "shift": float(shift)},
    }
    return [shift_id, 0]


def _save_image_node(
    api: ApiPrompt,
    nid: Callable[[], str],
    *,
    decoded_ref: NodeRef,
    filename_prefix: str,
) -> str:
    """VAEDecode 결과를 받아 SaveImage 노드 생성, id 반환."""
    save_id = nid()
    api[save_id] = {
        "class_type": "SaveImage",
        "inputs": {
            "filename_prefix": filename_prefix,
            "images": decoded_ref,
        },
    }
    return save_id
