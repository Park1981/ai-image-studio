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

from .presets import (
    EDIT_MODEL,
    GENERATE_MODEL,
    LoraEntry,
    VIDEO_MODEL,
    VideoLoraEntry,
    get_aspect,
    resolve_video_unet_name,
)


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


# ═════════════════════════════════════════════════════════════════════
# Video — LTX-2.3 Image-to-Video (2-stage sampling + AV concat)
# ═════════════════════════════════════════════════════════════════════
# 출처 워크플로우: Comfy-Org/workflow_templates/templates/video_ltx2_3_i2v.json
#
# 전체 47노드 subgraph 에서 Primitive/MathExpression/Reroute 를 Python 에서
# 미리 계산해 에센셜 35 노드만 flat API 로 조립. presets.py 의 VIDEO_MODEL
# 에서 모든 수치/파일명 참조.
# ═════════════════════════════════════════════════════════════════════


def _build_video_lora_chain(
    api: ApiPrompt,
    nid: Callable[[], str],
    *,
    base_model: NodeRef,
    loras: list[VideoLoraEntry],
) -> NodeRef:
    """VideoLoraEntry 리스트를 순차 적용. (lightning 토글 없음, 전부 고정 적용)"""
    model_ref = base_model
    for lora in loras:
        lid = nid()
        api[lid] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": model_ref,
                "lora_name": lora.name,
                "strength_model": float(lora.strength),
            },
        }
        model_ref = [lid, 0]
    return model_ref


