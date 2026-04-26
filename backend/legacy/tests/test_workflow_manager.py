"""
WorkflowManager 단위 테스트
- 워크플로우 로드 (성공, 파일 없음, JSON 파싱 실패)
- 워크플로우 목록 조회
- build_prompt 파라미터 주입 (KSampler, CLIP, Latent, Checkpoint, VAE)
- build_edit_prompt 파라미터 주입
- LoRA 동적 삽입
"""

import copy

import pytest

from legacy.services.workflow_manager import WorkflowManager
from models.schemas import GenerateRequest, EditRequest, LoraConfig


# ─────────────────────────────────────────────
# 워크플로우 로드 테스트
# ─────────────────────────────────────────────

class TestLoadWorkflow:
    """워크플로우 파일 로드"""

    def test_정상_로드(self, tmp_workflows_dir):
        """존재하는 워크플로우 파일 로드"""
        wm = WorkflowManager()
        wm._workflows_dir = tmp_workflows_dir
        result = wm.load_workflow("txt2img")
        assert isinstance(result, dict)
        assert "1" in result  # 노드가 있어야 함

    def test_파일_없음_에러(self, tmp_workflows_dir):
        """존재하지 않는 워크플로우 → FileNotFoundError"""
        wm = WorkflowManager()
        wm._workflows_dir = tmp_workflows_dir
        with pytest.raises(FileNotFoundError, match="워크플로우 템플릿 없음"):
            wm.load_workflow("nonexistent")

    def test_json_파싱_실패(self, tmp_workflows_dir):
        """잘못된 JSON 파일 → ValueError"""
        wm = WorkflowManager()
        wm._workflows_dir = tmp_workflows_dir
        with pytest.raises(ValueError, match="JSON 파싱 실패"):
            wm.load_workflow("broken")

    def test_path_traversal_방지(self, tmp_workflows_dir):
        """경로 조작 시도 → 안전한 파일명만 사용"""
        wm = WorkflowManager()
        wm._workflows_dir = tmp_workflows_dir
        # "../secret" → "secret.json" 만 탐색 (path traversal 차단)
        with pytest.raises(FileNotFoundError):
            wm.load_workflow("../secret")


class TestListWorkflows:
    """워크플로우 목록 조회"""

    def test_목록_반환(self, tmp_workflows_dir):
        """디렉토리 내 JSON 파일 목록"""
        wm = WorkflowManager()
        wm._workflows_dir = tmp_workflows_dir
        result = wm.list_workflows()
        assert "txt2img" in result
        assert "broken" in result  # 목록은 유효성 검사 안 함

    def test_빈_디렉토리(self, tmp_path):
        """빈 디렉토리 → 빈 목록"""
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        wm = WorkflowManager()
        wm._workflows_dir = empty_dir
        assert wm.list_workflows() == []

    def test_존재하지_않는_디렉토리(self, tmp_path):
        """없는 디렉토리 → 빈 목록"""
        wm = WorkflowManager()
        wm._workflows_dir = tmp_path / "nope"
        assert wm.list_workflows() == []


# ─────────────────────────────────────────────
# build_prompt 테스트
# ─────────────────────────────────────────────

