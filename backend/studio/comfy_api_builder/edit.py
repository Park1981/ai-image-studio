"""
comfy_api_builder.edit — Qwen Image Edit 2511 (image-to-image + multi-ref) ComfyUI flat API 빌더.

EditApiInput dataclass + build_edit_api dispatcher (single vs multi-ref) +
_multi_ref_negative_prompt / _build_edit_api_single / _build_edit_api_multi_ref +
build_edit_from_request 진입점.

Phase 4.5 단계 4 (2026-04-30) 분리.
codex C1 fix: from ._common import log (build_edit_api L430 의 log.info 호환).
"""

from __future__ import annotations

from dataclasses import dataclass

from ..presets import EDIT_MODEL, LoraEntry
from ._common import (
    ApiPrompt,
    _apply_model_sampling,
    _build_loaders,
    _build_lora_chain,
    _make_id_gen,
    _save_image_node,
    log,
)


@dataclass
class EditApiInput:
    prompt: str
    source_image_filename: str
    """ComfyUI `input/` 폴더 안에 올려둔 파일명 (LoadImage 로 읽음)."""

    seed: int
    steps: int
    cfg: float
    sampler: str
    scheduler: str
    shift: float
    lightning: bool

    unet_name: str
    clip_name: str
    vae_name: str
    extra_loras: list[LoraEntry]
    lightning_lora_name: str | None = None
    # Multi-reference (2026-04-27): image2 추가 입력 — 토글 OFF 면 None.
    # ON 시 ComfyUI input/ 에 업로드된 두번째 파일명 + role 명시.
    reference_image_filename: str | None = None
    reference_role: str | None = None
    filename_prefix: str = "AIS-Edit"


def build_edit_api(v: EditApiInput) -> ApiPrompt:
    """Edit 워크플로우 API 포맷 조립 (Qwen Image Edit 2511).

    Multi-ref 분기 (2026-04-27): reference 미사용이면 옛 단일 이미지 path 그대로.
    reference_image_filename 이 None 이면 옛 코드와 100% 동일한 결과 반환 → 회귀 위험 0.
    """
    log.info(
        "build_edit_api: reference_image_filename=%r reference_role=%r",
        v.reference_image_filename,
        v.reference_role,
    )
    if v.reference_image_filename is None:
        return _build_edit_api_single(v)
    return _build_edit_api_multi_ref(v)


def _multi_ref_negative_prompt(reference_role: str | None) -> str:
    """Role-aware negative prompt for unwanted image2 transfer."""
    if reference_role == "face":
        return (
            "image2 hair, image2 hairstyle, image2 hair color, image2 body, "
            "image2 body shape, image2 pose, image2 clothing, image2 outfit, "
            "image2 jewelry, image2 accessories, image2 background, "
            "image2 environment, image2 lighting, changing image1 background, "
            "changing image1 body pose, changing image1 hair"
        )
    if reference_role == "outfit":
        return (
            "image2 face, image2 facial identity, image2 hair, image2 pose, "
            "image2 body shape, image2 background, image2 environment, "
            "changing image1 face, changing image1 pose, changing image1 background"
        )
    if reference_role == "background":
        return (
            "image2 face, image2 body, image2 clothing, image2 pose, "
            "changing image1 subject identity, changing image1 subject pose"
        )
    if reference_role == "style":
        return (
            "image2 subject identity, image2 face, image2 body, image2 pose, "
            "image2 clothing, image2 background layout, changing image1 composition"
        )
    return ""


