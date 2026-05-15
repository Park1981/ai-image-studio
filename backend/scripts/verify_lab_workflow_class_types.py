"""Plan A Phase 1.5 static validation for the Lab Sulphur workflow.

Validation:
  1. Build the generated Lab Sulphur workflow from real repo code.
  2. Ensure every generated class_type exists in captured ComfyUI /object_info.
  3. Ensure Sulphur LoRA names exist in LoraLoaderModelOnly.lora_name enum.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
CAPTURE_PATH = Path(__file__).resolve().parent / "_capture_object_info.json"

REQUIRED_LORA_FILES = {
    "sulphur_lora_rank_768.safetensors",
    "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
}


def ensure_backend_path() -> None:
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))


def load_capture() -> dict[str, Any]:
    if not CAPTURE_PATH.exists():
        print(
            f"{CAPTURE_PATH} 없음. 먼저 capture_comfy_object_info.py 를 실행하세요.",
            file=sys.stderr,
        )
        sys.exit(2)
    return json.loads(CAPTURE_PATH.read_text(encoding="utf-8"))


def find_lab_option(option_id: str):
    from studio.lab_presets import LAB_LTX_SULPHUR_PRESET

    for option in LAB_LTX_SULPHUR_PRESET.lora_options:
        if option.id == option_id:
            return option
    raise RuntimeError(f"missing lab lora option: {option_id}")


def make_lab_ltx_model():
    """Create a temporary LTX preset using only Sulphur distill + Sulphur LoRA."""

    from studio.lab_presets import LAB_LTX_SULPHUR_PRESET
    from studio.presets import VideoLoraEntry, VideoModelPreset

    distill = find_lab_option("distill_sulphur")
    sulphur = find_lab_option("adult_sulphur")

    loras: list[VideoLoraEntry] = [
        VideoLoraEntry(
            name=distill.file_name,
            strength=distill.default_strength,
            role="lightning",
            note=f"lab sulphur distill · {slot}",
        )
        for slot in distill.applies_to
    ]
    loras.append(
        VideoLoraEntry(
            name=sulphur.file_name,
            strength=sulphur.default_strength,
            role="adult",
            note="lab sulphur adult",
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


def build_lab_api_prompt() -> dict[str, Any]:
    ensure_backend_path()
    import studio.comfy_api_builder.video as video_builder

    lab_model = make_lab_ltx_model()
    old_video_model = video_builder.VIDEO_MODEL
    try:
        video_builder.VIDEO_MODEL = lab_model
        return video_builder.build_video_from_request(
            model_id="ltx",
            prompt="beautiful cinematic motion, safe compatibility probe",
            source_filename="lab_sulphur_probe.png",
            seed=42,
            adult=True,
            lightning=True,
            source_width=768,
            source_height=1024,
            longer_edge=512,
        )
    finally:
        video_builder.VIDEO_MODEL = old_video_model


def extract_lora_enum(info: dict[str, Any]) -> list[str]:
    node = info.get("LoraLoaderModelOnly")
    if not isinstance(node, dict):
        return []
    required = node.get("input", {}).get("required", {})
    lora_name = required.get("lora_name")
    if not isinstance(lora_name, list) or not lora_name:
        return []
    enum_list = lora_name[0]
    return [str(item) for item in enum_list] if isinstance(enum_list, list) else []


def enum_contains(enum_list: list[str], target_basename: str) -> tuple[bool, str | None]:
    if target_basename in enum_list:
        return True, target_basename
    for entry in enum_list:
        if entry.endswith("/" + target_basename) or entry.endswith("\\" + target_basename):
            return True, entry
    return False, None


def workflow_class_types(api_prompt: dict[str, Any]) -> set[str]:
    return {
        str(node.get("class_type"))
        for node in api_prompt.values()
        if isinstance(node, dict) and node.get("class_type")
    }


def workflow_lora_names(api_prompt: dict[str, Any]) -> list[str]:
    return [
        str(node["inputs"]["lora_name"])
        for node in api_prompt.values()
        if isinstance(node, dict)
        and node.get("class_type") == "LoraLoaderModelOnly"
        and isinstance(node.get("inputs"), dict)
        and node["inputs"].get("lora_name")
    ]


def main() -> int:
    ensure_backend_path()
    info = load_capture()
    enum_list = extract_lora_enum(info)
    api_prompt = build_lab_api_prompt()
    required_class_types = workflow_class_types(api_prompt)
    generated_loras = workflow_lora_names(api_prompt)

    print(f"Generated workflow nodes: {len(api_prompt)}")
    print(f"Generated class_type: {len(required_class_types)}")
    print(f"Generated LoRA nodes: {generated_loras}")
    print(f"ComfyUI 가 인식하는 LoRA: {len(enum_list)} 개")
    print()

    lora_pass = 0
    for target in sorted(REQUIRED_LORA_FILES):
        ok, found_as = enum_contains(enum_list, target)
        if ok:
            print(f"LoRA enum 발견: {found_as}")
            lora_pass += 1
        else:
            print(f"LoRA enum 누락: {target}")

    print()

    generated_lora_pass = 0
    for name in generated_loras:
        ok, found_as = enum_contains(enum_list, name)
        if ok:
            print(f"workflow LoRA enum 매칭: {name} -> {found_as}")
            generated_lora_pass += 1
        else:
            print(f"workflow LoRA enum 매칭 실패: {name}")

    print()

    type_pass = 0
    for class_type in sorted(required_class_types):
        if class_type in info:
            print(f"class_type {class_type} 존재")
            type_pass += 1
        else:
            print(f"class_type {class_type} 누락 - custom node 미설치 가능성")

    print()
    print(
        f"통과: {lora_pass} / {len(REQUIRED_LORA_FILES)} 필수 LoRA · "
        f"{generated_lora_pass} / {len(generated_loras)} workflow LoRA · "
        f"{type_pass} / {len(required_class_types)} class_type"
    )

    if (
        lora_pass < len(REQUIRED_LORA_FILES)
        or generated_lora_pass < len(generated_loras)
        or type_pass < len(required_class_types)
    ):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
