"""
workflow_runner 단위 테스트 (실 ComfyUI 불필요, Fake transport).
"""

from __future__ import annotations

import pytest

from studio.presets import GENERATE_MODEL, EDIT_MODEL, get_aspect
from studio.workflow_runner import (
    GenerateInjection,
    EditInjection,
    load_workflow,
    inject_generate,
    inject_edit,
    find_subgraph_instance,
    find_subgraph_definition,
    _widget_positions,
    _find_inner_node,
    build_generate_prompt,
    build_edit_prompt,
    FakeTransport,
)


# ── 로드 ──
class TestLoad:
    def test_load_generate_workflow(self):
        wf = load_workflow(GENERATE_MODEL.workflow)
        assert "nodes" in wf
        assert "definitions" in wf
        # subgraph 정의가 하나 이상 있어야 함
        subs = wf["definitions"].get("subgraphs", [])
        assert any(s["id"] == GENERATE_MODEL.subgraph_id for s in subs)

    def test_load_edit_workflow(self):
        wf = load_workflow(EDIT_MODEL.workflow)
        assert "nodes" in wf
        subs = wf["definitions"].get("subgraphs", [])
        assert any(s["id"] == EDIT_MODEL.subgraph_id for s in subs)

    def test_load_missing_file(self):
        with pytest.raises(FileNotFoundError):
            load_workflow("does_not_exist.json")


# ── subgraph 검색 ──
class TestSubgraph:
    def test_find_generate_instance_and_def(self):
        wf = load_workflow(GENERATE_MODEL.workflow)
        inst = find_subgraph_instance(wf, GENERATE_MODEL.subgraph_id)
        assert inst["type"] == GENERATE_MODEL.subgraph_id
        proxy = inst["properties"]["proxyWidgets"]
        # 주요 widget 모두 포함
        names = [p[1] for p in proxy]
        for w in ["text", "width", "height", "seed", "unet_name", "lora_name"]:
            assert w in names

        defn = find_subgraph_definition(wf, GENERATE_MODEL.subgraph_id)
        assert defn["id"] == GENERATE_MODEL.subgraph_id
        assert len(defn["nodes"]) > 0


# ── 주입 (Generate) ──
class TestInjectGenerate:
    def test_inject_text_and_size(self):
        wf = load_workflow(GENERATE_MODEL.workflow)
        aspect = get_aspect("16:9")
        values = GenerateInjection(
            text="a dramatic cinematic portrait of a cat",
            width=aspect.width,
            height=aspect.height,
            enable_turbo_mode=False,
            seed=123456,
            unet_name=GENERATE_MODEL.files.unet,
            clip_name=GENERATE_MODEL.files.clip,
            vae_name=GENERATE_MODEL.files.vae,
            lora_name=GENERATE_MODEL.loras[0].name,
        )
        inject_generate(wf, GENERATE_MODEL.subgraph_id, values)

        defn = find_subgraph_definition(wf, GENERATE_MODEL.subgraph_id)

        # CLIPTextEncode(positive) node 227 widgets_values[0] 는 텍스트
        pos_node = _find_inner_node(defn, 227)
        assert pos_node["widgets_values"][0] == values.text

        # EmptySD3LatentImage node 232 widgets_values 는 [width, height, batch]
        latent = _find_inner_node(defn, 232)
        assert latent["widgets_values"][0] == aspect.width
        assert latent["widgets_values"][1] == aspect.height

        # UNETLoader 226 widgets_values[0] = unet 파일명
        unet = _find_inner_node(defn, 226)
        assert unet["widgets_values"][0] == values.unet_name

    def test_inject_turbo_mode_flag(self):
        wf = load_workflow(GENERATE_MODEL.workflow)
        values = GenerateInjection(
            text="test",
            width=1024,
            height=1024,
            enable_turbo_mode=True,
            seed=1,
            unet_name="u",
            clip_name="c",
            vae_name="v",
            lora_name="l",
        )
        inject_generate(wf, GENERATE_MODEL.subgraph_id, values)

        defn = find_subgraph_definition(wf, GENERATE_MODEL.subgraph_id)
        # PrimitiveBoolean node 229 "Enable 4 Steps LoRA?"
        bool_node = _find_inner_node(defn, 229)
        assert bool_node["widgets_values"][0] is True

    def test_seed_injection(self):
        wf = load_workflow(GENERATE_MODEL.workflow)
        values = GenerateInjection(
            text="x",
            width=1024,
            height=1024,
            enable_turbo_mode=False,
            seed=999_888_777,
            unet_name="u",
            clip_name="c",
            vae_name="v",
            lora_name="l",
        )
        inject_generate(wf, GENERATE_MODEL.subgraph_id, values)
        defn = find_subgraph_definition(wf, GENERATE_MODEL.subgraph_id)
        # KSampler 230 — widgets_values 은 [seed, control_after_generate, steps, cfg, sampler, scheduler, denoise]
        ks = _find_inner_node(defn, 230)
        assert ks["widgets_values"][0] == 999_888_777


