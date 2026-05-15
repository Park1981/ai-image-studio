"""Plan A Phase 1.5 runtime smoke for the Lab Sulphur workflow."""
from __future__ import annotations

import argparse
import asyncio
import io
import sys
from pathlib import Path
from typing import Any

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"


def ensure_backend_path() -> None:
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))


def find_lab_option(option_id: str):
    from studio.lab_presets import LAB_LTX_SULPHUR_PRESET

    for option in LAB_LTX_SULPHUR_PRESET.lora_options:
        if option.id == option_id:
            return option
    raise RuntimeError(f"missing lab lora option: {option_id}")


def make_lab_ltx_model():
    from studio.lab_presets import LAB_LTX_SULPHUR_PRESET
    from studio.presets import VideoLoraEntry, VideoModelPreset

    distill = find_lab_option("distill_sulphur")
    sulphur = find_lab_option("adult_sulphur")

    loras: list[VideoLoraEntry] = [
        VideoLoraEntry(
            name=distill.file_name,
            strength=distill.default_strength,
            role="lightning",
            note=f"runtime smoke sulphur distill · {slot}",
        )
        for slot in distill.applies_to
    ]
    loras.append(
        VideoLoraEntry(
            name=sulphur.file_name,
            strength=sulphur.default_strength,
            role="adult",
            note="runtime smoke sulphur adult",
        )
    )

    return VideoModelPreset(
        display_name=LAB_LTX_SULPHUR_PRESET.display_name,
        tag=LAB_LTX_SULPHUR_PRESET.tag,
        files=LAB_LTX_SULPHUR_PRESET.base_files,
        loras=loras,
        sampling=LAB_LTX_SULPHUR_PRESET.sampling,
        negative_prompt=LAB_LTX_SULPHUR_PRESET.negative_prompt,
    )


def make_probe_png(width: int = 768, height: int = 1024) -> bytes:
    img = Image.new("RGB", (width, height), color=(112, 94, 82))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def build_api_prompt(uploaded_name: str, longer_edge: int) -> dict[str, Any]:
    import studio.comfy_api_builder.video as video_builder

    lab_model = make_lab_ltx_model()
    old_video_model = video_builder.VIDEO_MODEL
    try:
        video_builder.VIDEO_MODEL = lab_model
        return video_builder.build_video_from_request(
            model_id="ltx",
            prompt=(
                "cinematic portrait, subtle head movement, natural breathing, "
                "soft studio light, high detail"
            ),
            source_filename=uploaded_name,
            seed=4242,
            adult=True,
            lightning=True,
            source_width=768,
            source_height=1024,
            longer_edge=longer_edge,
        )
    finally:
        video_builder.VIDEO_MODEL = old_video_model


class ConsoleTask:
    async def emit(self, event: str, payload: dict[str, Any]) -> None:
        if event == "stage":
            label = payload.get("stageLabel") or payload.get("type")
            progress = payload.get("progress")
            print(f"[stage {progress}%] {label}")
            return
        print(f"[{event}] {payload}")


async def run(longer_edge: int, idle_timeout: float, hard_timeout: float) -> int:
    ensure_backend_path()
    from studio.pipelines._dispatch import _dispatch_to_comfy, _save_comfy_video

    image_bytes = make_probe_png()
    task = ConsoleTask()

    result = await _dispatch_to_comfy(
        task,
        lambda uploaded_name: build_api_prompt(str(uploaded_name), longer_edge),
        mode="video",
        progress_start=35,
        progress_span=57,
        client_prefix="lab-sulphur-smoke",
        upload_bytes=image_bytes,
        upload_filename="lab_sulphur_probe.png",
        save_output=_save_comfy_video,
        idle_timeout=idle_timeout,
        hard_timeout=hard_timeout,
    )

    if result.comfy_error:
        print(f"ComfyUI execution_error: {result.comfy_error}", file=sys.stderr)
        return 1
    if not result.image_ref:
        print("MP4 저장 결과 image_ref 없음", file=sys.stderr)
        return 1

    print(f"MP4 저장 성공: {result.image_ref}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--longer-edge", type=int, default=512)
    parser.add_argument("--idle-timeout", type=float, default=1200.0)
    parser.add_argument("--hard-timeout", type=float, default=7200.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    return asyncio.run(
        run(
            longer_edge=args.longer_edge,
            idle_timeout=args.idle_timeout,
            hard_timeout=args.hard_timeout,
        )
    )


if __name__ == "__main__":
    sys.exit(main())
