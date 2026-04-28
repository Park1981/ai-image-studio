"""
reference_storage.py — reference template 이미지 영구 저장 + vision 분석 (v8 라이브러리 plan).

저장 위치: data/images/studio/reference-templates/<uuid32>.<ext>
URL prefix: /images/studio/reference-templates/<filename>

PIL 재인코딩: 업로드 bytes 를 PIL.Image 로 한번 열어 검증 + 같은 포맷으로 재저장
(메타데이터 정리 + 확장자 일치 보장).

비전 분석: vision_pipeline._describe_image 의 system_prompt 파라미터 재사용.
실패 graceful (description=None 으로 저장 진행).
"""

from __future__ import annotations

import io
import logging
import re
import uuid
from pathlib import Path

from PIL import Image  # noqa: F401

from .presets import DEFAULT_OLLAMA_ROLES
from .storage import STUDIO_OUTPUT_DIR, STUDIO_URL_PREFIX

log = logging.getLogger(__name__)

REFERENCE_DIR = STUDIO_OUTPUT_DIR / "reference-templates"
REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
REFERENCE_URL_PREFIX = f"{STUDIO_URL_PREFIX}/reference-templates"

# PIL 형식 → 확장자 매핑 (재인코딩 시 일관성)
_FORMAT_TO_EXT = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
# 허용 확장자 + 파일명 정규식 (uuid32 hex + 허용 ext)
_FILENAME_RE = re.compile(r"^[0-9a-f]{32}\.(png|jpg|jpeg|webp)$")


def save_reference_image(image_bytes: bytes) -> str:
    """이미지 bytes 를 PIL 재인코딩 후 영구 저장 → URL 반환.

    PIL 로 한번 열어서 형식 검증 + 같은 포맷으로 재저장 (메타데이터 정리).
    실패 시 PIL.UnidentifiedImageError 전파 — 호출 측이 400 응답.

    Returns:
        URL 형식 (/images/studio/reference-templates/<uuid32>.<ext>)
    """
    with Image.open(io.BytesIO(image_bytes)) as im:
        fmt = (im.format or "PNG").upper()
        ext = _FORMAT_TO_EXT.get(fmt, "png")
        new_name = f"{uuid.uuid4().hex}.{ext}"
        save_path = REFERENCE_DIR / new_name
        # PIL 재인코딩 — EXIF 등 메타데이터 정리. JPEG 는 RGB 강제 (RGBA 미지원).
        save_format = "PNG" if ext == "png" else ("JPEG" if ext == "jpg" else "WEBP")
        if save_format == "JPEG" and im.mode != "RGB":
            im = im.convert("RGB")
        im.save(save_path, format=save_format)
    return f"{REFERENCE_URL_PREFIX}/{new_name}"


def reference_path_from_url(url: str) -> Path | None:
    """URL → 실 파일 경로 변환 (path traversal 방어).

    storage._result_path_from_url 패턴 동일.
    허용: /images/studio/reference-templates/<uuid32>.<ext>
    거부: ../, %2f, backslash, query/hash, bad prefix, 하위 path, 잘못된 확장자
    """
    if not url:
        return None
    # Codex Phase A 리뷰 fix: query/hash 가 있는 URL 자체를 거부.
    # (옛 split 방식은 잘라낸 뒤 정규식만 검증해서 ?evil 같은 의심 입력 통과)
    if "?" in url or "#" in url:
        return None
    prefix = REFERENCE_URL_PREFIX + "/"
    if not url.startswith(prefix):
        return None
    rel = url[len(prefix):]
    # 슬래시 / 백슬래시 모두 거부 (하위 path 차단)
    if "\\" in rel or "/" in rel:
        return None
    if not _FILENAME_RE.match(rel):
        return None
    candidate = (REFERENCE_DIR / rel).resolve()
    try:
        if not candidate.is_relative_to(REFERENCE_DIR.resolve()):
            return None
    except (OSError, ValueError):
        return None
    return candidate


def delete_reference_file(url: str) -> bool:
    """파일 삭제 — URL 검증 후 unlink. 실패 graceful (False 반환)."""
    path = reference_path_from_url(url)
    if path is None or not path.exists():
        return False
    try:
        path.unlink()
        return True
    except OSError as e:
        log.warning("reference 파일 삭제 실패: %s", e)
        return False


async def analyze_reference(
    image_bytes: bytes,
    role: str | None,
    user_intent: str | None,
    vision_model: str | None = None,
    ollama_url: str | None = None,
) -> str | None:
    """qwen2.5vl 1회 호출 — reference 의 핵심 description 생성 (영문).

    role + user_intent 컨텍스트를 system_prompt 에 주입 → 사용자가 *원하는 측면*
    위주로 묘사. _describe_image 의 기존 system_prompt 파라미터 재사용.

    Returns: 영문 description 또는 None (실패 시).
    """
    # 지연 import — vision_pipeline 가 이 모듈을 import 하지 않더라도
    # 향후 순환 위험 차단.
    from .vision_pipeline import _DEFAULT_OLLAMA_URL, _describe_image

    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL
    role_clause = f"User wants to use this as a {role} reference. " if role else ""
    intent_clause = f"User intent: {user_intent}. " if user_intent else ""
    system_prompt = (
        f"{role_clause}{intent_clause}"
        "Describe the key visual elements of this image in 1-2 short sentences "
        "that are relevant to the user's intended use. Focus on concrete features. "
        "Output English only, no markdown."
    )
    try:
        desc = await _describe_image(
            image_bytes,
            vision_model=resolved_vision,
            timeout=60.0,
            ollama_url=resolved_url,
            system_prompt=system_prompt,
        )
        return desc.strip() or None
    except Exception as e:
        log.warning("reference vision 분석 실패: %s", e)
        return None
