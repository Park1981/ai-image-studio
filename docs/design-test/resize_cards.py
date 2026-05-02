"""
카드 배경 이미지 리사이즈 + WebP 변환.

ChatGPT Image 2.0 원본 (1.7~1.9MB PNG) → @1x (1024 max) + @2x (2048 max) WebP.
원본은 raw/ 로 백업 (한국어 파일명 → 의미 있는 파일명).
"""

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).parent / "assets"
RAW = ROOT / "raw"
RAW.mkdir(exist_ok=True)

# 시간순 = 카드 순서 (확정 매칭)
MAPPING = {
    "ChatGPT Image 2026년 5월 1일 오후 05_18_03.png": "ai",            # violet · 마법
    "ChatGPT Image 2026년 5월 1일 오후 05_21_23.png": "fast",          # cyan · 네온
    "ChatGPT Image 2026년 5월 1일 오후 05_21_27.png": "claude",        # amber · 골든아워
    "ChatGPT Image 2026년 5월 1일 오후 06_30_41.png": "auto-compare",  # teal/emerald · 안경 분석가
    # 옛 slate (사용 안 함 · 백업명 _slate-old 으로 보관) — 실제 시안은 아래 핑크 사용
    "ChatGPT Image 2026년 5월 1일 오후 06_53_21.png": "size",          # rose/pink · architect 포즈
    "ChatGPT Image 2026년 5월 1일 오후 06_54_32.png": "multi-ref",     # rose/pink · curator 포즈
    "ChatGPT Image 2026년 5월 1일 오후 07_12_46.png": "adult",         # crimson · sultry editorial (옛 · raw/card-bg-adult-old.png 보존)
    # 2026-05-01 저녁: adult 갱신 — edit-2322-010.png 로 교체 (red rim light + 검정 배경 · crimson 시그니처 더 강함)
    # raw 폴더에서 직접 inline 처리됨 → raw/card-bg-adult-raw.png 가 새 원본
    "edit-2322-010.png": "adult",
}


def process(src: Path, role: str) -> None:
    """원본 → raw 백업 + @1x/@2x WebP 출력."""
    backup = RAW / f"card-bg-{role}-raw.png"
    out_1x = ROOT / f"card-bg-{role}.webp"
    out_2x = ROOT / f"card-bg-{role}@2x.webp"

    # 원본 → raw 백업 (이동)
    src.rename(backup)
    print(f"[backup] role={role} -> raw/{backup.name}")

    img = Image.open(backup).convert("RGB")
    print(f"  source: {img.size}")

    # @1x — 가장 긴 변 1024 으로 정규화 (비율 유지)
    img1x = img.copy()
    img1x.thumbnail((1024, 1024), Image.LANCZOS)
    img1x.save(out_1x, "WEBP", quality=85, method=6)
    size_1x = out_1x.stat().st_size / 1024
    print(f"  @1x: {img1x.size} {size_1x:.0f}KB")

    # @2x — 가장 긴 변 2048 으로 정규화 (레티나 디스플레이)
    img2x = img.copy()
    img2x.thumbnail((2048, 2048), Image.LANCZOS)
    img2x.save(out_2x, "WEBP", quality=85, method=6)
    size_2x = out_2x.stat().st_size / 1024
    print(f"  @2x: {img2x.size} {size_2x:.0f}KB\n")


def main() -> None:
    print(f"resize start - out: {ROOT}\n")
    for src_name, role in MAPPING.items():
        src = ROOT / src_name
        if not src.exists():
            print(f"[skip] not found: role={role}")
            continue
        process(src, role)
    print("done.")


if __name__ == "__main__":
    main()
