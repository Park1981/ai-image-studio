"""
comfy_api_builder.generate — Qwen Image 2512 (text-to-image) ComfyUI flat API 빌더.

GenerateApiInput dataclass + build_generate_api + build_generate_from_request 진입점.

Phase 4.5 단계 3 (2026-04-30) 분리.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..presets import (
    GENERATE_MODEL,
    LoraEntry,
    get_aspect,
    get_generate_style,
)
from ._common import (
    ApiPrompt,
    _apply_model_sampling,
    _build_loaders,
    _build_lora_chain,
    _make_id_gen,
    _save_image_node,
    _snap_dimension,
)


@dataclass
class GenerateApiInput:
    """Python-level 입력 값."""

    prompt: str
    """최종 영문 프롬프트 (gemma4 업그레이드 결과)."""

    negative_prompt: str
    """네거티브 프롬프트 (워크플로우 고정값)."""

    width: int
    height: int
    seed: int
    steps: int
    cfg: float
    sampler: str
    scheduler: str
    shift: float
    lightning: bool
    """True 면 Lightning LoRA 체인에 삽입."""

    unet_name: str
    clip_name: str
    vae_name: str
    extra_loras: list[LoraEntry]
    """role == 'extra' LoRA 들 (항상 적용)."""

    lightning_lora_name: str | None = None
    """Lightning LoRA 파일명. lightning=True 일 때만 사용."""

    filename_prefix: str = "AIS-Gen"


def build_generate_api(v: GenerateApiInput) -> ApiPrompt:
    """Generate 워크플로우를 API 포맷 dict 로 조립."""
    api: ApiPrompt = {}
    nid = _make_id_gen()

    # 1. Loaders + 2. LoRA 체인 + 3. ModelSamplingAuraFlow (공통 헬퍼)
    unet_id, clip_id, vae_id = _build_loaders(
        api, nid,
        unet_name=v.unet_name, clip_name=v.clip_name, vae_name=v.vae_name,
    )
    model_ref = _build_lora_chain(
        api, nid,
        base_model=[unet_id, 0],
        lightning=v.lightning,
        lightning_lora_name=v.lightning_lora_name,
        extra_loras=v.extra_loras,
    )
    model_ref = _apply_model_sampling(api, nid, model_ref=model_ref, shift=v.shift)

    # 4. CLIPTextEncode × 2 (pos/neg)
    pos_id = nid()
    api[pos_id] = {
        "class_type": "CLIPTextEncode",
        "_meta": {"title": "Positive"},
        "inputs": {"text": v.prompt, "clip": [clip_id, 0]},
    }
    neg_id = nid()
    api[neg_id] = {
        "class_type": "CLIPTextEncode",
        "_meta": {"title": "Negative"},
        "inputs": {"text": v.negative_prompt, "clip": [clip_id, 0]},
    }

    # 5. Latent 생성
    latent_id = nid()
    api[latent_id] = {
        "class_type": "EmptySD3LatentImage",
        "inputs": {
            "width": int(v.width),
            "height": int(v.height),
            "batch_size": 1,
        },
    }

    # 6. KSampler
    ksam_id = nid()
    api[ksam_id] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": int(v.seed),
            "steps": int(v.steps),
            "cfg": float(v.cfg),
            "sampler_name": v.sampler,
            "scheduler": v.scheduler,
            "denoise": 1.0,
            "model": model_ref,
            "positive": [pos_id, 0],
            "negative": [neg_id, 0],
            "latent_image": [latent_id, 0],
        },
    }

    # 7. VAEDecode + SaveImage
    dec_id = nid()
    api[dec_id] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": [ksam_id, 0], "vae": [vae_id, 0]},
    }
    _save_image_node(api, nid, decoded_ref=[dec_id, 0], filename_prefix=v.filename_prefix)

    return api


def build_generate_from_request(
    *,
    prompt: str,
    aspect_label: str,
    steps: int,
    cfg: float,
    seed: int,
    lightning: bool,
    width: int | None = None,
    height: int | None = None,
    style_id: str | None = None,
) -> ApiPrompt:
    """프리셋 + 요청값으로 한 방에 빌드.

    width/height 가 둘 다 주어지면 aspect_label 프리셋 대신 사용자 지정 사이즈 사용.
    내부에서 8의 배수 + 256~2048 clamp 로 정규화.

    style_id (2026-04-25): GENERATE_STYLES 의 id 와 매칭되면 자동으로:
        - LoRA 체인에 style.lora 추가 (extras 끝에)
        - sampling 파라미터 (steps/cfg/sampler/scheduler/shift) 를 style.sampling_override 로 교체
        - incompatible_with_lightning=True 면 lightning 강제 OFF
    """
    if width is not None and height is not None:
        resolved_w = _snap_dimension(width)
        resolved_h = _snap_dimension(height)
    else:
        aspect = get_aspect(aspect_label)
        resolved_w = aspect.width
        resolved_h = aspect.height
    d = GENERATE_MODEL.defaults
    lightning_lora = next(
        (lora for lora in GENERATE_MODEL.loras if lora.role == "lightning"),
        None,
    )
    extras = [lora for lora in GENERATE_MODEL.loras if lora.role == "extra"]

    # ── 스타일 프리셋 적용 (있으면 sampling 파라미터 + LoRA 체인 override + 트리거 prepend) ──
    style = get_generate_style(style_id)
    sampler_name = d.sampler
    scheduler_name = d.scheduler
    shift_value = d.shift
    if style is not None:
        # Lightning 비호환 → 강제 OFF (호출부에서도 처리하지만 안전망)
        if style.incompatible_with_lightning:
            lightning = False
        # sampling override (steps/cfg 는 이미 router 에서 override 후 들어왔다고 가정)
        sampler_name = style.sampling_override.sampler
        scheduler_name = style.sampling_override.scheduler
        shift_value = style.sampling_override.shift
        steps = style.sampling_override.steps
        cfg = style.sampling_override.cfg
        # LoRA 체인 — extras 끝에 style.lora 추가
        extras = [*extras, style.lora]
        # 트리거 prepend — gemma4 가 단어를 변환/번역해도 보장됨.
        # 이미 substring 으로 포함되어 있으면 skip (중복 방지). case-insensitive.
        trigger = style.trigger_prompt.strip()
        if trigger and trigger.lower() not in prompt.lower():
            prompt = f"{trigger}, {prompt}"

    inp = GenerateApiInput(
        prompt=prompt,
        negative_prompt=GENERATE_MODEL.negative_prompt,
        width=resolved_w,
        height=resolved_h,
        seed=seed,
        steps=steps,
        cfg=cfg,
        sampler=sampler_name,
        scheduler=scheduler_name,
        shift=shift_value,
        lightning=lightning,
        unet_name=GENERATE_MODEL.files.unet,
        clip_name=GENERATE_MODEL.files.clip,
        vae_name=GENERATE_MODEL.files.vae,
        extra_loras=extras,
        lightning_lora_name=lightning_lora.name if lightning_lora else None,
    )
    return build_generate_api(inp)