# ── 주입 (Edit) ──
class TestInjectEdit:
    def test_inject_prompt_and_lightning(self):
        wf = load_workflow(EDIT_MODEL.workflow)
        values = EditInjection(
            prompt="change background to beach",
            enable_turbo_mode=True,
            seed=42,
            unet_name=EDIT_MODEL.files.unet,
            clip_name=EDIT_MODEL.files.clip,
            vae_name=EDIT_MODEL.files.vae,
            lora_name=EDIT_MODEL.loras[0].name,
            image_filename="input.png",
        )
        inject_edit(wf, EDIT_MODEL.subgraph_id, values)

        defn = find_subgraph_definition(wf, EDIT_MODEL.subgraph_id)

        # TextEncodeQwenImageEditPlus (positive) node 151 widgets_values[0] = prompt
        pos_node = _find_inner_node(defn, 151)
        assert pos_node["widgets_values"][0] == values.prompt

        # PrimitiveBoolean 168 "Enable 4steps LoRA?"
        bool_node = _find_inner_node(defn, 168)
        assert bool_node["widgets_values"][0] is True

    def test_image_filename_substitution(self):
        wf = load_workflow(EDIT_MODEL.workflow)
        values = EditInjection(
            prompt="x",
            enable_turbo_mode=False,
            seed=1,
            unet_name="u",
            clip_name="c",
            vae_name="v",
            lora_name="l",
            image_filename="my_upload.png",
        )
        inject_edit(wf, EDIT_MODEL.subgraph_id, values)

        # 최상위 LoadImage (mode != 4) widgets_values[0] == "my_upload.png"
        found = False
        for node in wf["nodes"]:
            if node.get("type") == "LoadImage" and node.get("mode", 0) != 4:
                assert node["widgets_values"][0] == "my_upload.png"
                found = True
                break
        assert found, "Active LoadImage node not found"


# ── widget position 계산 ──
class TestWidgetPositions:
    def test_widget_positions_basic(self):
        # CLIPTextEncode 구조 (실제 노드에서 샘플)
        node = {
            "inputs": [
                {"name": "clip", "type": "CLIP", "link": 314},
                {
                    "name": "text",
                    "type": "STRING",
                    "widget": {"name": "text"},
                    "link": 360,
                },
            ],
            "widgets_values": ["original text"],
        }
        positions = _widget_positions(node)
        assert positions == {"text": 0}


# ── entry point 통합 ──
class TestBuildPrompts:
    def test_build_generate_prompt(self):
        aspect = get_aspect("1:1")
        values = GenerateInjection(
            text="test prompt",
            width=aspect.width,
            height=aspect.height,
            enable_turbo_mode=False,
            seed=42,
            unet_name=GENERATE_MODEL.files.unet,
            clip_name=GENERATE_MODEL.files.clip,
            vae_name=GENERATE_MODEL.files.vae,
            lora_name=GENERATE_MODEL.loras[0].name,
        )
        wf, api = build_generate_prompt(
            GENERATE_MODEL.workflow, GENERATE_MODEL.subgraph_id, values
        )
        assert isinstance(wf, dict)
        assert isinstance(api, dict)
        assert len(api) > 0

    def test_build_edit_prompt(self):
        values = EditInjection(
            prompt="test",
            enable_turbo_mode=False,
            seed=1,
            unet_name=EDIT_MODEL.files.unet,
            clip_name=EDIT_MODEL.files.clip,
            vae_name=EDIT_MODEL.files.vae,
            lora_name=EDIT_MODEL.loras[0].name,
            image_filename=None,
        )
        wf, api = build_edit_prompt(
            EDIT_MODEL.workflow, EDIT_MODEL.subgraph_id, values
        )
        assert isinstance(wf, dict)
        assert isinstance(api, dict)


# ── FakeTransport ──
class TestFakeTransport:
    @pytest.mark.asyncio
    async def test_submit_and_buffer(self):
        t = FakeTransport()
        prompt_id = await t.submit({"test": "prompt"}, "client-1")
        assert prompt_id == "fake-prompt-1"
        assert len(t.submitted) == 1
        assert t.submitted[0][1] == "client-1"
        await t.close()
