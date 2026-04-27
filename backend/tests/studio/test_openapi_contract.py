"""
OpenAPI 계약 테스트 — `/openapi.json` snapshot 비교 (C2-P2-1 · 2026-04-27).

목적:
  Backend FastAPI 가 자동 생성하는 OpenAPI spec 을 snapshot 으로 추적해서,
  의도하지 않은 API 변경 (path 추가/삭제 / request schema 변경) 을 CI 단계에서 감지.

snapshot 파일:
  backend/tests/_snapshots/openapi.json — git 추적 대상.
  의도된 변경 시 UPDATE_OPENAPI_SNAPSHOT=1 환경변수로 갱신 후 git commit.

비교 정규화:
  paths (엔드포인트 + method + schema) + components.schemas (Pydantic 모델).
  info.version / openapi 버전 등 fastapi/pydantic 라이브러리 변동 영향 받는 메타는 제외.

frontend type drift:
  본 테스트는 backend 자체 계약 검증에 집중. frontend lib/api/types.ts 자동 생성
  (openapi-typescript) 은 다음 단계 작업 — 도입 시 본 snapshot 이 source of truth.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from main import app

SNAPSHOT_PATH = (
    Path(__file__).resolve().parent.parent / "_snapshots" / "openapi.json"
)


def _normalize(spec: dict) -> dict:
    """fastapi/pydantic 버전 변동에 영향받는 메타 제거 — 핵심 계약만 비교.

    paths: 엔드포인트 + method + request/response schema (계약의 본체).
    schemas: Pydantic 모델 (요청/응답 타입의 source of truth).
    """
    return {
        "paths": spec.get("paths", {}),
        "schemas": spec.get("components", {}).get("schemas", {}),
    }


def test_openapi_contract_matches_snapshot() -> None:
    """OpenAPI spec snapshot 과 일치 — drift 시 fail.

    UPDATE_OPENAPI_SNAPSHOT=1 환경변수로 갱신 가능 (의도된 변경 시).
    """
    client = TestClient(app)
    res = client.get("/openapi.json")
    assert res.status_code == 200, f"GET /openapi.json failed: {res.status_code}"
    actual = _normalize(res.json())

    # 갱신 모드 — snapshot 새로 쓰기.
    if os.getenv("UPDATE_OPENAPI_SNAPSHOT") == "1":
        SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT_PATH.write_text(
            json.dumps(actual, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        return

    # snapshot 부재 — 첫 실행에서는 자동 생성 후 통과.
    if not SNAPSHOT_PATH.exists():
        SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT_PATH.write_text(
            json.dumps(actual, indent=2, ensure_ascii=False, sort_keys=True),
            encoding="utf-8",
        )
        pytest.skip(
            f"OpenAPI snapshot 첫 생성: {SNAPSHOT_PATH}. git 에 add 후 commit."
        )
        return

    snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    if actual == snapshot:
        return  # 통과

    # 변경 요약 — paths 단위로 빠르게 보고 (전체 diff 는 git diff 로).
    actual_paths: set[str] = set(actual["paths"].keys())
    snapshot_paths: set[str] = set(snapshot["paths"].keys())
    added = sorted(actual_paths - snapshot_paths)
    removed = sorted(snapshot_paths - actual_paths)
    common_changed = sorted(
        p for p in (actual_paths & snapshot_paths)
        if actual["paths"][p] != snapshot["paths"][p]
    )

    actual_schemas: set[str] = set(actual["schemas"].keys())
    snapshot_schemas: set[str] = set(snapshot["schemas"].keys())
    added_schemas = sorted(actual_schemas - snapshot_schemas)
    removed_schemas = sorted(snapshot_schemas - actual_schemas)

    lines = ["OpenAPI contract drift — snapshot 과 다름:"]
    if added:
        lines.append(f"  + 추가된 엔드포인트: {added}")
    if removed:
        lines.append(f"  - 삭제된 엔드포인트: {removed}")
    if common_changed:
        lines.append(f"  ~ 변경된 엔드포인트: {common_changed}")
    if added_schemas:
        lines.append(f"  + 추가된 schema: {added_schemas}")
    if removed_schemas:
        lines.append(f"  - 삭제된 schema: {removed_schemas}")
    lines.append(
        "의도된 변경이면 갱신: "
        "`UPDATE_OPENAPI_SNAPSHOT=1 python -m pytest tests/studio/test_openapi_contract.py` "
        "후 git commit."
    )
    pytest.fail("\n".join(lines))
