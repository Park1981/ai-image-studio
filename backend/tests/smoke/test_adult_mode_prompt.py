"""
성인 모드 gemma4-un 실전 테스트 스크립트 (v2 — streaming 응답).
Ollama 의 /api/chat 을 스트리밍으로 호출해 중간 소켓 타임아웃을 회피.

실행:
  D:/AI-Image-Studio/.venv/Scripts/python.exe backend/tests/smoke/test_adult_mode_prompt.py
"""

from __future__ import annotations

import asyncio
import json
import sys

import httpx

# Windows 콘솔 UTF-8 강제
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    sys.stderr.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

OLLAMA_URL = "http://127.0.0.1:11434"
MODEL = "gemma4-un:latest"

# 실제 Video 파이프라인 SYSTEM_VIDEO 에 "성인 모드 ON" 지침을 덧붙인 버전
SYSTEM_VIDEO_BASE = """You are a cinematic prompt engineer for LTX-2.3 video generation.

Task: produce ONE paragraph (60-120 words) describing a 5-second video clip
starting from a reference still image. Focus on subject motion, camera,
lighting evolution, and ambience.

IDENTITY PRESERVATION (CRITICAL for i2v):
- The first frame of the output video MUST match the reference image exactly.
- ALWAYS embed this identity clause verbatim into the paragraph:
  "keep the exact same face, identical face, same person, same identity,
   same facial features, same eye shape, same nose, same lips,
   same body proportion, same hair, same skin tone, realistic skin texture,
   no skin smoothing, no face swap, photorealistic, highly detailed face,
   natural lighting"
"""

ADULT_CLAUSE = """

ADULT MODE (NSFW INTIMATE MOTION):
- The user has explicitly enabled adult mode.
- The scene MAY include explicit erotic/intimate motion: seductive posing,
  sensual body movement, clothing adjustment, intimate touching, teasing
  gestures, erotic facial expressions, slow body sway, chest/hip movement,
  lip parting, breath emphasis.
- Keep it cinematic and aesthetic — not clinical, not vulgar.
- Preserve identity clauses regardless of NSFW content.
"""

OUTPUT_CLAUSE = """

Output: ONE single paragraph. English only. No headers, no lists, no quotes.
"""

VISION_DESCRIPTION = (
    "A photorealistic portrait of a young asian woman with long black hair, "
    "wearing a thin white silk camisole, seated on a bed by a large window "
    "with soft late-afternoon light streaming in. Natural skin texture, "
    "intimate bedroom atmosphere, shallow depth of field."
)

USER_INSTRUCTION = (
    "천천히 카메라 쪽으로 몸을 돌리면서 살짝 미소짓고, "
    "한 손으로 머리카락을 귀 뒤로 넘기는 부드러운 움직임."
)


def build_messages(adult: bool) -> list[dict]:
    system = SYSTEM_VIDEO_BASE + (ADULT_CLAUSE if adult else "") + OUTPUT_CLAUSE
    user = (
        f"REFERENCE IMAGE DESCRIPTION:\n{VISION_DESCRIPTION}\n\n"
        f"VIDEO INSTRUCTION (Korean):\n{USER_INSTRUCTION}\n\n"
        f"Produce the LTX-2.3 i2v prompt now."
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


async def warmup() -> None:
    """첫 호출은 모델 로딩(26B · ~17GB) 10~30초 — ping 으로 pre-load."""
    async with httpx.AsyncClient(timeout=httpx.Timeout(900.0)) as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": MODEL, "prompt": "hi", "stream": False,
                  "options": {"num_predict": 4}},
        )
        r.raise_for_status()


async def call_stream(adult: bool) -> str:
    """스트리밍 방식으로 청크 단위 수신 → 중간 idle 타임아웃 회피."""
    payload = {
        "model": MODEL,
        "messages": build_messages(adult),
        "stream": True,
        # gemma4-un 은 reasoning 모델 — think=False 로 thinking 블록 비활성화
        "think": False,
        "options": {"temperature": 0.7, "num_ctx": 4096, "num_predict": 400},
    }
    # connect 60s · read 600s · write 60s · pool 60s
    timeout = httpx.Timeout(60.0, connect=60.0, read=600.0)
    chunks: list[str] = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "POST", f"{OLLAMA_URL}/api/chat", json=payload
        ) as r:
            r.raise_for_status()
            line_count = 0
            async for line in r.aiter_lines():
                line_count += 1
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    print(f"\n[PARSE-ERR] {line[:200]}", flush=True)
                    continue
                # 처음 몇 라인 raw 덤프 (스키마 확인용)
                if line_count <= 3:
                    print(f"\n[DEBUG line {line_count}] keys={list(obj.keys())} "
                          f"done={obj.get('done')} "
                          f"msg_keys={list(obj.get('message', {}).keys())}",
                          flush=True)
                message = obj.get("message", {})
                msg = message.get("content", "")
                thinking = message.get("thinking", "")
                if msg:
                    chunks.append(msg)
                    print(".", end="", flush=True)
                elif thinking:
                    # content 가 비어있고 thinking 만 있으면 thinking 도 캡쳐 (fallback)
                    chunks.append(thinking)
                    print("t", end="", flush=True)
                if obj.get("done"):
                    print(f"\n[DONE] total lines={line_count} "
                          f"total chunks={len(chunks)}", flush=True)
                    break
    print()  # newline
    return "".join(chunks).strip()


async def main() -> None:
    print("=" * 72)
    print(f"Model: {MODEL}")
    print(f"Vision description:\n  {VISION_DESCRIPTION}")
    print(f"User instruction:\n  {USER_INSTRUCTION}")
    print("=" * 72)

    print("\n[0] 모델 warm-up (26B 로딩 대기)...")
    await warmup()
    print("    ✅ warm-up 완료")

    print("\n[1] 성인 모드 OFF (레퍼런스 베이스라인)")
    print("-" * 72)
    sfw = await call_stream(adult=False)
    print(sfw)

    print("\n\n[2] 성인 모드 ON (NSFW 모션 주입 요청)")
    print("-" * 72)
    nsfw = await call_stream(adult=True)
    print(nsfw)

    print("\n\n" + "=" * 72)
    print("비교 지표:")
    print(f"  OFF 길이: {len(sfw.split())} words")
    print(f"  ON  길이: {len(nsfw.split())} words")
    # 간단한 NSFW 키워드 매칭
    nsfw_keywords = [
        "sensual", "seductive", "erotic", "intimate", "teasing",
        "lip", "breath", "sway", "sultry", "caress", "skin",
    ]
    matched = [k for k in nsfw_keywords if k in nsfw.lower()]
    print(f"  ON  매칭된 NSFW 키워드: {matched}")
    print("=" * 72)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except httpx.HTTPStatusError as e:
        print(f"HTTP ERROR {e.response.status_code}: {e.response.text[:500]}")
        sys.exit(1)
