"""
backend.legacy — task #18 (2026-04-26): 옛 라우터/서비스/테스트 quarantine.

신규 코드 (`backend/studio/*`) 가 모든 frontend 호출을 책임짐.
본 패키지 안 코드는 더이상 main.py 에 등록되지 않으며 frontend/legacy 만 호출.

보존 의지 존중 정책 (frontend/legacy 와 동일):
  - 코드 본체는 무수정 (import 경로만 새 위치 반영)
  - tsconfig/eslint/pytest 에서 자동 exclude (default config 가 이미 exclude)
  - 차후 완전 삭제 결정 시 한번에 정리

이동 대상:
  routers/  — 옛 5 라우터 (/api/{generate,history,models,process,prompt})
  services/ — 옛 5 서비스 (prompt_engine, comfyui_client, image_path,
              task_manager, workflow_manager). process_manager 는 신규 코드
              가 사용 → backend/services/ 에 그대로 유지.
  tests/    — 옛 4 테스트 + conftest.py
"""
