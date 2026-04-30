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

from typing import Callable

from ..presets import (
    QUALITY_BASE_SIGMAS,
    QUALITY_UPSCALE_SIGMAS,
    VIDEO_LONGER_EDGE_DEFAULT,
    VIDEO_MODEL,
    VideoLoraEntry,
    active_video_loras,
    compute_video_resize,
    resolve_video_unet_name,
)
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
    """LTX-2.3 i2v 워크플로우 API 포맷 조립.

    Args:
        prompt: gemma4 업그레이드 결과 (영문)
        source_filename: ComfyUI input/ 에 업로드된 파일명
        seed: base stage RandomNoise 시드 (upscale stage 는 런타임 random)
        negative_prompt: 기본은 VIDEO_MODEL.negative_prompt
        unet_override: VRAM 16GB 대응용 · Kijai transformer_only 등 파일명
        adult: 성인 모드 토글. True 면 eros LoRA 체인 포함.
        source_width: 원본 이미지 너비 (px). 제공되면 원본 비율 유지 리사이즈 계산.
            None 이면 레거시 포트레이트 박스 (500×800) fit 로 폴백.
        source_height: 원본 이미지 높이.
        longer_edge: 사용자 지정 긴 변 픽셀 (512~1536, step 128). 기본 1536.
        lightning: Lightning 4-step 초고속 모드 (2026-04-24 · v10).
            True (기본) = distilled LoRA 체인 + 4-step sigmas (5분 내외, 얼굴 drift 가능)
            False       = LoRA 스킵 + 30-step full sigmas (20분+, 얼굴 보존 최강)

    Returns:
        ComfyUI /prompt 용 flat dict (Lightning ON=37 nodes, OFF=35 nodes).
    """
    api: ApiPrompt = {}
    nid = _make_id_gen()
    s = VIDEO_MODEL.sampling
    neg = negative_prompt or VIDEO_MODEL.negative_prompt
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