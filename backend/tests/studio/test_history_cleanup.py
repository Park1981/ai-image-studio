"""
history cleanup 테스트 — edit-source orphan 파일 정리 로직 (audit P1b).

path traversal 방어선 정규식/경로 검증에 집중.
DB 통합은 aiosqlite in-memory 픽스처 없이는 복잡하므로 manual QA 로 커버.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from studio.router import (
    EDIT_SOURCE_DIR,
    EDIT_SOURCE_URL_PREFIX,
    STUDIO_OUTPUT_DIR,
    STUDIO_URL_PREFIX,
    _edit_source_path_from_url,
    _EDIT_SOURCE_FILENAME_RE,
    _result_path_from_url,
    _RESULT_FILENAME_RE,
)


class TestEditSourceFilenameRegex:
    """화이트리스트 정규식 — path traversal 1차 방어선."""

    def test_accepts_valid_png(self):
        assert _EDIT_SOURCE_FILENAME_RE.match("abc123.png")

    def test_accepts_valid_jpeg(self):
        assert _EDIT_SOURCE_FILENAME_RE.match("photo_001.jpeg")

    def test_accepts_uuid_like(self):
        assert _EDIT_SOURCE_FILENAME_RE.match("a1b2c3d4e5f6.png")

    def test_rejects_path_traversal_dots(self):
        assert not _EDIT_SOURCE_FILENAME_RE.match("../secret.png")

    def test_rejects_path_traversal_slash(self):
        assert not _EDIT_SOURCE_FILENAME_RE.match("sub/file.png")

    def test_rejects_path_traversal_backslash(self):
        assert not _EDIT_SOURCE_FILENAME_RE.match("sub\\file.png")

    def test_rejects_absolute_path_chars(self):
        assert not _EDIT_SOURCE_FILENAME_RE.match("C:\\win.png")

    def test_rejects_unknown_ext(self):
        assert not _EDIT_SOURCE_FILENAME_RE.match("secret.exe")

    def test_rejects_no_ext(self):
        assert not _EDIT_SOURCE_FILENAME_RE.match("secret")

    def test_rejects_hidden_dotfile(self):
        assert not _EDIT_SOURCE_FILENAME_RE.match(".hidden.png")

    def test_rejects_empty(self):
        assert not _EDIT_SOURCE_FILENAME_RE.match("")


class TestEditSourcePathResolution:
    """URL → Path 변환 — 전체 방어 체인 테스트."""

    def test_valid_url_returns_path(self):
        url = f"{EDIT_SOURCE_URL_PREFIX}/abcd1234.png"
        path = _edit_source_path_from_url(url)
        assert path is not None
        assert path.name == "abcd1234.png"
        assert path.parent.resolve() == EDIT_SOURCE_DIR.resolve()

    def test_wrong_prefix_returns_none(self):
        # /images/studio/ 바로 아래 다른 서브 (edit-source 아님)
        assert _edit_source_path_from_url("/images/studio/other.png") is None

    def test_generate_result_not_cleaned(self):
        # 생성 결과 이미지 URL (edit-source 아님) 은 무시되어야 함
        assert (
            _edit_source_path_from_url("/images/studio/result_abc.png") is None
        )

    def test_relative_traversal_rejected(self):
        url = f"{EDIT_SOURCE_URL_PREFIX}/../secret.png"
        assert _edit_source_path_from_url(url) is None

    def test_absolute_windows_rejected(self):
        url = f"{EDIT_SOURCE_URL_PREFIX}/C:\\Windows\\system32.png"
        assert _edit_source_path_from_url(url) is None

    def test_query_string_stripped(self):
        # cache busting ?v=xxx 붙어도 파일명만 추출
        url = f"{EDIT_SOURCE_URL_PREFIX}/abc123.png?v=2"
        path = _edit_source_path_from_url(url)
        assert path is not None
        assert path.name == "abc123.png"

    def test_fragment_stripped(self):
        url = f"{EDIT_SOURCE_URL_PREFIX}/abc123.png#hash"
        path = _edit_source_path_from_url(url)
        assert path is not None
        assert path.name == "abc123.png"

    def test_empty_url_rejected(self):
        assert _edit_source_path_from_url("") is None

    def test_none_rejected(self):
        # type: ignore 방어 — 실제 호출부에서 None 가드 있지만 방어선 중복 확인
        assert _edit_source_path_from_url("") is None  # "" 으로 대체

    def test_unknown_ext_rejected(self):
        url = f"{EDIT_SOURCE_URL_PREFIX}/malicious.exe"
        assert _edit_source_path_from_url(url) is None

    def test_no_slash_after_prefix_rejected(self):
        # prefix 뒤 `/` 없으면 거부 (애매한 URL 방어)
        url = EDIT_SOURCE_URL_PREFIX + "file.png"
        assert _edit_source_path_from_url(url) is None


class TestResultFilenameRegex:
    """audit R1-6: result 파일 화이트리스트."""

    def test_accepts_png(self):
        assert _RESULT_FILENAME_RE.match("abc123.png")

    def test_accepts_mp4(self):
        assert _RESULT_FILENAME_RE.match("video_result.mp4")

    def test_accepts_uuid_hex(self):
        # uuid4().hex 는 32자 hex 소문자
        assert _RESULT_FILENAME_RE.match(
            "0123456789abcdef0123456789abcdef.png"
        )

    def test_rejects_traversal_dots(self):
        assert not _RESULT_FILENAME_RE.match("../secret.png")

    def test_rejects_traversal_slash(self):
        assert not _RESULT_FILENAME_RE.match("sub/file.png")

    def test_rejects_unknown_ext(self):
        assert not _RESULT_FILENAME_RE.match("secret.exe")


class TestResultPathResolution:
    """audit R1-6: URL → Path 변환 (result 파일)."""

    def test_valid_image_url_returns_path(self):
        url = f"{STUDIO_URL_PREFIX}/abcd1234.png"
        path = _result_path_from_url(url)
        assert path is not None
        assert path.name == "abcd1234.png"
        assert path.parent.resolve() == STUDIO_OUTPUT_DIR.resolve()

    def test_valid_mp4_url_returns_path(self):
        url = f"{STUDIO_URL_PREFIX}/result.mp4"
        path = _result_path_from_url(url)
        assert path is not None
        assert path.name == "result.mp4"

    def test_edit_source_url_rejected(self):
        # 이중 삭제 방지 — edit-source 는 _cleanup_edit_source_file 로만 처리
        url = f"{EDIT_SOURCE_URL_PREFIX}/abcd.png"
        assert _result_path_from_url(url) is None

    def test_wrong_prefix_rejected(self):
        assert _result_path_from_url("/other/path.png") is None

    def test_traversal_rejected(self):
        url = f"{STUDIO_URL_PREFIX}/../secret.png"
        assert _result_path_from_url(url) is None

    def test_sub_directory_rejected(self):
        # STUDIO_OUTPUT_DIR 직속만 허용 (sub-path 봉인)
        url = f"{STUDIO_URL_PREFIX}/some-sub/file.png"
        assert _result_path_from_url(url) is None

    def test_absolute_windows_rejected(self):
        url = f"{STUDIO_URL_PREFIX}/C:\\Windows\\sys.png"
        assert _result_path_from_url(url) is None

    def test_query_string_stripped(self):
        url = f"{STUDIO_URL_PREFIX}/abc.png?v=2"
        path = _result_path_from_url(url)
        assert path is not None
        assert path.name == "abc.png"

    def test_empty_url_rejected(self):
        assert _result_path_from_url("") is None

    def test_mock_seed_url_rejected(self):
        # mock-seed:// 같은 비실제 ref 는 prefix 매칭 안 되므로 None
        assert _result_path_from_url("mock-seed://generate-1") is None

    def test_unknown_ext_rejected(self):
        url = f"{STUDIO_URL_PREFIX}/malicious.exe"
        assert _result_path_from_url(url) is None
