"""
백엔드 테스트 공통 fixture
- sys.path 설정 (backend 루트 임포트 지원)
- 워크플로우 템플릿 fixture
- httpx AsyncClient fixture
"""

import json
import sys
from pathlib import Path

import pytest

# backend 디렉토리를 Python 경로에 추가 (from config import settings 등 지원)
_backend_root = str(Path(__file__).resolve().parent.parent)
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)


# ─────────────────────────────────────────────
# 샘플 워크플로우 JSON (qwen_image 구조 기반)
# ─────────────────────────────────────────────

@pytest.fixture
def sample_workflow() -> dict:
    """테스트용 txt2img 워크플로우 (CheckpointLoaderSimple 포함)"""
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "default_model.safetensors"},
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "CLIP Text Encode (Positive)"},
            "inputs": {"text": "", "clip": ["1", 1]},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "CLIP Text Encode (Negative)"},
            "inputs": {"text": "", "clip": ["1", 1]},
        },
        "4": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 512, "height": 512, "batch_size": 1},
        },
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 0,
                "steps": 20,
                "cfg": 7.0,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
            },
        },
        "6": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
        },
        "7": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "test", "images": ["6", 0]},
        },
    }


@pytest.fixture
def qwen_workflow() -> dict:
    """Qwen Image 스타일 워크플로우 (UNETLoader + EmptySD3LatentImage)"""
    return {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "qwen.safetensors", "weight_dtype": "default"},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": "qwen_clip.safetensors", "type": "qwen_image"},
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "qwen_vae.safetensors"},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "CLIP Text Encode (Positive)"},
            "inputs": {"text": "", "clip": ["2", 0]},
        },
        "5": {
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "CLIP Text Encode (Negative)"},
            "inputs": {"text": "", "clip": ["2", 0]},
        },
        "6": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": 1328, "height": 1328, "batch_size": 1},
        },
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 0,
                "steps": 50,
                "cfg": 4.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["4", 0],
                "negative": ["5", 0],
                "latent_image": ["6", 0],
            },
        },
    }


@pytest.fixture
def edit_workflow() -> dict:
    """Qwen Image Edit 워크플로우"""
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "qwen_edit.safetensors"},
        },
        "2": {
            "class_type": "LoadImage",
            "inputs": {"image": ""},
        },
        "3": {
            "class_type": "TextEncodeQwenImageEdit",
            "_meta": {"title": "Positive Prompt"},
            "inputs": {"prompt": ""},
        },
        "4": {
            "class_type": "TextEncodeQwenImageEdit",
            "_meta": {"title": "Negative Prompt"},
            "inputs": {"prompt": ""},
        },
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 0,
                "steps": 50,
                "cfg": 4.0,
                "model": ["1", 0],
            },
        },
        "6": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "edit_vae.safetensors"},
        },
    }


@pytest.fixture
def tmp_workflows_dir(tmp_path: Path, sample_workflow: dict) -> Path:
    """임시 워크플로우 디렉토리 (실제 파일 포함)"""
    wf_dir = tmp_path / "workflows"
    wf_dir.mkdir()

    # txt2img.json
    (wf_dir / "txt2img.json").write_text(
        json.dumps(sample_workflow, indent=2), encoding="utf-8"
    )

    # 잘못된 JSON 파일
    (wf_dir / "broken.json").write_text("{ invalid json", encoding="utf-8")

    return wf_dir


# ─────────────────────────────────────────────
# httpx AsyncClient fixture (FastAPI 앱 테스트용)
# ─────────────────────────────────────────────

@pytest.fixture
async def async_client():
    """FastAPI 앱 테스트용 httpx AsyncClient"""
    import httpx
    from main import app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client
