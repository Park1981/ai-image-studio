"""Unit tests for studio.lab_presets.

Plan A: Video Lab Sulphur preset hard blocker.
"""
from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from studio.lab_presets import (
    LAB_LTX_SULPHUR_PRESET,
    LAB_VIDEO_PRESETS,
    LabLoraOption,
    get_lab_video_preset,
)


class TestLabLoraOption:
    def test_is_frozen_dataclass(self) -> None:
        option = LabLoraOption(
            id="test_id",
            display_name="Test",
            file_name="test.safetensors",
            default_strength=0.5,
        )
        with pytest.raises(FrozenInstanceError):
            option.id = "changed"  # type: ignore[misc]

    def test_default_role_is_adult(self) -> None:
        option = LabLoraOption(
            id="x",
            display_name="X",
            file_name="x.safetensors",
            default_strength=0.5,
        )
        assert option.role == "adult"

    def test_default_applies_to_single(self) -> None:
        option = LabLoraOption(
            id="x",
            display_name="X",
            file_name="x.safetensors",
            default_strength=0.5,
        )
        assert option.applies_to == ("single",)

    def test_lightning_applies_to_base_upscale(self) -> None:
        option = LabLoraOption(
            id="lightning_test",
            display_name="Test",
            file_name="test.safetensors",
            default_strength=0.5,
            role="lightning",
            applies_to=("base", "upscale"),
        )
        assert option.applies_to == ("base", "upscale")
        assert option.role == "lightning"


class TestLabVideoModelPreset:
    def test_is_frozen(self) -> None:
        with pytest.raises(FrozenInstanceError):
            LAB_LTX_SULPHUR_PRESET.id = "changed"  # type: ignore[misc]

    def test_sulphur_preset_id(self) -> None:
        assert LAB_LTX_SULPHUR_PRESET.id == "ltx-sulphur"

    def test_sulphur_preset_display_name(self) -> None:
        assert "Lab" in LAB_LTX_SULPHUR_PRESET.display_name
        assert LAB_LTX_SULPHUR_PRESET.display_name == "LTX 2.3 · Sulphur Lab"

    def test_sulphur_preset_has_only_sulphur_adult_lora(self) -> None:
        assert len(LAB_LTX_SULPHUR_PRESET.lora_options) == 3
        ids = {opt.id for opt in LAB_LTX_SULPHUR_PRESET.lora_options}
        assert ids == {
            "distill_default",
            "distill_sulphur",
            "adult_sulphur",
        }

    def test_distill_options_apply_to_base_upscale(self) -> None:
        distill_opts = [
            opt
            for opt in LAB_LTX_SULPHUR_PRESET.lora_options
            if opt.role == "lightning"
        ]
        assert len(distill_opts) == 2
        for opt in distill_opts:
            assert opt.applies_to == ("base", "upscale")

    def test_adult_options_apply_to_single(self) -> None:
        adult_opts = [
            opt for opt in LAB_LTX_SULPHUR_PRESET.lora_options if opt.role == "adult"
        ]
        assert len(adult_opts) == 1
        for opt in adult_opts:
            assert opt.applies_to == ("single",)

    def test_sulphur_lora_file_name(self) -> None:
        opt = next(
            opt
            for opt in LAB_LTX_SULPHUR_PRESET.lora_options
            if opt.id == "adult_sulphur"
        )
        assert opt.file_name == "sulphur_lora_rank_768.safetensors"
        assert opt.default_strength == 0.7

    def test_sulphur_distill_file_name(self) -> None:
        opt = next(
            opt
            for opt in LAB_LTX_SULPHUR_PRESET.lora_options
            if opt.id == "distill_sulphur"
        )
        assert opt.file_name == (
            "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"
        )

    def test_default_distill_matches_production(self) -> None:
        from studio.presets import LTX_VIDEO_PRESET

        opt = next(
            opt
            for opt in LAB_LTX_SULPHUR_PRESET.lora_options
            if opt.id == "distill_default"
        )
        production_distill_names = {
            entry.name for entry in LTX_VIDEO_PRESET.loras if entry.role == "lightning"
        }
        assert opt.file_name in production_distill_names

    def test_sampling_reuses_ltx_production(self) -> None:
        from studio.presets import LTX_VIDEO_PRESET

        assert LAB_LTX_SULPHUR_PRESET.sampling is LTX_VIDEO_PRESET.sampling


class TestLabPresetDispatch:
    def test_dispatch_known_id(self) -> None:
        result = get_lab_video_preset("ltx-sulphur")
        assert result is LAB_LTX_SULPHUR_PRESET

    def test_dispatch_unknown_raises(self) -> None:
        with pytest.raises(ValueError, match="unknown lab video preset"):
            get_lab_video_preset("nonexistent-preset")

    def test_lab_video_presets_list_contains_sulphur(self) -> None:
        assert LAB_LTX_SULPHUR_PRESET in LAB_VIDEO_PRESETS
        assert len(LAB_VIDEO_PRESETS) >= 1
