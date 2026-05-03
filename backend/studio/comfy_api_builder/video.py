"""
comfy_api_builder.video — 영상 빌더 (LTX-2.3 + Wan 2.2 i2v 듀얼).

2026-05-03 (Phase 2): build_video_from_request 가 model_id 분기 facade 로 변경.
 - LTX: 기존 본문 → _build_ltx 로 캡슐화 (변경 X)
 - Wan 2.2: _build_wan22 신규 (UnetLoaderGGUF × 2 + 2-stage KSamplerAdvanced)

기존 진입점 (build_video_from_request) 시그니처 호환 (model_id 추가만).

Phase 4.5 단계 5 (2026-04-30) 분리 → Phase 2 (2026-05-03) 듀얼 확장.
"""

from __future__ import annotations

from typing import Callable

from ..presets import (
    DEFAULT_VIDEO_MODEL_ID,
    LTX_VIDEO_PRESET,
    QUALITY_BASE_SIGMAS,
    QUALITY_UPSCALE_SIGMAS,
    VIDEO_LONGER_EDGE_DEFAULT,
    VIDEO_MODEL,  # 호환 alias (== LTX_VIDEO_PRESET) — 기존 테스트 호환용
    VideoLoraEntry,
    VideoModelId,
    WAN22_VIDEO_PRESET,
    active_video_loras,
    compute_video_resize,
    resolve_video_unet_name,
)
from ._common import (
    ApiPrompt,
    NodeRef,
    _apply_lora_chain,
    _make_id_gen,
)


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
    """VideoLoraEntry 리스트를 순차 적용. (lightning 토글 없음, 전부 고정 적용)

    2026-04-27 (Claude F): 노드 체인 자체는 _apply_lora_chain 공유 (이미지와 동일 패턴).
    """
    return _apply_lora_chain(
        api, nid,
        base_model=base_model,
        loras=[(lora.name, float(lora.strength)) for lora in loras],
    )


def build_video_from_request(
    *,
    model_id: VideoModelId = DEFAULT_VIDEO_MODEL_ID,
    prompt: str,
    source_filename: str,
    seed: int,
    negative_prompt: str | None = None,
    unet_override: str | None = None,
    adult: bool = False,
    source_width: int | None = None,
    source_height: int | None = None,
    longer_edge: int | None = None,
    lightning: bool = True,
) -> ApiPrompt:
    """영상 빌더 facade — model_id 분기 (Phase 2 도입).

    spec §4.2 / 사용자 결정 #1 — default model_id="wan22" (Wan 2.2 i2v).

    Args:
        model_id: "ltx" | "wan22" — preset / 노드 그래프 분기.
            기존 코드 (model_id 미지정) 는 default Wan 22 로 흐름 — 회귀 깨질 수 있어
            기존 LTX 테스트는 model_id="ltx" 명시 추가 필요.
        prompt: gemma4 업그레이드 결과 (영문)
        source_filename: ComfyUI input/ 에 업로드된 파일명
        seed: base stage 시드 (LTX: upscale stage 는 seed+1 / Wan: high+low 동일 seed)
        negative_prompt: 기본은 preset.negative_prompt
        unet_override: LTX 전용 — VRAM 16GB 대응용 Kijai transformer_only 등 (Wan 무시)
        adult: LTX 전용 — 성인 모드 토글 (Wan 무시 · LoRA 정책 다름)
        source_width / source_height: 원본 이미지 dims · 비율 유지 리사이즈
        longer_edge: 사용자 지정 긴 변 픽셀 (512~1536, step 128). 모델별 default.
        lightning: 4-step 초고속 모드 (LTX: distilled LoRA / Wan: lightx2v LoRA).

    Returns:
        ComfyUI /prompt 용 flat dict.
    """
    if model_id == "ltx":
        return _build_ltx(
            prompt=prompt,
            source_filename=source_filename,
            seed=seed,
            negative_prompt=negative_prompt,
            unet_override=unet_override,
            adult=adult,
            source_width=source_width,
            source_height=source_height,
            longer_edge=longer_edge,
            lightning=lightning,
        )
    if model_id == "wan22":
        return _build_wan22(
            prompt=prompt,
            source_filename=source_filename,
            seed=seed,
            negative_prompt=negative_prompt,
            source_width=source_width,
            source_height=source_height,
            longer_edge=longer_edge,
            lightning=lightning,
        )
    raise ValueError(f"unknown video model_id: {model_id!r}")


