"""
workflow_runner.py - ComfyUI 워크플로우 JSON 로드 + proxyWidget 주입 + 실행.

워크플로우 JSON 구조 요약 (Qwen 2512/Edit 2511 공통):
- 최상위 `nodes[]` 에 subgraph 인스턴스 노드 (type == subgraph_id)가 있고,
  그 node 의 `properties.proxyWidgets` 가 [[inner_node_id, widget_name], ...] 리스트를 가진다.
- 실제 내부 노드들은 `definitions.subgraphs[].nodes[]` 안에 있고,
  각 노드의 `widgets_values` (positional array) 가 UI 에 노출되는 값들.

우리가 프론트로부터 받는 입력 (prompt/width/height/value/seed/unet_name/clip_name/vae_name/lora_name)을
이 proxyWidget 매핑을 따라 `widgets_values` 의 올바른 index 에 주입한다.

Transport 는 plug-gable:
- FakeTransport     - 단위 테스트용. prompt dict 를 내부 버퍼에 저장.
- ComfyUITransport  - 실제 ComfyUI 로 HTTP POST /prompt + WebSocket 수신 (Sub-Phase 2C 에서 연결).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

log = logging.getLogger(__name__)

# ── 상수 ──
WORKFLOW_DIR = Path(__file__).resolve().parent.parent / "workflows"


# ── 워크플로우 로드 ──
def load_workflow(workflow_filename: str) -> dict[str, Any]:
    """backend/workflows/ 에서 파일을 로드.

    Args:
        workflow_filename: 예) "qwen_image_2512.json"

    Raises:
        FileNotFoundError: 파일 없음
        ValueError: JSON 파싱 실패
    """
    path = WORKFLOW_DIR / workflow_filename
    if not path.is_file():
        raise FileNotFoundError(f"Workflow not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"Workflow JSON invalid ({path}): {e}") from e


# ── subgraph helpers ──
def find_subgraph_instance(wf: dict[str, Any], subgraph_id: str) -> dict[str, Any]:
    """최상위 nodes[] 에서 subgraph 인스턴스 (type == subgraph_id) 검색."""
    for node in wf.get("nodes", []):
        if node.get("type") == subgraph_id:
            return node
    raise ValueError(f"Subgraph instance not found: {subgraph_id}")


def find_subgraph_definition(
    wf: dict[str, Any], subgraph_id: str
) -> dict[str, Any]:
    """definitions.subgraphs[] 에서 id 매칭."""
    for sg in wf.get("definitions", {}).get("subgraphs", []):
        if sg.get("id") == subgraph_id:
            return sg
    raise ValueError(f"Subgraph definition not found: {subgraph_id}")


def _find_inner_node(
    subgraph_def: dict[str, Any], node_id: int | str
) -> dict[str, Any]:
    """subgraph_def.nodes[] 에서 id 매칭 (int/str 모두 허용)."""
    target = int(node_id)
    for n in subgraph_def.get("nodes", []):
        if int(n.get("id", -1)) == target:
            return n
    raise ValueError(f"Inner node not found: {node_id}")


def _widget_positions(node: dict[str, Any]) -> dict[str, int]:
    """node 의 inputs[] 를 순회하며, widget.name → widgets_values 내 position 매핑.

    ComfyUI 구조상 `inputs[]` 에서 `widget: {name: X}` 가 있는 항목은
    `widgets_values` 배열에 순서대로 매핑됨 (link: null/undefined 인 widget input 만).
    """
    positions: dict[str, int] = {}
    pos = 0
    for inp in node.get("inputs", []):
        widget = inp.get("widget")
        if widget and isinstance(widget, dict) and widget.get("name"):
            positions[widget["name"]] = pos
            pos += 1
    return positions


def _set_widget_value(
    node: dict[str, Any], widget_name: str, value: Any
) -> None:
    """node.widgets_values 배열의 특정 위치를 업데이트 (widget_name 으로 찾아서)."""
    widgets = node.get("widgets_values")
    if widgets is None:
        # widget 없이 inputs 로만 받는 노드 (ex: PrimitiveBoolean)
        # 이 경우 inputs[].link 가 비어있으면 widgets_values 가 존재할 수도 있음
        node["widgets_values"] = []
        widgets = node["widgets_values"]

    positions = _widget_positions(node)

    # positions 에 없으면, widget 이 inputs 에 안 잡힌 케이스 (PrimitiveXxx 등)
    # 이 경우 첫 widget_values 에 value 를 할당 (휴리스틱)
    if widget_name not in positions:
        # PrimitiveBoolean/Int/Float/String 계열은 widgets_values[0] 이 대개 값
        if widgets:
            widgets[0] = value
        else:
            widgets.append(value)
        return

    pos = positions[widget_name]
    # positional 배열 확장
    while len(widgets) <= pos:
        widgets.append(None)
    widgets[pos] = value


# ── 주입 ──
@dataclass
class GenerateInjection:
    """프론트 → workflow 주입 값 (생성)."""

    text: str
    width: int
    height: int
    enable_turbo_mode: bool  # Lightning
    seed: int
    unet_name: str
    clip_name: str
    vae_name: str
    lora_name: str  # Lightning LoRA 파일명


@dataclass
class EditInjection:
    """프론트 → workflow 주입 값 (수정)."""

    prompt: str
    enable_turbo_mode: bool
    seed: int
    unet_name: str
    clip_name: str
    vae_name: str
    lora_name: str
    # image 는 실제 업로드 파일명(ComfyUI input/ 하위) 또는 base64.
    # 이번 구현은 이미지 실 전송까지 다루지 않음 (Sub-Phase 2C 에서).
    image_filename: str | None = None


def inject_generate(
    wf: dict[str, Any], subgraph_id: str, values: GenerateInjection
) -> dict[str, Any]:
    """생성 워크플로우에 입력값 주입 (in-place + return)."""
    instance = find_subgraph_instance(wf, subgraph_id)
    definition = find_subgraph_definition(wf, subgraph_id)

    proxy_widgets = instance.get("properties", {}).get("proxyWidgets", [])
    # proxyWidgets 포맷: [[inner_node_id_str, widget_name], ...]

    mapping: dict[str, Any] = {
        "text": values.text,
        "width": values.width,
        "height": values.height,
        "value": values.enable_turbo_mode,  # PrimitiveBoolean
        "seed": values.seed,
        "unet_name": values.unet_name,
        "clip_name": values.clip_name,
        "vae_name": values.vae_name,
        "lora_name": values.lora_name,
    }

    _apply_proxy_widgets(definition, proxy_widgets, mapping)
    return wf


def inject_edit(
    wf: dict[str, Any], subgraph_id: str, values: EditInjection
) -> dict[str, Any]:
    """수정 워크플로우에 입력값 주입."""
    instance = find_subgraph_instance(wf, subgraph_id)
    definition = find_subgraph_definition(wf, subgraph_id)

    proxy_widgets = instance.get("properties", {}).get("proxyWidgets", [])

    mapping: dict[str, Any] = {
        "prompt": values.prompt,
        "value": values.enable_turbo_mode,
        "seed": values.seed,
        "unet_name": values.unet_name,
        "clip_name": values.clip_name,
        "vae_name": values.vae_name,
        "lora_name": values.lora_name,
    }
    # control_after_generate 는 proxyWidgets 에 있지만 우리는 "randomize" 고정
    if _proxy_has(proxy_widgets, "control_after_generate"):
        mapping["control_after_generate"] = "randomize"

    _apply_proxy_widgets(definition, proxy_widgets, mapping)

    # image 파일명은 내부 LoadImage 노드에 별도로 주입 (TODO: Sub-Phase 2C 에서 실제 이미지 파이프라인)
    if values.image_filename:
        # 최상위 nodes 의 LoadImage 를 찾아 파일명 교체
        for node in wf.get("nodes", []):
            if node.get("type") == "LoadImage" and node.get("mode", 0) != 4:
                # mode 4 = bypass. 활성 LoadImage 만.
                widgets = node.setdefault("widgets_values", ["", "image"])
                widgets[0] = values.image_filename
                break

    return wf


def _proxy_has(proxy_widgets: list[list[Any]], widget_name: str) -> bool:
    return any(w[1] == widget_name for w in proxy_widgets)


def _apply_proxy_widgets(
    definition: dict[str, Any],
    proxy_widgets: list[list[Any]],
    mapping: dict[str, Any],
) -> None:
    """proxyWidgets 매핑을 순회하며 내부 노드의 widgets_values 를 업데이트."""
    for entry in proxy_widgets:
        if len(entry) < 2:
            continue
        inner_id, widget_name = entry[0], entry[1]
        if widget_name not in mapping:
            # 우리가 모르는 widget (예: control_after_generate when not provided)
            continue
        try:
            node = _find_inner_node(definition, inner_id)
            _set_widget_value(node, widget_name, mapping[widget_name])
        except ValueError as e:
            log.warning("Skip proxy widget %s@%s: %s", widget_name, inner_id, e)


# ── Transport 프로토콜 ──
class Transport(Protocol):
    """ComfyUI 에 prompt 를 제출하는 전송 계층 추상화.

    실제 구현은 httpx.AsyncClient + websocket (Sub-Phase 2C).
    테스트에선 FakeTransport.
    """

    async def submit(self, api_prompt: dict[str, Any], client_id: str) -> str:
        """POST /prompt → prompt_id 반환."""
        ...

    async def close(self) -> None:
        ...


class FakeTransport:
    """테스트용: 제출된 prompt 를 버퍼에 보관, prompt_id 는 고정값."""

    def __init__(self) -> None:
        self.submitted: list[tuple[dict[str, Any], str]] = []

    async def submit(self, api_prompt: dict[str, Any], client_id: str) -> str:
        self.submitted.append((api_prompt, client_id))
        return f"fake-prompt-{len(self.submitted)}"

    async def close(self) -> None:
        return None


# ── API format 변환 ──
def to_api_prompt(wf: dict[str, Any], subgraph_id: str) -> dict[str, Any]:
    """ComfyUI editor 형식 (중첩 subgraph) → ComfyUI API 'prompt' 형식 (flat graph).

    ⚠️ 이 변환은 본격적으로는 Sub-Phase 2C 에서 완성한다.
    현재는 "최상위 node + subgraph 내부 node" 를 모두 flat 하게 합쳐서 반환하는
    최소 형태 — 실제 ComfyUI 가 받는 prompt 포맷과는 차이가 있어 실 dispatch 엔
    아직 쓸 수 없다. 단위 테스트에서는 주입 결과만 검증.
    """
    flat: dict[str, dict[str, Any]] = {}

    # 최상위 nodes
    for node in wf.get("nodes", []):
        nid = str(node.get("id"))
        flat[nid] = {
            "class_type": node.get("type", ""),
            "inputs": _flatten_inputs(node),
            "_widgets": node.get("widgets_values", []),
        }

    # subgraph 내부 nodes (정의에서 추출)
    for sg in wf.get("definitions", {}).get("subgraphs", []):
        if sg.get("id") != subgraph_id:
            continue
        for node in sg.get("nodes", []):
            nid = f"{subgraph_id[:6]}:{node.get('id')}"
            flat[nid] = {
                "class_type": node.get("type", ""),
                "inputs": _flatten_inputs(node),
                "_widgets": node.get("widgets_values", []),
            }

    return flat


def _flatten_inputs(node: dict[str, Any]) -> dict[str, Any]:
    """node.inputs[] 를 {name: link_or_value} 로 평탄화."""
    out: dict[str, Any] = {}
    for inp in node.get("inputs", []):
        name = inp.get("name") or inp.get("localized_name")
        if not name:
            continue
        link = inp.get("link")
        widget = inp.get("widget")
        if link is not None:
            out[name] = ["__link__", link]  # API format 에선 [source_node_id, output_index]
        elif widget:
            # widget 값은 node.widgets_values 에서 가져옴 — 여기선 name 만 노출
            out[name] = {"__widget__": widget.get("name")}
    return out


# ── 편의 entry point ──
def build_generate_prompt(
    workflow_filename: str,
    subgraph_id: str,
    values: GenerateInjection,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """생성용 워크플로우 로드 + 주입 + API 포맷까지 반환.

    Returns:
        (editor_format, api_format) — editor_format 은 디버그/저장용,
        api_format 은 Transport.submit 으로 보낼 형태 (아직 미완성).
    """
    wf = load_workflow(workflow_filename)
    inject_generate(wf, subgraph_id, values)
    api = to_api_prompt(wf, subgraph_id)
    return wf, api


def build_edit_prompt(
    workflow_filename: str,
    subgraph_id: str,
    values: EditInjection,
) -> tuple[dict[str, Any], dict[str, Any]]:
    wf = load_workflow(workflow_filename)
    inject_edit(wf, subgraph_id, values)
    api = to_api_prompt(wf, subgraph_id)
    return wf, api
