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
from models.schemas import EditRequest, GenerateRequest, LoraConfig

logger = logging.getLogger(__name__)

# 랜덤 시드 범위 (ComfyUI 호환)
_MAX_SEED: int = 2**32 - 1

# 노드 class_type 매핑 (ComfyUI API 포맷)
_NODE_KSAMPLER: str = "KSampler"
_NODE_CLIP_TEXT_POSITIVE: str = "CLIPTextEncode"
_NODE_EMPTY_LATENT: str = "EmptyLatentImage"
_NODE_EMPTY_SD3_LATENT: str = "EmptySD3LatentImage"
_NODE_CHECKPOINT_LOADER: str = "CheckpointLoaderSimple"
_NODE_VAE_LOADER: str = "VAELoader"
_NODE_LORA_LOADER: str = "LoraLoader"
_NODE_LOAD_IMAGE: str = "LoadImage"
_NODE_TEXT_ENCODE_QWEN_EDIT: str = "TextEncodeQwenImageEdit"


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

        # 공통 헬퍼로 샘플링/체크포인트/VAE 주입 (build_edit_prompt와 공유)
        self._set_sampling_params(
            prompt,
            seed=seed,
            steps=request.steps,
            cfg=request.cfg,
            sampler=request.sampler,
            scheduler=request.scheduler,
            denoise=1.0,  # txt2img 기본값
        )
        self._set_checkpoint(prompt, request.checkpoint)
        self._set_vae(prompt, request.vae)

        # 생성 모드 전용 주입 (프롬프트/latent)
        self._inject_clip_text(prompt, request)
        self._inject_empty_latent(prompt, request)

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
    # 이미지 수정 파라미터 주입
    # ─────────────────────────────────────────────

    def build_edit_prompt(
        self,
        request: EditRequest,
        workflow: dict[str, Any],
        comfyui_image_name: str,
    ) -> dict[str, Any]:
        """
        이미지 수정 워크플로우에 파라미터 주입
        - LoadImage 노드에 소스 이미지 파일명 설정
        - TextEncodeQwenImageEdit (Positive/Negative) 노드에 프롬프트 설정
        - KSampler/CheckpointLoader/VAELoader/LoRA는 공통 헬퍼 사용
        """
        prompt = copy.deepcopy(workflow)

        # 시드 처리: -1이면 랜덤 생성
        seed = request.seed
        if seed < 0:
            seed = random.randint(0, _MAX_SEED)

        # LoadImage 노드에 소스 이미지 설정 (수정 모드 전용)
        self._set_load_image(prompt, comfyui_image_name)

        # TextEncodeQwenImageEdit 노드에 프롬프트 주입 (수정 모드 전용)
        # negative_prompt는 EditRequest 필드값 사용 (기본값 "" 유지, 보강 시 업데이트된 값 사용)
        self._set_qwen_edit_prompts(
            prompt,
            positive=request.edit_prompt,
            negative=request.negative_prompt,
        )

        # KSampler 샘플링 파라미터 (sampler/scheduler는 워크플로우 기본값 유지)
        self._set_sampling_params(
            prompt, seed=seed, steps=request.steps, cfg=request.cfg,
        )

        # 공통 헬퍼로 checkpoint / vae / lora 주입
        self._set_checkpoint(prompt, request.checkpoint)
        self._set_vae(prompt, request.vae)
        if request.loras:
            self._inject_loras(prompt, request.loras)

        logger.info(
            "이미지 수정 워크플로우 빌드 완료: seed=%d, steps=%d, cfg=%.1f, image=%s",
            seed, request.steps, request.cfg, comfyui_image_name,
        )
        return prompt

    # ─────────────────────────────────────────────
    # 수정 모드 전용 주입 헬퍼
    # ─────────────────────────────────────────────

    def _set_load_image(self, workflow: dict[str, Any], image_name: str) -> None:
        """LoadImage 노드에 소스 이미지 파일명 설정"""
        result = self._find_node_by_class(workflow, _NODE_LOAD_IMAGE)
        if result is None:
            logger.warning("LoadImage 노드 없음 — 소스 이미지 설정 건너뜀")
            return
        _node_id, node = result
        node.setdefault("inputs", {})["image"] = image_name

    def _set_qwen_edit_prompts(
        self,
        workflow: dict[str, Any],
        *,
        positive: str,
        negative: str,
    ) -> None:
        """TextEncodeQwenImageEdit 노드에 positive/negative 프롬프트 주입"""
        edit_nodes = self._find_nodes_by_class(workflow, _NODE_TEXT_ENCODE_QWEN_EDIT)
        if not edit_nodes:
            logger.warning("TextEncodeQwenImageEdit 노드 없음 — 프롬프트 주입 건너뜀")
            return
        for _nid, ndata in edit_nodes:
            meta_title = ndata.get("_meta", {}).get("title", "")
            inputs = ndata.setdefault("inputs", {})
            if "Positive" in meta_title:
                inputs["prompt"] = positive
            elif "Negative" in meta_title:
                inputs["prompt"] = negative

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
    # 공통 노드 주입 헬퍼 (build_prompt / build_edit_prompt 공유)
    # ─────────────────────────────────────────────

    def _set_sampling_params(
        self,
        workflow: dict[str, Any],
        *,
        seed: int,
        steps: int,
        cfg: float,
        sampler: str | None = None,
        scheduler: str | None = None,
        denoise: float | None = None,
    ) -> None:
        """
        KSampler 노드에 샘플링 파라미터 설정 — 생성/수정 모드 공통 헬퍼
        sampler/scheduler/denoise는 None이면 워크플로우 기본값 유지
        """
        result = self._find_node_by_class(workflow, _NODE_KSAMPLER)
        if result is None:
            logger.warning("KSampler 노드 없음 — 샘플링 파라미터 주입 건너뜀")
            return
        _node_id, node = result
        inputs = node.setdefault("inputs", {})
        inputs["seed"] = seed
        inputs["steps"] = steps
        inputs["cfg"] = cfg
        if sampler is not None:
            inputs["sampler_name"] = sampler
        if scheduler is not None:
            inputs["scheduler"] = scheduler
        if denoise is not None:
            inputs["denoise"] = denoise

    def _set_checkpoint(self, workflow: dict[str, Any], name: str) -> None:
        """CheckpointLoaderSimple 노드에 체크포인트 이름 설정 (빈 문자열이면 스킵)"""
        if not name:
            return
        result = self._find_node_by_class(workflow, _NODE_CHECKPOINT_LOADER)
        if result is None:
            logger.warning("CheckpointLoaderSimple 노드 없음 — 체크포인트 설정 건너뜀")
            return
        _node_id, node = result
        node.setdefault("inputs", {})["ckpt_name"] = name

    def _set_vae(self, workflow: dict[str, Any], name: str) -> None:
        """VAELoader 노드에 VAE 이름 설정 (빈 문자열이면 스킵)"""
        if not name:
            return
        result = self._find_node_by_class(workflow, _NODE_VAE_LOADER)
        if result is None:
            logger.warning("VAELoader 노드 없음 — VAE 설정 건너뜀")
            return
        _node_id, node = result
        node.setdefault("inputs", {})["vae_name"] = name

    # ─────────────────────────────────────────────
    # 생성 모드 전용 주입 (프롬프트/latent)
    # ─────────────────────────────────────────────

    def _inject_clip_text(
        self,
        workflow: dict[str, Any],
        request: GenerateRequest,
    ) -> None:
        """
        CLIPTextEncode 노드에 프롬프트 주입 — _meta.title 기반 구분 (우선) + 순서 기반 fallback
        - title에 "negative"가 있으면 부정, "positive"/"prompt"가 있으면 긍정
        - title로 구분 실패 시 기존 순서 규칙 적용 (0번=긍정, 1번=부정)
        """
        clip_nodes = self._find_nodes_by_class(workflow, _NODE_CLIP_TEXT_POSITIVE)

        if not clip_nodes:
            logger.warning("CLIPTextEncode 노드 없음 — 프롬프트 주입 건너뜀")
            return

        # ── 1차: _meta.title 기반 매칭 ──
        pos_node: dict | None = None
        neg_node: dict | None = None
        for _nid, node in clip_nodes:
            title = node.get("_meta", {}).get("title", "").lower()
            if "negative" in title and neg_node is None:
                neg_node = node
            elif ("positive" in title or "prompt" in title) and pos_node is None:
                pos_node = node

        # ── 2차: 순서 기반 fallback (기존 동작 호환) ──
        if pos_node is None and clip_nodes:
            pos_node = clip_nodes[0][1]
        if neg_node is None and len(clip_nodes) >= 2:
            # pos와 다른 두 번째 노드 찾기
            for _nid, node in clip_nodes:
                if node is not pos_node:
                    neg_node = node
                    break

        # 주입
        if pos_node is not None:
            pos_node.setdefault("inputs", {})["text"] = request.prompt
        if neg_node is not None:
            neg_node.setdefault("inputs", {})["text"] = request.negative_prompt

    def _inject_empty_latent(
        self,
        workflow: dict[str, Any],
        request: GenerateRequest,
    ) -> None:
        """EmptyLatentImage 또는 EmptySD3LatentImage 노드에 이미지 크기/배치 주입"""
        result = self._find_node_by_class(workflow, _NODE_EMPTY_LATENT)
        if result is None:
            # SD3/Qwen 등 최신 모델용 Latent 노드 탐색
            result = self._find_node_by_class(workflow, _NODE_EMPTY_SD3_LATENT)
        if result is None:
            logger.warning("EmptyLatentImage 노드 없음 — 크기 설정 건너뜀")
            return

        _node_id, node = result
        inputs = node.setdefault("inputs", {})
        inputs["width"] = request.width
        inputs["height"] = request.height
        inputs["batch_size"] = request.batch_size

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