class TestBuildPrompt:
    """GenerateRequest 기반 워크플로우 파라미터 주입"""

    def _make_request(self, **kwargs) -> GenerateRequest:
        """테스트용 GenerateRequest 생성"""
        defaults = {
            "prompt": "a beautiful sunset",
            "negative_prompt": "ugly, blurry",
            "steps": 30,
            "cfg": 5.0,
            "seed": 42,
            "width": 768,
            "height": 512,
            "batch_size": 2,
            "sampler": "dpmpp_2m",
            "scheduler": "karras",
        }
        defaults.update(kwargs)
        return GenerateRequest(**defaults)

    def test_ksampler_파라미터_주입(self, sample_workflow):
        """KSampler 노드에 seed/steps/cfg/sampler/scheduler 주입"""
        wm = WorkflowManager()
        request = self._make_request(seed=42)
        result = wm.build_prompt(request, sample_workflow)

        # KSampler 노드 찾기
        ks_node = result["5"]["inputs"]
        assert ks_node["seed"] == 42
        assert ks_node["steps"] == 30
        assert ks_node["cfg"] == 5.0
        assert ks_node["sampler_name"] == "dpmpp_2m"
        assert ks_node["scheduler"] == "karras"

    def test_clip_text_프롬프트_주입(self, sample_workflow):
        """CLIPTextEncode 노드에 positive/negative 프롬프트 주입"""
        wm = WorkflowManager()
        request = self._make_request()
        result = wm.build_prompt(request, sample_workflow)

        assert result["2"]["inputs"]["text"] == "a beautiful sunset"
        assert result["3"]["inputs"]["text"] == "ugly, blurry"

    def test_latent_사이즈_주입(self, sample_workflow):
        """EmptyLatentImage 노드에 width/height/batch_size 주입"""
        wm = WorkflowManager()
        request = self._make_request(width=768, height=512, batch_size=2)
        result = wm.build_prompt(request, sample_workflow)

        latent = result["4"]["inputs"]
        assert latent["width"] == 768
        assert latent["height"] == 512
        assert latent["batch_size"] == 2

    def test_sd3_latent_주입(self, qwen_workflow):
        """EmptySD3LatentImage 노드에도 정상 주입"""
        wm = WorkflowManager()
        request = self._make_request(width=1024, height=1024, batch_size=1)
        result = wm.build_prompt(request, qwen_workflow)

        latent = result["6"]["inputs"]
        assert latent["width"] == 1024
        assert latent["height"] == 1024

    def test_checkpoint_주입(self, sample_workflow):
        """CheckpointLoaderSimple 노드에 checkpoint 이름 주입"""
        wm = WorkflowManager()
        request = self._make_request(checkpoint="my_model.safetensors")
        result = wm.build_prompt(request, sample_workflow)

        assert result["1"]["inputs"]["ckpt_name"] == "my_model.safetensors"

    def test_checkpoint_미지정시_기본값_유지(self, sample_workflow):
        """checkpoint 빈 문자열 → 워크플로우 기본값 유지"""
        wm = WorkflowManager()
        request = self._make_request(checkpoint="")
        result = wm.build_prompt(request, sample_workflow)

        assert result["1"]["inputs"]["ckpt_name"] == "default_model.safetensors"

    def test_랜덤_시드(self, sample_workflow):
        """seed=-1 → 랜덤 시드 생성"""
        wm = WorkflowManager()
        request = self._make_request(seed=-1)
        result = wm.build_prompt(request, sample_workflow)

        seed = result["5"]["inputs"]["seed"]
        assert 0 <= seed <= 2**32 - 1

    def test_원본_워크플로우_보호(self, sample_workflow):
        """deep copy로 원본 변경 방지"""
        wm = WorkflowManager()
        original = copy.deepcopy(sample_workflow)
        request = self._make_request()
        wm.build_prompt(request, sample_workflow)

        assert sample_workflow == original  # 원본 그대로


# ─────────────────────────────────────────────
# build_edit_prompt 테스트
# ─────────────────────────────────────────────

