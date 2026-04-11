"""
ComfyUI 워크플로우 템플릿 관리
- JSON 템플릿 로드 (workflows/ 디렉토리)
- GenerateRequest 기반 파라미터 주입
- LoRA 노드 동적 삽입
"""

import copy
import json
import logging
import random
from pathlib import Path
from typing import Any

from config import settings
from models.schemas import GenerateRequest, LoraConfig

logger = logging.getLogger(__name__)

# 랜덤 시드 범위 (ComfyUI 호환)
_MAX_SEED: int = 2**32 - 1

# 노드 class_type 매핑 (ComfyUI API 포맷)
_NODE_KSAMPLER: str = "KSampler"
_NODE_CLIP_TEXT_POSITIVE: str = "CLIPTextEncode"
_NODE_EMPTY_LATENT: str = "EmptyLatentImage"
_NODE_CHECKPOINT_LOADER: str = "CheckpointLoaderSimple"
_NODE_VAE_LOADER: str = "VAELoader"
_NODE_LORA_LOADER: str = "LoraLoader"


class WorkflowManager:
    """워크플로우 JSON 템플릿 로드 및 파라미터 주입"""

    def __init__(self) -> None:
        self._workflows_dir = Path(settings.workflows_path)

    # ─────────────────────────────────────────────
    # 템플릿 로드
    # ─────────────────────────────────────────────

    def load_workflow(self, name: str) -> dict[str, Any]:
        """
        워크플로우 JSON 템플릿 로드
        매개변수:
            name: 템플릿 이름 (확장자 제외, 예: "txt2img")
        반환: 워크플로우 딕셔너리 (ComfyUI API 포맷)
        """
        # path traversal 방지: 파일명 부분만 사용
        safe_name = Path(name).name
        file_path = self._workflows_dir / f"{safe_name}.json"

        if not file_path.exists():
            raise FileNotFoundError(
                f"워크플로우 템플릿 없음: {file_path}"
            )

        try:
            with open(file_path, encoding="utf-8") as f:
                workflow = json.load(f)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"워크플로우 JSON 파싱 실패 ({file_path}): {exc}"
            ) from exc

        logger.info("워크플로우 로드 완료: %s", file_path.name)
        return workflow

    def list_workflows(self) -> list[str]:
        """사용 가능한 워크플로우 목록 반환 (확장자 제외)"""
        if not self._workflows_dir.exists():
            return []

        return [
            p.stem
            for p in sorted(self._workflows_dir.glob("*.json"))
        ]

    # ─────────────────────────────────────────────
    # 파라미터 주입 (메인 빌드)
    # ─────────────────────────────────────────────

    def build_prompt(
        self,
        request: GenerateRequest,
        workflow: dict[str, Any],
    ) -> dict[str, Any]:
        """
        워크플로우에 GenerateRequest 파라미터 주입
        - deep copy 후 수정하여 원본 보호
        - 각 노드를 class_type으로 탐색하여 값 설정
        """
        # 원본 워크플로우 보호
        prompt = copy.deepcopy(workflow)

        # 시드 처리: -1이면 랜덤 생성
        seed = request.seed
        if seed < 0:
            seed = random.randint(0, _MAX_SEED)

        # 각 노드 파라미터 주입
        self._inject_ksampler(prompt, request, seed)
        self._inject_clip_text(prompt, request)
        self._inject_empty_latent(prompt, request)
        self._inject_checkpoint(prompt, request)
        self._inject_vae(prompt, request)

        # LoRA 주입 (있는 경우)
        if request.loras:
            self._inject_loras(prompt, request.loras)

        logger.info(
            "워크플로우 빌드 완료: seed=%d, steps=%d, size=%dx%d",
            seed,
            request.steps,
            request.width,
            request.height,
        )
        return prompt

    # ─────────────────────────────────────────────
    # 노드 탐색 헬퍼
    # ─────────────────────────────────────────────

    def _find_nodes_by_class(
        self,
        workflow: dict[str, Any],
        class_type: str,
    ) -> list[tuple[str, dict[str, Any]]]:
        """
        class_type으로 워크플로우 노드 탐색
        반환: [(node_id, node_data), ...]
        """
        results = []
        for node_id, node_data in workflow.items():
            if not isinstance(node_data, dict):
                continue
            if node_data.get("class_type") == class_type:
                results.append((node_id, node_data))
        return results

    def _find_node_by_class(
        self,
        workflow: dict[str, Any],
        class_type: str,
    ) -> tuple[str, dict[str, Any]] | None:
        """class_type으로 첫 번째 노드 탐색 (없으면 None)"""
        nodes = self._find_nodes_by_class(workflow, class_type)
        return nodes[0] if nodes else None

    # ─────────────────────────────────────────────
    # 개별 노드 주입
    # ─────────────────────────────────────────────

    def _inject_ksampler(
        self,
        workflow: dict[str, Any],
        request: GenerateRequest,
        seed: int,
    ) -> None:
        """KSampler 노드에 샘플링 파라미터 주입"""
        result = self._find_node_by_class(workflow, _NODE_KSAMPLER)
        if result is None:
            logger.warning("KSampler 노드 없음 — 샘플링 파라미터 주입 건너뜀")
            return

        _node_id, node = result
        inputs = node.setdefault("inputs", {})
        inputs["seed"] = seed
        inputs["steps"] = request.steps
        inputs["cfg"] = request.cfg
        inputs["sampler_name"] = request.sampler
        inputs["scheduler"] = request.scheduler
        inputs["denoise"] = 1.0  # txt2img 기본값

    def _inject_clip_text(
        self,
        workflow: dict[str, Any],
        request: GenerateRequest,
    ) -> None:
        """
        CLIPTextEncode 노드에 프롬프트 주입
        - 첫 번째 CLIPTextEncode → 긍정 프롬프트
        - 두 번째 CLIPTextEncode → 부정 프롬프트

        주의: 워크플로우에서 positive/negative 노드 순서가
              항상 동일하다고 가정. 커스텀 워크플로우에서는
              _meta.title로 구분하는 것이 더 안전할 수 있음.
        """
        clip_nodes = self._find_nodes_by_class(workflow, _NODE_CLIP_TEXT_POSITIVE)

        if not clip_nodes:
            logger.warning("CLIPTextEncode 노드 없음 — 프롬프트 주입 건너뜀")
            return

        # 첫 번째 = 긍정 프롬프트
        _pos_id, pos_node = clip_nodes[0]
        pos_inputs = pos_node.setdefault("inputs", {})
        pos_inputs["text"] = request.prompt

        # 두 번째 = 부정 프롬프트 (있을 경우)
        if len(clip_nodes) >= 2:
            _neg_id, neg_node = clip_nodes[1]
            neg_inputs = neg_node.setdefault("inputs", {})
            neg_inputs["text"] = request.negative_prompt

    def _inject_empty_latent(
        self,
        workflow: dict[str, Any],
        request: GenerateRequest,
    ) -> None:
        """EmptyLatentImage 노드에 이미지 크기/배치 주입"""
        result = self._find_node_by_class(workflow, _NODE_EMPTY_LATENT)
        if result is None:
            logger.warning("EmptyLatentImage 노드 없음 — 크기 설정 건너뜀")
            return

        _node_id, node = result
        inputs = node.setdefault("inputs", {})
        inputs["width"] = request.width
        inputs["height"] = request.height
        inputs["batch_size"] = request.batch_size

    def _inject_checkpoint(
        self,
        workflow: dict[str, Any],
        request: GenerateRequest,
    ) -> None:
        """CheckpointLoaderSimple 노드에 체크포인트 이름 주입"""
        if not request.checkpoint:
            return  # 미지정 시 워크플로우 기본값 유지

        result = self._find_node_by_class(workflow, _NODE_CHECKPOINT_LOADER)
        if result is None:
            logger.warning("CheckpointLoaderSimple 노드 없음 — 체크포인트 설정 건너뜀")
            return

        _node_id, node = result
        inputs = node.setdefault("inputs", {})
        inputs["ckpt_name"] = request.checkpoint

    def _inject_vae(
        self,
        workflow: dict[str, Any],
        request: GenerateRequest,
    ) -> None:
        """VAELoader 노드에 VAE 이름 주입"""
        if not request.vae:
            return  # 미지정 시 워크플로우 기본값 유지

        result = self._find_node_by_class(workflow, _NODE_VAE_LOADER)
        if result is None:
            logger.warning("VAELoader 노드 없음 — VAE 설정 건너뜀")
            return

        _node_id, node = result
        inputs = node.setdefault("inputs", {})
        inputs["vae_name"] = request.vae

    # ─────────────────────────────────────────────
    # LoRA 동적 삽입
    # ─────────────────────────────────────────────

    def _inject_loras(
        self,
        workflow: dict[str, Any],
        loras: list[LoraConfig],
    ) -> None:
        """
        LoRA 노드를 체크포인트와 KSampler 사이에 체인으로 삽입
        - 기존 LoraLoader가 있으면 첫 번째 것의 연결을 기준으로 삽입
        - 없으면 CheckpointLoaderSimple 출력을 가로채서 삽입

        동작 원리:
        1. 체크포인트 노드의 MODEL/CLIP 출력을 받는 노드 찾기
        2. 첫 번째 LoRA가 체크포인트 출력을 입력으로 받음
        3. 다음 LoRA는 이전 LoRA의 출력을 입력으로 받음 (체이닝)
        4. 마지막 LoRA의 출력을 원래 소비 노드에 연결
        """
        # 체크포인트 노드 찾기
        ckpt_result = self._find_node_by_class(workflow, _NODE_CHECKPOINT_LOADER)
        if ckpt_result is None:
            logger.warning("CheckpointLoaderSimple 노드 없음 — LoRA 삽입 불가")
            return

        ckpt_id, _ckpt_node = ckpt_result

        # 새 노드 ID 생성 (기존 최대 ID + 1부터)
        existing_ids = [
            int(k) for k in workflow.keys() if k.isdigit()
        ]
        next_id = max(existing_ids, default=0) + 1

        # 체크포인트의 MODEL(0번)/CLIP(1번) 출력을 참조하는 노드 찾기
        model_consumers = self._find_input_references(workflow, ckpt_id, 0)
        clip_consumers = self._find_input_references(workflow, ckpt_id, 1)

        # LoRA 체인 생성
        prev_model_source: list = [ckpt_id, 0]  # [노드ID, 출력슬롯]
        prev_clip_source: list = [ckpt_id, 1]

        lora_node_ids: list[str] = []

        for lora in loras:
            lora_node_id = str(next_id)
            next_id += 1

            workflow[lora_node_id] = {
                "class_type": _NODE_LORA_LOADER,
                "inputs": {
                    "lora_name": lora.name,
                    "strength_model": lora.strength_model,
                    "strength_clip": lora.strength_clip,
                    "model": prev_model_source.copy(),
                    "clip": prev_clip_source.copy(),
                },
            }

            # 다음 LoRA의 입력을 현재 LoRA의 출력으로 설정
            prev_model_source = [lora_node_id, 0]
            prev_clip_source = [lora_node_id, 1]
            lora_node_ids.append(lora_node_id)

        # 원래 체크포인트 출력을 참조하던 노드들을 마지막 LoRA 출력으로 변경
        last_lora_id = lora_node_ids[-1]

        for consumer_id, input_name in model_consumers:
            workflow[consumer_id]["inputs"][input_name] = [last_lora_id, 0]

        for consumer_id, input_name in clip_consumers:
            workflow[consumer_id]["inputs"][input_name] = [last_lora_id, 1]

        logger.info(
            "LoRA %d개 삽입 완료: %s",
            len(loras),
            ", ".join(lora.name for lora in loras),
        )

    def _find_input_references(
        self,
        workflow: dict[str, Any],
        source_node_id: str,
        source_slot: int,
    ) -> list[tuple[str, str]]:
        """
        특정 노드의 출력 슬롯을 참조하는 모든 입력 찾기
        반환: [(consumer_node_id, input_name), ...]

        ComfyUI API 포맷에서 연결은 [노드ID, 슬롯번호] 형태
        """
        references = []
        for node_id, node_data in workflow.items():
            if not isinstance(node_data, dict):
                continue
            inputs = node_data.get("inputs", {})
            for input_name, input_value in inputs.items():
                if (
                    isinstance(input_value, list)
                    and len(input_value) == 2
                    and str(input_value[0]) == str(source_node_id)
                    and input_value[1] == source_slot
                ):
                    references.append((node_id, input_name))
        return references


# 싱글톤 인스턴스
workflow_manager = WorkflowManager()
