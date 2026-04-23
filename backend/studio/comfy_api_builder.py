"""
comfy_api_builder.py - ComfyUI API 포맷(flat graph) 프롬프트 빌더.

에디터 포맷 JSON 을 runtime 에 flatten 하는 대신, Python 에서 목표 결과를
직접 조립. Qwen Image 2512 / Edit 2511 워크플로우에 특화.

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

구성 방식: 각 노드에 정수 id 부여 → body dict 에 문자열 key 로 삽입.
체인 모양:
    UNETLoader → [LoraLoaderModelOnly (Lightning? optional)] → [LoraLoaderModelOnly (Extra?)] →
    ModelSamplingAuraFlow → KSampler → VAEDecode → SaveImage
    (positive/negative 는 별도 CLIPTextEncode, 샘플러로 주입)
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import count
from typing import Any, Callable

from .presets import EDIT_MODEL, GENERATE_MODEL, LoraEntry, get_aspect


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
    """
    model_ref: NodeRef = base_model
    if lightning and lightning_lora_name:
        light_id = nid()
        api[light_id] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": model_ref,
                "lora_name": lightning_lora_name,
                "strength_model": 1.0,
            },
        }
        model_ref = [light_id, 0]
    for extra in extra_loras:
        ex_id = nid()
        api[ex_id] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": model_ref,
                "lora_name": extra.name,
                "strength_model": float(extra.strength),
            },
        }
        model_ref = [ex_id, 0]
    return model_ref


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


# ─────────────────────────────────
# Generate (text-to-image)
# ─────────────────────────────────


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
) -> ApiPrompt:
    """프리셋 + 요청값으로 한 방에 빌드.

    width/height 가 둘 다 주어지면 aspect_label 프리셋 대신 사용자 지정 사이즈 사용.
    내부에서 8의 배수 + 256~2048 clamp 로 정규화.
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
        (l for l in GENERATE_MODEL.loras if l.role == "lightning"),
        None,
    )
    extras = [l for l in GENERATE_MODEL.loras if l.role == "extra"]

    inp = GenerateApiInput(
        prompt=prompt,
        negative_prompt=GENERATE_MODEL.negative_prompt,
        width=resolved_w,
        height=resolved_h,
        seed=seed,
        steps=steps,
        cfg=cfg,
        sampler=d.sampler,
        scheduler=d.scheduler,
        shift=d.shift,
        lightning=lightning,
        unet_name=GENERATE_MODEL.files.unet,
        clip_name=GENERATE_MODEL.files.clip,
        vae_name=GENERATE_MODEL.files.vae,
        extra_loras=extras,
        lightning_lora_name=lightning_lora.name if lightning_lora else None,
    )
    return build_generate_api(inp)


# ─────────────────────────────────
# Edit (image-to-image, Qwen Edit 2511)
# ─────────────────────────────────


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
    filename_prefix: str = "AIS-Edit"


def build_edit_api(v: EditApiInput) -> ApiPrompt:
    """Edit 워크플로우 API 포맷 조립 (Qwen Image Edit 2511)."""
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


def build_edit_from_request(
    *,
    prompt: str,
    source_filename: str,
    seed: int,
    lightning: bool,
) -> ApiPrompt:
    d = EDIT_MODEL.defaults
    lightning_lora = next(
        (l for l in EDIT_MODEL.loras if l.role == "lightning"),
        None,
    )
    extras = [l for l in EDIT_MODEL.loras if l.role == "extra"]

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
    )
    return build_edit_api(inp)