def _build_edit_api_single(v: EditApiInput) -> ApiPrompt:
    """옛 단일 이미지 흐름 (image1 만). build_edit_api 본체 그대로."""
    api: ApiPrompt = {}
    nid = _make_id_gen()

    # Loaders (공통 헬퍼)
    unet_id, clip_id, vae_id = _build_loaders(
        api, nid,
        unet_name=v.unet_name, clip_name=v.clip_name, vae_name=v.vae_name,
    )

    # LoadImage + FluxKontextImageScale (원본 이미지 자동 스케일)
    load_id = nid()
    api[load_id] = {
        "class_type": "LoadImage",
        "inputs": {"image": v.source_image_filename, "upload": "image"},
    }
    scale_id = nid()
    api[scale_id] = {
        "class_type": "FluxKontextImageScale",
        "inputs": {"image": [load_id, 0]},
    }

    # Model chain: UNET → (Lightning LoRA?) → (extra LoRAs) → ModelSamplingAuraFlow → CFGNorm
    model_ref = _build_lora_chain(
        api, nid,
        base_model=[unet_id, 0],
        lightning=v.lightning,
        lightning_lora_name=v.lightning_lora_name,
        extra_loras=v.extra_loras,
    )
    model_ref = _apply_model_sampling(api, nid, model_ref=model_ref, shift=v.shift)

    # Edit 모드 전용: CFGNorm 추가 (guidance 안정화)
    cfgnorm_id = nid()
    api[cfgnorm_id] = {
        "class_type": "CFGNorm",
        "inputs": {"model": model_ref, "strength": 1.0},
    }
    model_ref = [cfgnorm_id, 0]

    # TextEncodeQwenImageEditPlus × 2 (pos+neg)
    # positive: 사용자 프롬프트 + 이미지1
    pos_enc_id = nid()
    api[pos_enc_id] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "_meta": {"title": "Positive"},
        "inputs": {
            "clip": [clip_id, 0],
            "vae": [vae_id, 0],
            "image1": [scale_id, 0],
            "prompt": v.prompt,
        },
    }
    neg_enc_id = nid()
    api[neg_enc_id] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "_meta": {"title": "Negative"},
        "inputs": {
            "clip": [clip_id, 0],
            "vae": [vae_id, 0],
            "image1": [scale_id, 0],
            "prompt": "",
        },
    }

    # FluxKontextMultiReferenceLatentMethod × 2
    pos_ref_id = nid()
    api[pos_ref_id] = {
        "class_type": "FluxKontextMultiReferenceLatentMethod",
        "inputs": {
            "conditioning": [pos_enc_id, 0],
            "reference_latents_method": "index_timestep_zero",
        },
    }
    neg_ref_id = nid()
    api[neg_ref_id] = {
        "class_type": "FluxKontextMultiReferenceLatentMethod",
        "inputs": {
            "conditioning": [neg_enc_id, 0],
            "reference_latents_method": "index_timestep_zero",
        },
    }

    # VAEEncode (원본 → latent)
    encode_id = nid()
    api[encode_id] = {
        "class_type": "VAEEncode",
        "inputs": {"pixels": [scale_id, 0], "vae": [vae_id, 0]},
    }

    # KSampler
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
            "positive": [pos_ref_id, 0],
            "negative": [neg_ref_id, 0],
            "latent_image": [encode_id, 0],
        },
    }

    # VAEDecode + SaveImage
    dec_id = nid()
    api[dec_id] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": [ksam_id, 0], "vae": [vae_id, 0]},
    }
    _save_image_node(api, nid, decoded_ref=[dec_id, 0], filename_prefix=v.filename_prefix)

    return api


