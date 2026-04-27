"""
dump_openapi.py — backend 의 FastAPI app 에서 풀 OpenAPI 3.1 spec 을 JSON 으로 dump.

사용:
    cd backend
    D:/AI-Image-Studio/.venv/Scripts/python.exe scripts/dump_openapi.py [output_path]

기본 output: frontend/lib/api/openapi.json (frontend 에서 npm run gen:types 가 사용)

tests/_snapshots/openapi.json 은 contract test 의 subset (paths + schemas 만) 이라서
openapi-typescript 가 인식 못 함 (`openapi: 3.x` 메타필드 없음). 이 스크립트는 풀 spec 출력.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# backend 디렉토리를 sys.path 에 추가 — main.py 의 app 임포트
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# main app 임포트 (lifespan 시작 안 함 — openapi() 만 호출)
from main import app  # type: ignore


def main(output_path: str | None = None) -> None:
    """FastAPI app 의 풀 OpenAPI spec 을 JSON 파일로 저장."""
    output = Path(
        output_path
        or BACKEND_DIR.parent / "frontend" / "lib" / "api" / "openapi.json"
    )
    output.parent.mkdir(parents=True, exist_ok=True)

    spec = app.openapi()
    output.write_text(
        json.dumps(spec, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    print(f"OpenAPI spec dumped to: {output}")
    print(f"  openapi version: {spec.get('openapi', 'MISSING')}")
    print(f"  paths count: {len(spec.get('paths', {}))}")
    print(f"  schemas count: {len(spec.get('components', {}).get('schemas', {}))}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