def build_video_from_request(
    *,
    prompt: str,
    source_filename: str,
    seed: int,
    negative_prompt: str | None = None,
    unet_override: str | None = None,
) -> ApiPrompt:
    """LTX-2.3 i2v 워크플로우 API 포맷 조립.

    Args:
        prompt: gemma4 업그레이드 결과 (영문)
        source_filename: ComfyUI input/ 에 업로드된 파일명
        seed: base stage RandomNoise 시드 (upscale stage 는 런타임 random)
        negative_prompt: 기본은 VIDEO_MODEL.negative_prompt
        unet_override: VRAM 16GB 대응용 · Kijai transformer_only 등 파일명

    Returns:
        ComfyUI /prompt 용 flat dict (35개 에센셜 노드).
    """
    api: ApiPrompt = {}
    nid = _make_id_gen()
    s = VIDEO_MODEL.sampling
    neg = negative_prompt or VIDEO_MODEL.negative_prompt
    unet_name = resolve_video_unet_name(unet_override)

    # ── 0. Image input (사용자 업로드) ──
    load_id = nid()
    api[load_id] = {
        "class_type": "LoadImage",
        "inputs": {"image": source_filename, "upload": "image"},
    }

    # ── 1. Pre-resize (ResizeImageMaskNode · 포트레이트 박스 fit) ──
    # resize_type 은 DYNAMICCOMBO — 선택값에 따라 서브필드 추가.
    # "scale dimensions" 는 width/height/crop 3 서브필드 요구.
    # scale_method 는 독립 top-level 필드.
    resize1_id = nid()
    api[resize1_id] = {
        "class_type": "ResizeImageMaskNode",
        "inputs": {
            "input": [load_id, 0],
            "resize_type": s.pre_resize_mode,
            "resize_type.width": s.pre_resize_width,
            "resize_type.height": s.pre_resize_height,
            "resize_type.crop": s.pre_resize_crop,
            "scale_method": s.pre_resize_scale_method,
        },
    }

    # ── 2. Longer-edge 리사이즈 (ResizeImagesByLongerEdge) ──
    resize2_id = nid()
    api[resize2_id] = {
        "class_type": "ResizeImagesByLongerEdge",
        "inputs": {
            "images": [resize1_id, 0],
            "longer_edge": s.longer_edge,
        },
    }

    # ── 3. LTXV 이미지 전처리 ──
    preprocess_id = nid()
    api[preprocess_id] = {
        "class_type": "LTXVPreprocess",
        "inputs": {
            "image": [resize2_id, 0],
            "img_compression": s.preprocess_img_compression,
        },
    }

    # ── 4. 체크포인트 + 텍스트 인코더 + 오디오 VAE + 업스케일러 로더 ──
    ckpt_id = nid()
    api[ckpt_id] = {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": unet_name},
    }
    text_encoder_id = nid()
    api[text_encoder_id] = {
        "class_type": "LTXAVTextEncoderLoader",
        "inputs": {
            "text_encoder": VIDEO_MODEL.files.text_encoder,
            "ckpt_name": unet_name,
            "device": VIDEO_MODEL.files.weight_dtype,  # "default" 등
        },
    }
    audio_vae_id = nid()
    api[audio_vae_id] = {
        "class_type": "LTXVAudioVAELoader",
        "inputs": {"ckpt_name": unet_name},
    }
    upscaler_id = nid()
    api[upscaler_id] = {
        "class_type": "LatentUpscaleModelLoader",
        "inputs": {"model_name": VIDEO_MODEL.files.upscaler},
    }

    # ── 5. LoRA 체인 (순차 3단) ──
    model_ref = _build_video_lora_chain(
        api, nid,
        base_model=[ckpt_id, 0],
        loras=VIDEO_MODEL.loras,
    )

    # ── 6. CLIPTextEncode (positive · negative) ──
    pos_encode_id = nid()
    api[pos_encode_id] = {
        "class_type": "CLIPTextEncode",
        "_meta": {"title": "Positive"},
        "inputs": {"clip": [text_encoder_id, 0], "text": prompt},
    }
    neg_encode_id = nid()
    api[neg_encode_id] = {
        "class_type": "CLIPTextEncode",
        "_meta": {"title": "Negative"},
        "inputs": {"clip": [text_encoder_id, 0], "text": neg},
    }

    # ── 7. LTXVConditioning (pos/neg/frame_rate 통합) ──
    cond_id = nid()
    api[cond_id] = {
        "class_type": "LTXVConditioning",
        "inputs": {
            "positive": [pos_encode_id, 0],
            "negative": [neg_encode_id, 0],
            "frame_rate": float(s.fps),
        },
    }

    # ── 8. Empty latents (video · audio) ──
    empty_vid_id = nid()
    api[empty_vid_id] = {
        "class_type": "EmptyLTXVLatentVideo",
        "inputs": {
            "width": s.latent_width,
            "height": s.latent_height,
            "length": s.frame_count,
            "batch_size": s.batch_size,
        },
    }
    empty_aud_id = nid()
    api[empty_aud_id] = {
        "class_type": "LTXVEmptyLatentAudio",
        "inputs": {
            "audio_vae": [audio_vae_id, 0],
            "frames_number": s.audio_frames,
            "frame_rate": s.audio_frame_rate,
            "batch_size": s.audio_channels,
        },
    }

    # ══════════════════════════════════════════════════════
    # Stage 1: Base sampling (126 frames latent · AV concat)
    # ══════════════════════════════════════════════════════

    # 원본 이미지를 첫 프레임으로 가진 latent video 생성 (base)
    img2vid_base_id = nid()
    api[img2vid_base_id] = {
        "class_type": "LTXVImgToVideoInplace",
        "inputs": {
            "vae": [ckpt_id, 2],  # Checkpoint 의 VAE output slot (보통 index 2)
            "image": [preprocess_id, 0],
            "latent": [empty_vid_id, 0],
            "strength": s.imgtovideo_first_strength,
            "bypass": s.imgtovideo_bypass,
        },
    }

    # AV 통합 latent
    concat_base_id = nid()
    api[concat_base_id] = {
        "class_type": "LTXVConcatAVLatent",
        "inputs": {
            "video_latent": [img2vid_base_id, 0],
            "audio_latent": [empty_aud_id, 0],
        },
    }

    # Base sampling 구성
    noise_base_id = nid()
    api[noise_base_id] = {
        "class_type": "RandomNoise",
        "inputs": {"noise_seed": int(seed)},
    }
    sampler_base_id = nid()
    api[sampler_base_id] = {
        "class_type": "KSamplerSelect",
        "inputs": {"sampler_name": s.base_sampler},
    }
    sigmas_base_id = nid()
    api[sigmas_base_id] = {
        "class_type": "ManualSigmas",
        "inputs": {"sigmas": s.base_sigmas},
    }
    guider_base_id = nid()
    api[guider_base_id] = {
        "class_type": "CFGGuider",
        "inputs": {
            "model": model_ref,
            "positive": [cond_id, 0],
            "negative": [cond_id, 1],
            "cfg": s.base_cfg,
        },
    }
    sample_base_id = nid()
    api[sample_base_id] = {
        "class_type": "SamplerCustomAdvanced",
        "inputs": {
            "noise": [noise_base_id, 0],
            "guider": [guider_base_id, 0],
            "sampler": [sampler_base_id, 0],
            "sigmas": [sigmas_base_id, 0],
            "latent_image": [concat_base_id, 0],
        },
    }

    # Base stage 출력 AV 분리
    sep_base_id = nid()
    api[sep_base_id] = {
        "class_type": "LTXVSeparateAVLatent",
        "inputs": {"av_latent": [sample_base_id, 0]},
    }

    # ══════════════════════════════════════════════════════
    # Stage 2: Upscale sampling (Spatial upsampler + 재샘플링)
    # ══════════════════════════════════════════════════════

    upsampler_id = nid()
    api[upsampler_id] = {
        "class_type": "LTXVLatentUpsampler",
        "inputs": {
            "samples": [sep_base_id, 0],  # video latent (slot 0)
            "upscale_model": [upscaler_id, 0],
            "vae": [ckpt_id, 2],
        },
    }

    img2vid_up_id = nid()
    api[img2vid_up_id] = {
        "class_type": "LTXVImgToVideoInplace",
        "inputs": {
            "vae": [ckpt_id, 2],
            "image": [preprocess_id, 0],
            "latent": [upsampler_id, 0],
            "strength": s.imgtovideo_second_strength,
            "bypass": s.imgtovideo_bypass,
        },
    }

    concat_up_id = nid()
    api[concat_up_id] = {
        "class_type": "LTXVConcatAVLatent",
        "inputs": {
            "video_latent": [img2vid_up_id, 0],
            "audio_latent": [sep_base_id, 1],  # audio latent (slot 1)
        },
    }

    # Crop guides (pos/neg 조정 · base video latent 기반)
    crop_id = nid()
    api[crop_id] = {
        "class_type": "LTXVCropGuides",
        "inputs": {
            "positive": [cond_id, 0],
            "negative": [cond_id, 1],
            "latent": [sep_base_id, 0],
        },
    }

    # Upscale sampling 구성 (noise 는 런타임 random — seed+1 로 달리 줌)
    noise_up_id = nid()
    api[noise_up_id] = {
        "class_type": "RandomNoise",
        "inputs": {"noise_seed": int(seed) + 1},
    }
    sampler_up_id = nid()
    api[sampler_up_id] = {
        "class_type": "KSamplerSelect",
        "inputs": {"sampler_name": s.upscale_sampler},
    }
    sigmas_up_id = nid()
    api[sigmas_up_id] = {
        "class_type": "ManualSigmas",
        "inputs": {"sigmas": s.upscale_sigmas},
    }
    guider_up_id = nid()
    api[guider_up_id] = {
        "class_type": "CFGGuider",
        "inputs": {
            "model": model_ref,
            "positive": [crop_id, 0],
            "negative": [crop_id, 1],
            "cfg": s.upscale_cfg,
        },
    }
    sample_up_id = nid()
    api[sample_up_id] = {
        "class_type": "SamplerCustomAdvanced",
        "inputs": {
            "noise": [noise_up_id, 0],
            "guider": [guider_up_id, 0],
            "sampler": [sampler_up_id, 0],
            "sigmas": [sigmas_up_id, 0],
            "latent_image": [concat_up_id, 0],
        },
    }
    sep_up_id = nid()
    api[sep_up_id] = {
        "class_type": "LTXVSeparateAVLatent",
        "inputs": {"av_latent": [sample_up_id, 0]},
    }

    # ══════════════════════════════════════════════════════
    # Decode + CreateVideo + SaveVideo
    # ══════════════════════════════════════════════════════

    vae_decode_id = nid()
    api[vae_decode_id] = {
        "class_type": "VAEDecodeTiled",
        "inputs": {
            "samples": [sep_up_id, 0],
            "vae": [ckpt_id, 2],
            "tile_size": s.vae_decode_tile_size,
            "overlap": s.vae_decode_overlap,
            "temporal_size": s.vae_decode_temporal,
            "temporal_overlap": s.vae_decode_temporal_overlap,
        },
    }
    audio_decode_id = nid()
    api[audio_decode_id] = {
        "class_type": "LTXVAudioVAEDecode",
        "inputs": {
            "samples": [sep_up_id, 1],
            "audio_vae": [audio_vae_id, 0],
        },
    }

    create_video_id = nid()
    api[create_video_id] = {
        "class_type": "CreateVideo",
        "inputs": {
            "images": [vae_decode_id, 0],
            "audio": [audio_decode_id, 0],
            "fps": float(s.fps),
        },
    }

    save_id = nid()
    api[save_id] = {
        "class_type": "SaveVideo",
        "inputs": {
            "video": [create_video_id, 0],
            "filename_prefix": "AIS-Video",
            "format": s.save_format,
            "codec": s.save_codec,
        },
    }

    return api