class TestBuildEditPrompt:
    """EditRequest 기반 수정 워크플로우 파라미터 주입"""

    def _make_edit_request(self, **kwargs) -> EditRequest:
        defaults = {
            "source_image": "test.png",
            "edit_prompt": "change background to ocean",
            "steps": 50,
            "cfg": 4.0,
            "seed": 123,
        }
        defaults.update(kwargs)
        return EditRequest(**defaults)

    def test_소스_이미지_주입(self, edit_workflow):
        """LoadImage 노드에 이미지 파일명 주입"""
        wm = WorkflowManager()
        request = self._make_edit_request()
        result = wm.build_edit_prompt(request, edit_workflow, "comfyui_test.png")

        assert result["2"]["inputs"]["image"] == "comfyui_test.png"

    def test_프롬프트_주입(self, edit_workflow):
        """TextEncodeQwenImageEdit Positive 노드에 프롬프트 주입"""
        wm = WorkflowManager()
        request = self._make_edit_request(edit_prompt="make it blue")
        result = wm.build_edit_prompt(request, edit_workflow, "img.png")

        assert result["3"]["inputs"]["prompt"] == "make it blue"
        assert result["4"]["inputs"]["prompt"] == ""  # Negative는 빈 텍스트

    def test_ksampler_파라미터(self, edit_workflow):
        """KSampler 노드에 seed/steps/cfg 주입"""
        wm = WorkflowManager()
        request = self._make_edit_request(seed=999, steps=30, cfg=3.5)
        result = wm.build_edit_prompt(request, edit_workflow, "img.png")

        ks = result["5"]["inputs"]
        assert ks["seed"] == 999
        assert ks["steps"] == 30
        assert ks["cfg"] == 3.5

    def test_edit_checkpoint_주입(self, edit_workflow):
        """EditRequest에 checkpoint가 있으면 주입"""
        wm = WorkflowManager()
        request = self._make_edit_request(checkpoint="new_ckpt.safetensors")
        result = wm.build_edit_prompt(request, edit_workflow, "img.png")

        assert result["1"]["inputs"]["ckpt_name"] == "new_ckpt.safetensors"

    def test_edit_vae_주입(self, edit_workflow):
        """EditRequest에 vae가 있으면 주입"""
        wm = WorkflowManager()
        request = self._make_edit_request(vae="my_vae.safetensors")
        result = wm.build_edit_prompt(request, edit_workflow, "img.png")

        assert result["6"]["inputs"]["vae_name"] == "my_vae.safetensors"


# ─────────────────────────────────────────────
# LoRA 삽입 테스트
# ─────────────────────────────────────────────

class TestInjectLoras:
    """LoRA 노드 동적 삽입"""

    def test_단일_lora_삽입(self, sample_workflow):
        """1개 LoRA 삽입 → 체크포인트 소비 노드 재연결"""
        wm = WorkflowManager()
        loras = [LoraConfig(name="style_lora.safetensors", strength_model=0.8, strength_clip=0.5)]

        # 원본에서 model 소비자 확인 (KSampler는 [1, 0]을 참조)
        wf = copy.deepcopy(sample_workflow)
        wm._inject_loras(wf, loras)

        # 새 LoRA 노드가 추가됨
        lora_nodes = [
            (nid, nd) for nid, nd in wf.items()
            if isinstance(nd, dict) and nd.get("class_type") == "LoraLoader"
        ]
        assert len(lora_nodes) == 1

        lora_id, lora_data = lora_nodes[0]
        assert lora_data["inputs"]["lora_name"] == "style_lora.safetensors"
        assert lora_data["inputs"]["strength_model"] == 0.8
        assert lora_data["inputs"]["strength_clip"] == 0.5

    def test_다중_lora_체이닝(self, sample_workflow):
        """2개 LoRA → 체인으로 연결"""
        wm = WorkflowManager()
        loras = [
            LoraConfig(name="lora_a.safetensors"),
            LoraConfig(name="lora_b.safetensors"),
        ]

        wf = copy.deepcopy(sample_workflow)
        wm._inject_loras(wf, loras)

        lora_nodes = [
            (nid, nd) for nid, nd in wf.items()
            if isinstance(nd, dict) and nd.get("class_type") == "LoraLoader"
        ]
        assert len(lora_nodes) == 2

        # 두 번째 LoRA가 첫 번째 LoRA의 출력을 입력으로 받아야 함
        first_id = lora_nodes[0][0]
        second_inputs = lora_nodes[1][1]["inputs"]
        assert second_inputs["model"][0] == first_id

    def test_edit_워크플로우_lora_삽입(self, edit_workflow):
        """Edit 워크플로우에서도 LoRA 삽입 정상 동작"""
        wm = WorkflowManager()
        request = EditRequest(
            source_image="test.png",
            edit_prompt="make it red",
            loras=[LoraConfig(name="color_lora.safetensors")],
        )
        result = wm.build_edit_prompt(request, edit_workflow, "img.png")

        lora_nodes = [
            nd for nd in result.values()
            if isinstance(nd, dict) and nd.get("class_type") == "LoraLoader"
        ]
        assert len(lora_nodes) == 1
