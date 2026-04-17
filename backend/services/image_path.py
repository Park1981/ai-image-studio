"""
이미지 경로 해석 유틸 — routers/generate.py, routers/prompt.py 공통 사용
- 허용 디렉토리: data/uploads/, data/images/
- Path traversal 방지 검증
- 다음 식별자 형식 모두 지원:
  1. 파일명만 (예: "abc.png") — uploads/ → images/ 순서 탐색
  2. images/ 하위 상대경로 (예: "2026-04-11/abc.png")
  3. 전체 상대경로 (예: "data/images/2026-04-11/abc.png")
"""

from pathlib import Path

from config import settings


def resolve_image_path(identifier: str) -> Path | None:
    """
    이미지 식별자를 실제 파일 경로로 해석
    - 허용 디렉토리 밖이면 None 반환 (path traversal 방지)
    - 파일이 존재하지 않아도 None 반환
    """
    if not identifier or not identifier.strip():
        return None

    upload_dir = Path(settings.upload_path).resolve()
    images_dir = Path(settings.output_image_path).resolve()
    allowed_roots = [upload_dir, images_dir]

    # 1) uploads/ 디렉토리에서 먼저 탐색 (업로드된 소스 이미지)
    upload_candidate = (Path(settings.upload_path) / identifier).resolve()
    if upload_candidate.is_file() and _is_within(upload_candidate, upload_dir):
        return upload_candidate

    # 2) images/ 디렉토리에서 탐색 (생성된 이미지, YYYY-MM-DD/file.png 형태 포함)
    images_candidate = (Path(settings.output_image_path) / identifier).resolve()
    if images_candidate.is_file() and _is_within(images_candidate, images_dir):
        return images_candidate

    # 3) 전체 상대경로로 전달된 경우 (data/images/... 또는 data/uploads/...)
    direct = Path(identifier).resolve()
    if direct.is_file() and any(_is_within(direct, root) for root in allowed_roots):
        return direct

    return None


def _is_within(path: Path, parent: Path) -> bool:
    """path가 parent 디렉토리 내에 있는지 확인 (path traversal 방지)"""
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False