def _build_ltx(
    *,
    prompt: str,
    source_filename: str,
    seed: int,
    negative_prompt: str | None = None,
    unet_override: str | None = None,
    adult: bool = False,
    source_width: int | None = None,
    source_height: int | None = None,
    longer_edge: int | None = None,
    lightning: bool = True,
) -> ApiPrompt:
    """LTX-2.3 i2v 워크플로우 API 포맷 조립 (private — 기존 본문).

    2-stage sampling (base + spatial upscale) + AV (audio/video) concat 흐름.

    Returns:
        ComfyUI /prompt 용 flat dict (Lightning ON=37 nodes, OFF=35 nodes).
    """
    api: ApiPrompt = {}
    nid = _make_id_gen()
    s = LTX_VIDEO_PRESET.sampling
    neg = negative_prompt or LTX_VIDEO_PRESET.negative_prompt
    unet_name = resolve_video_unet_name(unet_override)

    # ── 해상도 계산 (2026-04-24 · v9): 원본 비율 유지 + 사용자 longer_edge ──
    # 원본 dims 가 들어오면 비율 유지 리사이즈 계산 → pre_resize/longer 둘 다 정렬.
    # 없으면 레거시 포트레이트 박스 (500×800, longer=1536) 로 폴백.
    resolved_longer = longer_edge or VIDEO_LONGER_EDGE_DEFAULT
    if source_width and source_height:
        pre_w, pre_h = compute_video_resize(
            source_width, source_height, resolved_longer
        )
        # longer_edge 는 compute_video_resize 결과의 긴 변과 같음 (8배수 스냅 후).
        final_longer = max(pre_w, pre_h)
    else:
        pre_w, pre_h = s.pre_resize_width, s.pre_resize_height
        final_longer = s.longer_edge

    # latent 크기는 pre_resize 의 절반 — LTX-2.3 spatial downsample 스펙.
    latent_w = max(8, pre_w // 2)
    latent_h = max(8, pre_h // 2)

    # ── 0. Image input (사용자 업로드) ──
    load_id = nid()
    api[load_id] = {
        "class_type": "LoadImage",
        "inputs": {"image": source_filename, "upload": "image"},
    }

    # ── 1. Pre-resize (ResizeImageMaskNode) ──
    # 원본 비율 유지: compute_video_resize(원본 w×h, longer_edge) 결과값 주입.
    resize1_id = nid()
    api[resize1_id] = {
        "class_type": "ResizeImageMaskNode",
        "inputs": {
            "input": [load_id, 0],
            "resize_type": s.pre_resize_mode,
            "resize_type.width": pre_w,
            "resize_type.height": pre_h,
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
            "longer_edge": final_longer,
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

    # ── 5. LoRA 체인 (순차 · lightning/adult 토글 조합에 따라 0~3단) ──
    active_loras = active_video_loras(
        VIDEO_MODEL.loras, adult=adult, lightning=lightning
    )
    model_ref = _build_video_lora_chain(
        api, nid,
        base_model=[ckpt_id, 0],
        loras=active_loras,
    )

    # ── sigmas 선택: Lightning ON 은 4-step distilled, OFF 는 30-step full ──
    base_sigmas = s.base_sigmas if lightning else QUALITY_BASE_SIGMAS
    upscale_sigmas = s.upscale_sigmas if lightning else QUALITY_UPSCALE_SIGMAS

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
    # latent 크기는 pre_resize 의 1/2 (원본 비율 유지로 동적 계산됨).
    empty_vid_id = nid()
    api[empty_vid_id] = {
        "class_type": "EmptyLTXVLatentVideo",
        "inputs": {
            "width": latent_w,
            "height": latent_h,
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
        "inputs": {"sigmas": base_sigmas},
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
        "inputs": {"sigmas": upscale_sigmas},
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


# ═════════════════════════════════════════════════════════════════════
# Wan 2.2 i2v 빌더 — 2-stage (high noise + low noise · 같은 cond/latent 공유)
# ═════════════════════════════════════════════════════════════════════
# spec §4.2 (Phase 1.5 검증 다이어그램) 1:1 mirror.
# 출처 워크플로우: Next Diffusion GGUF + LightX2V (사용자 실증).
# 핵심 차이 (LTX 대비):
#  - WanImageToVideo 가 cond_pos/cond_neg/latent_init 3개 출력 (raw cond 를 video-aware 로 변환)
#  - High/Low noise UNET 두 개를 KSamplerAdvanced 두 단계에 각각 적용 (MoE)
#  - LoRA 는 high/low 분리 학습된 별 파일 (Lightning) + 공통 파일 (모션) 혼합
#  - ModelSamplingSD3 shift=8.0 (GGUF 권장)
# ═════════════════════════════════════════════════════════════════════


def _build_wan22_lora_chain(
    api: ApiPrompt,
    nid: Callable[[], str],
    *,
    base_model: NodeRef,
    loras: list,
    use_high: bool,
    lightning: bool,
) -> NodeRef:
    """Wan22LoraEntry 리스트 → high/low 별 LoRA 체인 적용.

    Args:
        loras: WAN22_VIDEO_PRESET.loras (Wan22LoraEntry list)
        use_high: True 면 entry.name_high 사용, False 면 entry.name_low
        lightning: False 면 role=="lightning" entry 스킵

    Returns:
        체인 끝 NodeRef.
    """
    chain: list[tuple[str, float]] = []
    for entry in loras:
        if entry.role == "lightning" and not lightning:
            continue
        name = entry.name_high if use_high else entry.name_low
        chain.append((name, float(entry.strength)))
    return _apply_lora_chain(api, nid, base_model=base_model, loras=chain)


def _build_wan22(
    *,
    prompt: str,
    source_filename: str,
    seed: int,
    negative_prompt: str | None = None,
    source_width: int | None = None,
    source_height: int | None = None,
    longer_edge: int | None = None,
    lightning: bool = True,
) -> ApiPrompt:
    """Wan 2.2 i2v ComfyUI flat API 빌더 (spec §4.2 다이어그램).

    Args:
        prompt: gemma4 업그레이드 결과 (영문)
        source_filename: ComfyUI input/ 에 업로드된 파일명
        seed: KSamplerAdvanced 의 noise_seed (high/low 동일 seed 공유)
        negative_prompt: 기본은 WAN22_VIDEO_PRESET.negative_prompt
        source_width / source_height: 원본 dims · 비율 유지 리사이즈 (8배수 스냅)
        longer_edge: 긴 변 픽셀 · None 이면 default 832 (Wan sweet spot)
        lightning: True (default) → 4-step / cfg 1 / split 2.
                   False → 20-step / cfg 3.5 / split 10 (정밀 모드)

    Returns:
        ComfyUI /prompt 용 flat dict.
        Lightning ON: 17 nodes (LoRA 체인 each side: lightning + motion = 2)
        Lightning OFF: 15 nodes (LoRA 체인 each side: motion only = 1)
    """
    api: ApiPrompt = {}
    nid = _make_id_gen()
    p = WAN22_VIDEO_PRESET
    s = p.sampling
    f = p.files
    neg = negative_prompt or p.negative_prompt

    # ── Sampling 파라미터 (Lightning ON/OFF 분기) ──
    if lightning:
        steps = s.lightning_steps     # 4
        cfg = s.lightning_cfg         # 1.0
        split = s.lightning_split     # 2 (high noise end_step)
    else:
        steps = s.precise_steps       # 20
        cfg = s.precise_cfg           # 3.5
        split = s.precise_split       # 10

    # ── 해상도 계산 — LTX 와 같은 compute_video_resize 활용 ──
    # 사용자 longer_edge override 없으면 Wan sweet spot 832 사용 (16GB VRAM fit).
    resolved_longer = longer_edge or s.default_width
    if source_width and source_height:
        width, height = compute_video_resize(
            source_width, source_height, resolved_longer
        )
    else:
        # 원본 dims 미상 시 default (832×480 가로) 사용.
        width, height = s.default_width, s.default_height

    length = s.default_length  # 81 frames (5초 @ 16fps)

    # ── 0. Image 입력 ──
    load_id = nid()
    api[load_id] = {
        "class_type": "LoadImage",
        "inputs": {"image": source_filename, "upload": "image"},
    }

    # ── 1. CLIP / VAE 로더 (공통) ──
    clip_id = nid()
    api[clip_id] = {
        "class_type": "CLIPLoader",
        "inputs": {
            "clip_name": f.text_encoder,
            "type": "wan",  # Phase 1.5 검증: enum 19개 중 10번째 ✅
            "device": "default",
        },
    }
    vae_id = nid()
    api[vae_id] = {
        "class_type": "VAELoader",
        "inputs": {"vae_name": f.vae},
    }

    # ── 2. CLIPTextEncode (raw cond — WanImageToVideo 로 흘려보냄) ──
    pos_raw_id = nid()
    api[pos_raw_id] = {
        "class_type": "CLIPTextEncode",
        "_meta": {"title": "Positive (raw)"},
        "inputs": {"clip": [clip_id, 0], "text": prompt},
    }
    neg_raw_id = nid()
    api[neg_raw_id] = {
        "class_type": "CLIPTextEncode",
        "_meta": {"title": "Negative (raw)"},
        "inputs": {"clip": [clip_id, 0], "text": neg},
    }

    # ── 3. WanImageToVideo — cond × 2 + latent 3개 출력 ──
    # Phase 1.5 검증: 출력 [positive_v, negative_v, latent_init] (slot 0/1/2).
    # 양 sampler stage 가 이 출력의 cond/latent 를 공유 — sampling 전 1회 호출.
    wan_i2v_id = nid()
    api[wan_i2v_id] = {
        "class_type": "WanImageToVideo",
        "inputs": {
            "positive": [pos_raw_id, 0],
            "negative": [neg_raw_id, 0],
            "vae": [vae_id, 0],
            "width": width,
            "height": height,
            "length": length,
            "batch_size": 1,
            "start_image": [load_id, 0],  # i2v 핵심 입력 (optional schema)
        },
    }

    # ── 4. HIGH NOISE 분기: UNET + LoRA chain + ModelSamplingSD3 ──
    unet_high_id = nid()
    api[unet_high_id] = {
        "class_type": "UnetLoaderGGUF",  # city96/ComfyUI-GGUF (category="bootleg")
        "inputs": {"unet_name": f.unet_high},
        # Phase 1.5 검증: required=unet_name 만. dequant_dtype 없음.
    }
    model_high_ref = _build_wan22_lora_chain(
        api, nid,
        base_model=[unet_high_id, 0],
        loras=p.loras,
        use_high=True,
        lightning=lightning,
    )
    shift_high_id = nid()
    api[shift_high_id] = {
        "class_type": "ModelSamplingSD3",
        "inputs": {"model": model_high_ref, "shift": float(s.shift)},
    }

    # ── 5. KSamplerAdvanced HIGH (add_noise + leftover_noise enable) ──
    ksampler_high_id = nid()
    api[ksampler_high_id] = {
        "class_type": "KSamplerAdvanced",
        "inputs": {
            "model": [shift_high_id, 0],
            "add_noise": "enable",
            "noise_seed": int(seed),
            "steps": steps,
            "cfg": float(cfg),
            "sampler_name": s.sampler,
            "scheduler": s.scheduler,
            "positive": [wan_i2v_id, 0],   # WanImageToVideo positive
            "negative": [wan_i2v_id, 1],   # WanImageToVideo negative
            "latent_image": [wan_i2v_id, 2],  # WanImageToVideo latent_init
            "start_at_step": 0,
            "end_at_step": split,
            "return_with_leftover_noise": "enable",
        },
    }

    # ── 6. LOW NOISE 분기: UNET + LoRA chain + ModelSamplingSD3 ──
    unet_low_id = nid()
    api[unet_low_id] = {
        "class_type": "UnetLoaderGGUF",
        "inputs": {"unet_name": f.unet_low},
    }
    model_low_ref = _build_wan22_lora_chain(
        api, nid,
        base_model=[unet_low_id, 0],
        loras=p.loras,
        use_high=False,
        lightning=lightning,
    )
    shift_low_id = nid()
    api[shift_low_id] = {
        "class_type": "ModelSamplingSD3",
        "inputs": {"model": model_low_ref, "shift": float(s.shift)},
    }

    # ── 7. KSamplerAdvanced LOW (add_noise + leftover_noise disable) ──
    ksampler_low_id = nid()
    api[ksampler_low_id] = {
        "class_type": "KSamplerAdvanced",
        "inputs": {
            "model": [shift_low_id, 0],
            "add_noise": "disable",
            "noise_seed": int(seed),  # high 와 동일 seed (low 는 fixed)
            "steps": steps,
            "cfg": float(cfg),
            "sampler_name": s.sampler,
            "scheduler": s.scheduler,
            "positive": [wan_i2v_id, 0],   # 동일 cond 재사용 (이미 video-aware)
            "negative": [wan_i2v_id, 1],
            "latent_image": [ksampler_high_id, 0],  # high stage leftover noise
            "start_at_step": split,
            "end_at_step": 10000,
            "return_with_leftover_noise": "disable",
        },
    }

    # ── 8. VAEDecode + CreateVideo + SaveVideo ──
    vae_decode_id = nid()
    api[vae_decode_id] = {
        "class_type": "VAEDecode",
        "inputs": {"samples": [ksampler_low_id, 0], "vae": [vae_id, 0]},
    }
    create_video_id = nid()
    api[create_video_id] = {
        "class_type": "CreateVideo",
        "inputs": {
            "images": [vae_decode_id, 0],
            "fps": float(s.base_fps),  # 16 — Wan 학습 fps (다른 값 시 모션 부자연)
        },
    }
    save_id = nid()
    api[save_id] = {
        "class_type": "SaveVideo",
        "inputs": {
            "video": [create_video_id, 0],
            "filename_prefix": "AIS-Video",
            "format": "auto",
            "codec": "h264",
        },
    }

    return api