def _build_edit_api_multi_ref(v: EditApiInput) -> ApiPrompt:
    """Multi-reference 흐름 — image1 + image2 둘 다 LoadImage + FluxKontextImageScale.

    TextEncodeQwenImageEditPlus 의 image1/image2 슬롯 둘 다 채움.
    KSampler latent 는 image1 (편집 대상) 만 별도 VAEEncode.
    image2 는 TextEncodeQwenImageEditPlus 내부에서 vae 인자로 reference latent 자동 인코딩
    (ComfyUI 의 Qwen Edit Plus 노드 동작 — Codex 리뷰 검증).

    2026-04-27 Phase 4 Task 15: stub 폴백 → 진짜 노드 체인.
    """
    api: ApiPrompt = {}
    nid = _make_id_gen()

    # Loaders (공통 헬퍼)
    unet_id, clip_id, vae_id = _build_loaders(
        api, nid,
        unet_name=v.unet_name, clip_name=v.clip_name, vae_name=v.vae_name,
    )

    # Image1 (편집 대상) — LoadImage + FluxKontextImageScale
    load1_id = nid()
    api[load1_id] = {
        "class_type": "LoadImage",
        "inputs": {"image": v.source_image_filename, "upload": "image"},
    }
    scale1_id = nid()
    api[scale1_id] = {
        "class_type": "FluxKontextImageScale",
        "inputs": {"image": [load1_id, 0]},
    }

    # Image2 (참조) — 동일 패턴.
    # reference_image_filename 은 None 이 아닌 게 보장됨 (build_edit_api 분기에서).
    assert v.reference_image_filename is not None
    load2_id = nid()
    api[load2_id] = {
        "class_type": "LoadImage",
        "inputs": {"image": v.reference_image_filename, "upload": "image"},
    }
    scale2_id = nid()
    api[scale2_id] = {
        "class_type": "FluxKontextImageScale",
        "inputs": {"image": [load2_id, 0]},
    }

    # Model chain (단일 path 와 동일)
    model_ref = _build_lora_chain(
        api, nid,
        base_model=[unet_id, 0],
        lightning=v.lightning,
        lightning_lora_name=v.lightning_lora_name,
        extra_loras=v.extra_loras,
    )
    model_ref = _apply_model_sampling(api, nid, model_ref=model_ref, shift=v.shift)
    cfgnorm_id = nid()
    api[cfgnorm_id] = {
        "class_type": "CFGNorm",
        "inputs": {"model": model_ref, "strength": 1.0},
    }
    model_ref = [cfgnorm_id, 0]

    # TextEncodeQwenImageEditPlus × 2 (pos+neg) — image1 + image2 둘 다 슬롯에 연결.
    neg_prompt_text = _multi_ref_negative_prompt(v.reference_role)
    pos_enc_id = nid()
    api[pos_enc_id] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "_meta": {"title": "Positive"},
        "inputs": {
            "clip": [clip_id, 0],
            "vae": [vae_id, 0],
            "image1": [scale1_id, 0],
            "image2": [scale2_id, 0],
            "prompt": v.prompt,
        },
    }
    neg_enc_id = nid()
    api[neg_enc_id] = {
        "class_type": "TextEncodeQwenImageEditPlus",
        "_meta": {"title": "Negative"},
        "inputs": {
            "clip": [clip_id, 0],
            "vae": [vae_id, 0],
            "image1": [scale1_id, 0],
            "image2": [scale2_id, 0],
            "prompt": neg_prompt_text,
        },
    }

    # FluxKontextMultiReferenceLatentMethod × 2 (단일 path 와 동일)
    pos_ref_id = nid()
    api[pos_ref_id] = {
        "class_type": "FluxKontextMultiReferenceLatentMethod",
        "inputs": {
            "conditioning": [pos_enc_id, 0],
            "reference_latents_method": "index_timestep_zero",
        },
    }
    neg_ref_id = nid()
    api[neg_ref_id] = {
        "class_type": "FluxKontextMultiReferenceLatentMethod",
        "inputs": {
            "conditioning": [neg_enc_id, 0],
            "reference_latents_method": "index_timestep_zero",
        },
    }

    # VAEEncode — KSampler latent 는 image1 만.
    # (image2 는 TextEncodeQwenImageEditPlus 내부에서 reference 인코딩 — Qwen Edit Plus 노드 동작)
    encode_id = nid()
    api[encode_id] = {
        "class_type": "VAEEncode",
        "inputs": {"pixels": [scale1_id, 0], "vae": [vae_id, 0]},
    }

    # KSampler + VAEDecode + SaveImage (단일 path 와 동일)
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
            "positive": [pos_ref_id, 0],
            "negative": [neg_ref_id, 0],
            "latent_image": [encode_id, 0],
        },
    }

    decode_id = nid()
    api[decode_id] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": [ksam_id, 0], "vae": [vae_id, 0]},
    }

    _save_image_node(
        api, nid, decoded_ref=[decode_id, 0], filename_prefix=v.filename_prefix
    )

    return api


def build_edit_from_request(
    *,
    prompt: str,
    source_filename: str,
    seed: int,
    lightning: bool,
    reference_image_filename: str | None = None,
    reference_role: str | None = None,
) -> ApiPrompt:
    d = EDIT_MODEL.defaults
    lightning_lora = next(
        (lora for lora in EDIT_MODEL.loras if lora.role == "lightning"),
        None,
    )
    extras = [lora for lora in EDIT_MODEL.loras if lora.role == "extra"]

    steps = EDIT_MODEL.lightning.steps if lightning else d.steps
    cfg = EDIT_MODEL.lightning.cfg if lightning else d.cfg

    inp = EditApiInput(
        prompt=prompt,
        source_image_filename=source_filename,
        seed=seed,
        steps=steps,
        cfg=cfg,
        sampler=d.sampler,
        scheduler=d.scheduler,
        shift=d.shift,
        lightning=lightning,
        unet_name=EDIT_MODEL.files.unet,
        clip_name=EDIT_MODEL.files.clip,
        vae_name=EDIT_MODEL.files.vae,
        extra_loras=extras,
        lightning_lora_name=lightning_lora.name if lightning_lora else None,
        reference_image_filename=reference_image_filename,
        reference_role=reference_role,
    )
    return build_edit_api(inp)
