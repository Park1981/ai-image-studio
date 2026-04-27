from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import asdict
from pathlib import Path

import pytest

from studio.presets import (
    ASPECT_RATIOS,
    DEFAULT_OLLAMA_ROLES,
    EDIT_MODEL,
    GENERATE_MODEL,
    GENERATE_STYLES,
)


ROOT_DIR = Path(__file__).resolve().parents[3]
FRONTEND_DIR = ROOT_DIR / "frontend"


def _frontend_preset_snapshot() -> dict:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not available; cannot verify frontend model presets")

    script = """
const fs = require("fs");
const ts = require("typescript");
const source = fs.readFileSync("lib/model-presets.ts", "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleObj = { exports: {} };
new Function("module", "exports", "require", js)(moduleObj, moduleObj.exports, require);
const m = moduleObj.exports;
console.log(JSON.stringify({
  aspectRatios: m.ASPECT_RATIOS,
  generate: m.GENERATE_MODEL,
  edit: m.EDIT_MODEL,
  ollama: m.DEFAULT_OLLAMA_MODELS,
  generateStyles: m.GENERATE_STYLES,
}));
"""
    result = subprocess.run(
        [node, "-e", script],
        cwd=FRONTEND_DIR,
        text=True,
        encoding="utf-8",
        capture_output=True,
        timeout=20,
        check=False,
    )
    if result.returncode != 0:
        pytest.skip(f"frontend preset export unavailable: {result.stderr.strip()}")
    return json.loads(result.stdout)


def _sampling_defaults_snapshot(defaults) -> dict:
    return {
        "steps": defaults.steps,
        "cfg": defaults.cfg,
        "sampler": defaults.sampler,
        "scheduler": defaults.scheduler,
        "shift": defaults.shift,
        "batchSize": defaults.batch_size,
        "seed": defaults.seed,
    }


def _lightning_snapshot(lightning) -> dict:
    return {"steps": lightning.steps, "cfg": lightning.cfg}


def _lora_snapshot(loras) -> list[dict]:
    return [asdict(lora) for lora in loras]


def test_frontend_model_presets_match_backend_contract() -> None:
    frontend = _frontend_preset_snapshot()

    assert frontend["aspectRatios"] == [asdict(a) for a in ASPECT_RATIOS]

    assert frontend["generate"]["displayName"] == GENERATE_MODEL.display_name
    assert frontend["generate"]["tag"] == GENERATE_MODEL.tag
    assert frontend["generate"]["workflow"] == GENERATE_MODEL.workflow
    assert frontend["generate"]["subgraphId"] == GENERATE_MODEL.subgraph_id
    assert frontend["generate"]["files"] == asdict(GENERATE_MODEL.files)
    assert frontend["generate"]["loras"] == _lora_snapshot(GENERATE_MODEL.loras)
    assert frontend["generate"]["defaults"] == {
        "aspect": GENERATE_MODEL.default_aspect,
        **_sampling_defaults_snapshot(GENERATE_MODEL.defaults),
    }
    assert frontend["generate"]["lightning"] == _lightning_snapshot(
        GENERATE_MODEL.lightning
    )
    assert frontend["generate"]["negativePrompt"] == GENERATE_MODEL.negative_prompt

    assert frontend["edit"]["displayName"] == EDIT_MODEL.display_name
    assert frontend["edit"]["tag"] == EDIT_MODEL.tag
    assert frontend["edit"]["workflow"] == EDIT_MODEL.workflow
    assert frontend["edit"]["subgraphId"] == EDIT_MODEL.subgraph_id
    assert frontend["edit"]["files"] == asdict(EDIT_MODEL.files)
    assert frontend["edit"]["loras"] == _lora_snapshot(EDIT_MODEL.loras)
    edit_defaults = frontend["edit"]["defaults"].copy()
    edit_defaults.pop("cfgNorm", None)
    assert edit_defaults == _sampling_defaults_snapshot(EDIT_MODEL.defaults)
    assert frontend["edit"]["lightning"] == _lightning_snapshot(EDIT_MODEL.lightning)
    assert frontend["edit"]["referenceLatentMethod"] == EDIT_MODEL.reference_latent_method
    assert frontend["edit"]["autoScaleReferenceImage"] is EDIT_MODEL.auto_scale_reference
    assert frontend["edit"]["maxReferenceImages"] == EDIT_MODEL.max_reference_images

    assert frontend["ollama"] == asdict(DEFAULT_OLLAMA_ROLES)
    assert [
        {
            "id": style.id,
            "displayName": style.display_name,
            "description": style.description,
            "incompatibleWithLightning": style.incompatible_with_lightning,
        }
        for style in GENERATE_STYLES
    ] == frontend["generateStyles"]
