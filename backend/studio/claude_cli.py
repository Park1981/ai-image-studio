"""
claude_cli.py - Claude CLI 비대화 호출 (조사 필요 버튼 전용).

Windows 에서 subprocess 호출 시 cp949 디코딩 이슈가 있어 UTF-8 강제.
(memory: `fix(Phase F): Claude CLI subprocess Windows cp949 디코딩 오류 수정`)

CLI 바이너리: `claude` (PATH 에 있어야 함)
사용 방식: `claude -p "<prompt>"` 비대화 모드 (one-shot, 결과 stdout)
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from dataclasses import dataclass

log = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30.0  # 초
CLAUDE_BIN = "claude"


@dataclass
class ResearchResult:
    """Claude CLI 조사 결과."""

    hints: list[str]
    """요약된 힌트 리스트 (UI 표시용)."""

    raw: str
    """Claude 원본 응답 (디버그용)."""

    ok: bool
    """성공 여부."""

    error: str | None = None
    """실패 시 메시지."""


async def research_prompt(
    prompt: str,
    model_name: str,
    timeout: float = DEFAULT_TIMEOUT,
) -> ResearchResult:
    """Claude CLI 에게 프롬프트 개선 힌트를 물어본다.

    반환:
        ResearchResult - ok=False 면 hints 가 빈 리스트이고 error 에 사유.
    """
    if shutil.which(CLAUDE_BIN) is None:
        return ResearchResult(
            hints=[], raw="", ok=False, error="claude CLI binary not found on PATH"
        )

    query = _build_research_query(prompt, model_name)

    try:
        raw = await _run_claude(query, timeout)
    except asyncio.TimeoutError:
        return ResearchResult(
            hints=[],
            raw="",
            ok=False,
            error=f"claude CLI timeout after {timeout}s",
        )
    except Exception as e:
        log.warning("claude CLI call failed: %s", e)
        return ResearchResult(
            hints=[], raw="", ok=False, error=str(e)
        )

    hints = _extract_hints(raw)
    return ResearchResult(hints=hints, raw=raw, ok=True)


def _build_research_query(prompt: str, model_name: str) -> str:
    """Claude CLI 에 던질 단일 쿼리 문자열 구성."""
    return (
        f"You are helping a local image generation user. They are using the "
        f"{model_name} model on ComfyUI. Their current draft prompt is:\n\n"
        f"{prompt}\n\n"
        f"Give 3 concise, actionable tips (one per line, numbered 1. 2. 3.) to "
        f"improve the final image quality with this specific model. Focus on "
        f"lighting, composition, style anchors, and known strengths/weaknesses "
        f"of the model. Keep each tip under 25 words. Output ONLY the numbered tips, "
        f"no preamble or extra commentary."
    )


async def _run_claude(query: str, timeout: float) -> str:
    """claude -p "<query>" 실행, stdout 을 UTF-8 로 디코드.

    ⚠️ Windows cp949 이슈 방지: shell=False, text 모드 아닌 bytes 로 받아 UTF-8 decode.
    """
    proc = await asyncio.create_subprocess_exec(
        CLAUDE_BIN,
        "-p",
        query,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise

    if proc.returncode != 0:
        err = stderr_bytes.decode("utf-8", errors="replace")
        raise RuntimeError(f"claude CLI exit {proc.returncode}: {err[:200]}")

    return stdout_bytes.decode("utf-8", errors="replace")


def _extract_hints(raw: str) -> list[str]:
    """Claude 응답에서 번호 매겨진 라인을 추출."""
    hints: list[str] = []
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        # "1." 또는 "1)" 접두어 제거
        for prefix in ("1.", "2.", "3.", "4.", "5.", "1)", "2)", "3)"):
            if line.startswith(prefix):
                line = line[len(prefix) :].strip()
                break
        if line:
            hints.append(line)
        if len(hints) >= 3:
            break
    return hints
