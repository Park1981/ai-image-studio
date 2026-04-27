"""Studio 이미지/영상 파일 저장 + cleanup (router.py 분해 · task #12 · 2026-04-26).

router.py 의 storage 계층을 별도 모듈로 추출.
- STUDIO_OUTPUT_DIR / STUDIO_URL_PREFIX (저장 루트)
- EDIT_SOURCE_DIR / EDIT_SOURCE_URL_PREFIX (edit 원본 영구 저장 영역)
- 경로 검증 정규식 (path traversal 방어 — task_id / edit-source / result)
- _edit_source_path_from_url / _result_path_from_url
- _cleanup_edit_source_file / _cleanup_result_file
- _resolve_save_dir / _next_save_path
- _persist_history (history_db 래퍼)

router.py 가 동일 이름으로 re-import. behavior 무변경.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from . import history_db

log = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# 저장 루트 (config 폴백 포함)
# ─────────────────────────────────────────────
try:
    from config import settings  # type: ignore

    STUDIO_OUTPUT_DIR = Path(settings.output_image_path) / "studio"
    STUDIO_URL_PREFIX = "/images/studio"
except Exception:
    # 폴백 (테스트 환경 등)
    STUDIO_OUTPUT_DIR = Path("backend/output/images/studio")
    STUDIO_URL_PREFIX = "/images/studio"
STUDIO_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 모든 업로드 이미지 라우트(Edit/Video/Vision/Compare)의 동일 상한.
STUDIO_MAX_IMAGE_BYTES = 20 * 1024 * 1024

# Edit 비교 분석용 source 영구 저장
EDIT_SOURCE_DIR = STUDIO_OUTPUT_DIR / "edit-source"
EDIT_SOURCE_DIR.mkdir(parents=True, exist_ok=True)
EDIT_SOURCE_URL_PREFIX = f"{STUDIO_URL_PREFIX}/edit-source"

# task_id 검증 정규식 — path traversal 방지 (CLAUDE.md 보안 규칙)
TASK_ID_RE = re.compile(r"^tsk-[0-9a-f]{12}$")

# edit-source 파일명 화이트리스트 (path traversal 방지).
# 저장 시 uuid4 hex + ".png/.jpg/.jpeg/.webp" 포맷이므로 이 정규식 외엔 삭제 거부.
_EDIT_SOURCE_FILENAME_RE = re.compile(r"^[0-9a-zA-Z_\-]{1,64}\.(png|jpg|jpeg|webp)$")

# result 파일명 화이트리스트 (audit R1-6).
# 영상 결과는 .mp4 확장자 허용. 이미지는 edit-source 와 동일 확장자 세트.
# 두 가지 형식 모두 매치:
#   - 레거시 UUID 형식 (STUDIO_OUTPUT_DIR 직속): `<uuid32>.png`
#   - 신규 날짜/카운터 형식 (2026-04-25~, mode/date/ 서브폴더): `gen-1430-001.png`
_RESULT_FILENAME_RE = re.compile(
    r"^[0-9a-zA-Z_\-]{1,64}\.(png|jpg|jpeg|webp|mp4)$"
)

# 신규 저장 구조의 mode 서브폴더 화이트리스트.
_VALID_MODE_DIRS = frozenset({"generate", "edit", "video"})
# 신규 저장 구조의 date 서브폴더 형식 (YYYY-MM-DD).
_DATE_DIR_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# mode → 파일명 prefix 매핑
_MODE_PREFIX = {
    "generate": "gen",
    "edit": "edit",
    "video": "video",
}


# ─────────────────────────────────────────────
# URL → Path 변환 (path traversal 방어)
# ─────────────────────────────────────────────


def _edit_source_path_from_url(url: str) -> Path | None:
    """edit-source URL 을 실제 파일 경로로 변환. 안전하지 않으면 None.

    보안 방어선:
      1. URL 이 `/images/studio/edit-source/` prefix 로 시작해야 함
      2. 파일명이 `_EDIT_SOURCE_FILENAME_RE` 화이트리스트 통과해야 함
      3. 최종 경로가 EDIT_SOURCE_DIR 내부여야 함 (resolve 후 is_relative_to)
    """
    if not url or not url.startswith(EDIT_SOURCE_URL_PREFIX + "/"):
        return None
    filename = url[len(EDIT_SOURCE_URL_PREFIX) + 1 :].split("?", 1)[0].split("#", 1)[0]
    if not _EDIT_SOURCE_FILENAME_RE.match(filename):
        return None
    candidate = (EDIT_SOURCE_DIR / filename).resolve()
    try:
        if not candidate.is_relative_to(EDIT_SOURCE_DIR.resolve()):
            return None
    except ValueError:
        return None
    return candidate


def _result_path_from_url(url: str) -> Path | None:
    """result(image_ref) URL 을 실제 파일 경로로 변환. 안전하지 않으면 None.

    audit R1-6 (+ 2026-04-25 저장 구조 변경): DELETE history 시 orphan 된 결과 파일 정리용.

    허용 경로 2종 (둘 다 STUDIO_OUTPUT_DIR 내부):
      - 레거시 직속: `/images/studio/<uuid>.png`
      - 신규 계층: `/images/studio/{generate|edit|video}/YYYY-MM-DD/<filename>.<ext>`

    보안 방어선:
      1. URL 이 `/images/studio/` prefix 로 시작해야 함
      2. edit-source sub-path 는 제외 (이중 삭제 방지 — 별도 _cleanup_edit_source_file)
      3. 직속이면 파일명만 `_RESULT_FILENAME_RE` 통과
      4. 계층이면 [mode ∈ _VALID_MODE_DIRS] / [date = YYYY-MM-DD] / [filename 통과]
         (mode/date 외 다른 서브폴더 구조는 거부 — backslash 포함)
      5. 최종 경로가 STUDIO_OUTPUT_DIR 내부인지 resolve 후 is_relative_to 확인 (symlink 방어)
    """
    if not url:
        return None
    prefix = STUDIO_URL_PREFIX + "/"
    if not url.startswith(prefix):
        return None
    # edit-source sub 는 별도 처리. mock 결과나 타 도메인 URL 도 함께 제외.
    if url.startswith(EDIT_SOURCE_URL_PREFIX + "/"):
        return None
    rel = url[len(prefix) :].split("?", 1)[0].split("#", 1)[0]
    # backslash 는 Windows path separator — URL 에 포함되면 조작 의심 · 거부
    if "\\" in rel:
        return None

    parts = rel.split("/")
    if len(parts) == 1:
        # 레거시 직속 UUID 파일 (하위호환)
        filename = parts[0]
        if not _RESULT_FILENAME_RE.match(filename):
            return None
        candidate = (STUDIO_OUTPUT_DIR / filename).resolve()
    elif len(parts) == 3:
        # 신규 mode/date/filename 계층
        mode_dir, date_dir, filename = parts
        if mode_dir not in _VALID_MODE_DIRS:
            return None
        if not _DATE_DIR_RE.match(date_dir):
            return None
        if not _RESULT_FILENAME_RE.match(filename):
            return None
        candidate = (STUDIO_OUTPUT_DIR / mode_dir / date_dir / filename).resolve()
    else:
        # 기타 depth (예: edit-source 는 위에서 걸렀으므로 여긴 알 수 없는 구조)
        return None

    # 최종 symlink 우회 방어 — 실제 경로가 STUDIO_OUTPUT_DIR 안인지 검증
    try:
        if not candidate.is_relative_to(STUDIO_OUTPUT_DIR.resolve()):
            return None
    except (OSError, ValueError):
        return None
    return candidate


# ─────────────────────────────────────────────
# 파일 cleanup (DELETE history 시)
# ─────────────────────────────────────────────


async def _cleanup_edit_source_file(
    url: str | None, *, already_deleted_from_db: bool = True
) -> bool:
    """edit-source URL 에 해당하는 파일을 안전하게 삭제.

    다른 history row 가 같은 source_ref 를 참조하면 (같은 원본에서 연속 수정한 경우)
    삭제하지 않음. url 이 edit-source 가 아니면 아무것도 안 함.

    Args:
        url: source_ref URL
        already_deleted_from_db: DB 에서 이미 삭제된 row 의 source_ref 이면 True.
            False 이면 count >= 1 허용 (= 자기 자신 외 참조 없음).

    Returns:
        True 면 실제로 파일 1개 삭제됨. False 면 스킵/오류.
    """
    if not url:
        return False
    path = _edit_source_path_from_url(url)
    if path is None:
        return False
    # 다른 row 가 이 source_ref 를 참조하는지 확인 (race 는 허용 — 최악의 경우
    # 참조 추가된 직후 삭제되면 해당 row 가 404 source 를 가리킴. 프론트는 graceful).
    remaining = await history_db.count_source_ref_usage(url)
    threshold = 0 if already_deleted_from_db else 1
    if remaining > threshold:
        return False
    try:
        path.unlink(missing_ok=True)
        return True
    except OSError as e:
        log.warning("edit-source 삭제 실패 %s: %s", path, e)
        return False


async def _cleanup_result_file(url: str | None) -> bool:
    """result(image_ref) URL 에 해당하는 파일을 안전하게 삭제 (audit R1-6).

    image_ref 는 본래 1:1 매핑이라 재참조 가능성 낮지만, Generate → Edit 체인 같은
    경우 image_ref 와 다른 row 의 source_ref 가 같은 파일을 가리킬 수 있음.
    파일 자체 count (image_ref + source_ref 양쪽) 가 0 일 때만 삭제.

    Returns:
        True 면 실제로 파일 1개 삭제됨. False 면 스킵/비대상/오류.
    """
    if not url:
        return False
    path = _result_path_from_url(url)
    if path is None:
        return False
    # 같은 URL 이 다른 row 에서 참조되고 있으면 보존 (edit 체인 · 비교 분석 등)
    remaining_as_image = await history_db.count_image_ref_usage(url)
    remaining_as_source = await history_db.count_source_ref_usage(url)
    if remaining_as_image + remaining_as_source > 0:
        return False
    try:
        path.unlink(missing_ok=True)
        return True
    except OSError as e:
        log.warning("result 파일 삭제 실패 %s: %s", path, e)
        return False


# ─────────────────────────────────────────────
# 저장 경로 헬퍼 (2026-04-25 · 저장 구조 정리)
#
# 새 구조: STUDIO_OUTPUT_DIR/{mode}/{YYYY-MM-DD}/{prefix}-{HHMM}-{NNN}.{ext}
#   예: data/images/studio/generate/2026-04-25/gen-1430-001.png
#   예: data/images/studio/edit/2026-04-25/edit-1502-002.png
#   예: data/images/studio/video/2026-04-25/video-1530-001.mp4
#
# 카운터는 해당 폴더 내 통합 (매일 리셋). 충돌 시 retry loop 로 +1.
# 기존 UUID 파일 (STUDIO_OUTPUT_DIR 직속) 은 path traversal 가드에서 여전히 허용.
# ─────────────────────────────────────────────


def _resolve_save_dir(mode: str) -> Path:
    """mode/date 계층 디렉토리 보장 후 반환.

    Args:
        mode: "generate" | "edit" | "video"

    Returns:
        STUDIO_OUTPUT_DIR / mode / YYYY-MM-DD (존재 보장)
    """
    if mode not in _MODE_PREFIX:
        raise ValueError(f"Invalid mode: {mode!r}")
    today = datetime.now().strftime("%Y-%m-%d")
    target = STUDIO_OUTPUT_DIR / mode / today
    target.mkdir(parents=True, exist_ok=True)
    return target


def _next_save_path(mode: str, ext: str) -> tuple[Path, str]:
    """mode/date 폴더 안에서 다음 사용 가능한 저장 경로 생성.

    포맷: {prefix}-{HHMM}-{NNN}.{ext}  (예: gen-1430-001.png)
      - HHMM: 현재 시각 (하루 안 카운터 흐름 이해 용)
      - NNN: 해당 폴더 내 순차 번호 (001 부터, 충돌 시 +1 재시도)

    Args:
        mode: "generate" | "edit" | "video"
        ext: 확장자 ("png", "jpg", "mp4" 등. dot 있어도 허용)

    Returns:
        (절대 경로, URL 상대경로) 튜플.
        URL 상대경로는 STUDIO_URL_PREFIX 뒤에 붙일 `mode/date/file.ext` 형태.
    """
    prefix = _MODE_PREFIX[mode]
    save_dir = _resolve_save_dir(mode)
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    hhmm = now.strftime("%H%M")
    ext = ext.lstrip(".")

    # 폴더 내 기존 파일 수 기반으로 시작 번호 추정 (retry 횟수 최소화)
    try:
        start_n = sum(1 for _ in save_dir.iterdir()) + 1
    except OSError:
        start_n = 1

    n = start_n
    while n <= 9999:
        filename = f"{prefix}-{hhmm}-{n:03d}.{ext}"
        candidate = save_dir / filename
        if not candidate.exists():
            relative = f"{mode}/{date_str}/{filename}"
            return candidate, relative
        n += 1
    # 극단 방어: 한 폴더에 9999개 넘으면 에러
    raise RuntimeError(f"{save_dir} 폴더가 가득 찼음 (9999 초과)")


# ─────────────────────────────────────────────
# History DB 래퍼
# ─────────────────────────────────────────────


async def _persist_history(item: dict[str, Any]) -> bool:
    """history_db.insert_item 래퍼 — 실패를 bool 로 반환해 done 이벤트에 반영."""
    try:
        await history_db.insert_item(item)
        return True
    except Exception as db_err:
        log.warning("history_db insert failed: %s", db_err)
        return False
