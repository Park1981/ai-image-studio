# AI Image Studio Final Refactor Review — 2026-04-30

작성: 하루(Codex)  
목적: Claude 리뷰와 Codex 리뷰를 대조해, 현재 `master` 기준 최종 리팩토링 우선순위를 정리한다.

## 1. 결론

Claude 리뷰와 Codex 리뷰는 서로 다른 층을 봤다.

- Claude 리뷰: 구조 품질, 대형 파일 분할, 중복 추출, dead code 청소에 강하다.
- Codex 리뷰: 런타임 정확성, 실제 회귀, 입력 검증, 테스트/린트 게이트에 강하다.

최종 판단은 다음과 같다.

1. 먼저 런타임 correctness 4건과 backend ruff gate를 처리한다.
2. 그다음 dead code 청소와 stage slice 추출을 진행한다.
3. 마지막으로 SettingsDrawer 및 대형 backend 모듈을 도메인별로 나눈다.

현재 아키텍처는 전반적으로 양호하다. 다만 "테스트는 통과하지만 실제 기능 일부가 영속되지 않는 문제"와 "lint gate 실패"가 있어서, 구조 분할보다 먼저 고쳐야 한다.

## 2. 검증 스냅샷

실행 기준: `D:\AI-Image-Studio`, 2026-04-30.

| 항목 | 결과 |
|---|---|
| `cd backend; ..\.venv\Scripts\python.exe -m pytest tests` | 348 passed, 1 skipped |
| backend v9 reference subset | 56 passed |
| `cd frontend; npm test` | 91 passed |
| `cd frontend; npm run lint` | pass |
| `cd frontend; npx tsc --noEmit` | pass |
| `cd backend; ..\.venv\Scripts\python.exe -m ruff check .` | fail, 9 errors |
| `cd frontend; npm audit --audit-level=moderate` | moderate 2건, `postcss` advisory via `next` |

주의: frontend 의존성이 비어 있어 `npm ci` 후 검증했다. 해당 검증 직후 워킹트리는 깨끗했고, 현재는 본 문서만 새 파일로 추가된 상태다.

## 3. 리뷰 비교

### 3.1 Claude 리뷰와 Codex 리뷰가 일치한 부분

| 영역 | Claude 판단 | Codex 판단 | 최종 판정 |
|---|---|---|---|
| 대형 파일 분할 | SettingsDrawer, history_db, vision/prompt/comparison/comfy builder 분할 권장 | 동의. 현재 변경 비용 대비 순서는 뒤로 둠 | Important |
| stage tracking 중복 | 3 store 공통 stage slice 추출 | 동의. 실제 중복 확인됨 | Important |
| dead code | 약 1,000줄 삭제 가능 | 대부분 동의. 단 `workflow_runner.py`는 테스트가 직접 참조 | Important |
| mock 코드 위치 | 운영 API 파일에서 mock 분리 권장 | 동의. 테스트성/가독성 개선 | Recommended |
| inline style 중복 | class/CSS module 추출 여지 | 동의. 단 현재 CLAUDE.md 정책상 강제 아님 | Recommended |

### 3.2 Claude 리뷰에 보강이 필요한 부분

Claude 리뷰는 "Critical 0건"으로 봤지만, Codex 리뷰에서 실제 동작 회귀가 확인됐다.

| 항목 | 근거 | 영향 |
|---|---|---|
| 비교 분석 DB 저장 불가 | `frontend/hooks/useComparisonAnalysis.ts:126` 이 `tsk-` id만 전송하지만 실제 edit id는 `backend/studio/pipelines/edit.py:203` 의 `edit-*` | 분석 결과가 화면 store에만 있고 새로고침 후 사라짐 |
| multipart meta object 검증 누락 | `routes/streams.py`, `routes/vision.py`, `routes/compare.py` 에서 `json.loads()` 후 바로 `.get()` | 잘못된 요청이 400이 아니라 500 |
| template reference 신뢰 경계 오류 | `referenceTemplateId`로 history에는 DB `imageRef`를 기록하지만 실제 ComfyUI에는 클라이언트가 보낸 `reference_image` bytes 사용 | 결과 이미지와 기록된 referenceRef 불일치 가능 |
| promote race | template insert 후 unconditional `UPDATE studio_history SET reference_ref = ? WHERE id = ?` | 같은 historyId 중복 요청 시 템플릿 중복 생성 가능 |
| backend ruff fail | 9건 실패 | lint gate 사용 시 배포/검증 차단 |
| ReferenceImageBox keyboard regression | 기존 StudioUploadSlot의 role/tabIndex/Enter/Space 보강이 새 박스에 없음 | 접근성/키보드 업로드 회귀 |

## 4. 최종 Findings

### Critical / Correctness

#### C1. 비교 분석 결과가 실제 edit history에 영구 저장되지 않음

파일:
- `frontend/hooks/useComparisonAnalysis.ts:126`
- `backend/studio/pipelines/edit.py:203`
- `backend/studio/pipelines/compare_analyze.py:204`

문제:
- frontend는 `item.id.startsWith("tsk-")`일 때만 `historyItemId`를 보낸다.
- 실제 edit 결과 id는 `edit-<uuid8>`이다.
- backend도 `TASK_ID_RE`만 통과시켜 `edit-*`를 저장 대상으로 인정하지 않는다.

영향:
- 수동/자동 비교 분석 결과가 local Zustand store에만 남는다.
- 앱 새로고침 또는 재시작 후 `comparisonAnalysis`가 사라진다.

권장:
- history row id와 task id를 분리해서 이해한다.
- `historyItemId`는 `studio_history.id` 기준으로 검증해야 한다.
- `TASK_ID_RE` 대신 `history_db.get_item(history_item_id_raw)` 존재 여부로 판단한다.

Acceptance:
- 새 edit 결과 `edit-*`에 대해 compare-analyze 호출 시 `saved=true`.
- 새로고침 후 `comparisonAnalysis`가 서버 history에서 복원된다.
- 기존 `tsk-*` 테스트는 실제 `edit-*` 케이스로 교체하거나 추가한다.

#### C2. multipart meta object 검증 누락으로 500 발생

파일:
- `backend/studio/routes/streams.py:89`
- `backend/studio/routes/streams.py:278`
- `backend/studio/routes/vision.py:44`
- `backend/studio/routes/compare.py:50`

문제:
- `json.loads(meta)` 결과가 `dict`인지 확인하지 않는다.
- `meta=null`, `meta=[]`, `meta="x"` 같은 요청에서 `.get()` 호출로 500이 난다.

권장:
- `routes/_common.py` 또는 새 helper에 `parse_meta_object(meta: str) -> dict[str, Any]` 추가.
- JSON decode 실패와 non-object 모두 400으로 통일.

Acceptance:
- `/edit`, `/video`, `/vision-analyze`, `/compare-analyze`에 `meta=null` 전송 시 400.
- 기존 정상 multipart 요청은 영향 없음.

#### C3. referenceTemplateId 사용 시 서버가 reference bytes 권위를 갖지 않음

파일:
- `backend/studio/routes/streams.py:153`
- `backend/studio/routes/streams.py:198`
- `backend/studio/routes/streams.py:234`

문제:
- `referenceTemplateId`가 있으면 history에는 DB의 `tpl["imageRef"]`를 기록한다.
- 하지만 실제 ComfyUI에는 클라이언트가 multipart로 보낸 `reference_image` bytes를 전달한다.
- 조작된 클라이언트 또는 프론트 버그가 있으면 "템플릿 A로 기록, 실제 생성은 이미지 B"가 가능하다.

권장:
- `referenceTemplateId`가 있으면 backend가 `tpl["imageRef"]`를 안전한 파일 경로로 변환해 직접 읽는다.
- 이 경우 클라이언트 multipart `reference_image`는 무시하거나 보내지 않게 한다.
- 직접 업로드 케이스만 multipart bytes를 신뢰한다.

Acceptance:
- template id만으로 edit 요청 가능하거나, template id가 있으면 multipart bytes와 무관하게 DB 파일을 사용한다.
- 조작된 multipart bytes가 결과에 영향을 주지 않는 테스트 추가.

#### C4. promote endpoint 중복 요청 race

파일:
- `backend/studio/routes/reference_templates.py:185`
- `backend/studio/routes/reference_templates.py:223`
- `backend/studio/routes/reference_templates.py:240`

문제:
- pool ref 확인과 history swap이 원자적이지 않다.
- 같은 historyId에 중복 요청이 겹치면 템플릿이 여러 개 생성될 수 있다.

권장:
- insert 이후 `UPDATE studio_history SET reference_ref = ? WHERE id = ? AND reference_ref = ?` 사용.
- `rowcount == 0`이면 방금 만든 template row와 파일을 rollback.
- 가능하면 insert 전에도 짧은 transaction 또는 application-level lock을 둔다.

Acceptance:
- 같은 historyId에 promote 두 번 호출 시 하나만 성공하거나, 두 번째는 409/400으로 실패.
- 영구 파일과 reference_templates row orphan이 남지 않는다.

### Important / Gate

#### I1. backend ruff gate 실패

현재 9건:
- `backend/scripts/dump_openapi.py:25` E402
- `studio/vision_pipeline.py:35-39` E402
- `tests/studio/test_edit_pipeline_pool_save.py:11` F401
- `tests/studio/test_reference_pool_routes.py:174-175` F841

권장:
- 즉시 수정한다. 구조 리팩토링 전 baseline gate가 clean이어야 한다.

Acceptance:
- `cd backend; ..\.venv\Scripts\python.exe -m ruff check .` clean.

#### I2. SettingsDrawer.tsx 분할

파일:
- `frontend/components/settings/SettingsDrawer.tsx` — 1,466 lines

Claude 제안은 타당하다.

권장 분할:
- `settings/process-section.tsx`
- `settings/system-metrics-section.tsx`
- `settings/history-section.tsx`
- `settings/reference-pool-section.tsx`
- 남는 shell은 drawer composition만 담당

주의:
- 이 작업은 기능 변경 없이 해야 한다.
- 먼저 ruff/correctness fix 후 진행한다.

#### I3. stage tracking slice 추출

파일:
- `frontend/stores/useGenerateStore.ts`
- `frontend/stores/useEditStore.ts`
- `frontend/stores/useVideoStore.ts`

중복:
- `stageHistory`
- `startedAt`
- `samplingStep`
- `samplingTotal`
- `pushStage`
- `setSampling`
- reset 로직

권장:
- `frontend/lib/stage.ts`에 `StageEvent` 이동.
- `frontend/stores/createStageSlice.ts` 또는 store-local helper로 공통 로직 추출.

주의:
- Generate는 persist store, Edit/Video는 non-persist store라 slice 주입 방식을 단순화해야 한다.
- 무리하게 generic을 키우기보다 공통 초기값/액션 helper부터 추출해도 충분하다.

#### I4. dead code 청소

확인된 active runtime reference 0건:
- `frontend/components/icons.tsx` — 180 lines
- `frontend/components/studio/PipelineSteps.tsx` — 230 lines
- `frontend/components/studio/SelectedItemPreview.tsx` — 116 lines
- `frontend/components/studio/StudioResultCard.tsx` — 58 lines
- `frontend/components/studio/ResultInfoModal.tsx` — 160 lines
- `frontend/components/studio/AiEnhanceCard.tsx` — 324 lines
- `frontend/components/chrome/VramBadge.tsx` — 97 lines

조건부 cleanup:
- `backend/studio/workflow_runner.py` — 355 lines
  - runtime reference는 없음.
  - 단 `backend/tests/studio/test_workflow_runner.py`가 직접 import한다.
  - 삭제하려면 테스트도 제거하거나, legacy/quarantine으로 이동하는 결정을 같이 해야 한다.

보존:
- `frontend/components/prompt-flow/GenerateUseCaseDiagram.tsx`
  - changelog에 "보존, cherry-pick 가능" 명시가 있으므로 삭제 대상에서 제외.

권장:
- 삭제 전 `rg`로 active import 0건 재확인.
- 문서/CLAUDE.md의 컴포넌트 목록도 함께 갱신.

#### I5. 대형 backend 모듈 분할

대상:
- `backend/studio/history_db.py` — 886 lines
- `backend/studio/vision_pipeline.py` — 1,131 lines
- `backend/studio/prompt_pipeline.py` — 975 lines
- `backend/studio/comparison_pipeline.py` — 1,046 lines
- `backend/studio/comfy_api_builder.py` — 1,197 lines

권장 순서:
1. `history_db.py`: schema/items/cascade/templates/stats로 분할
2. `vision_pipeline.py`: edit source 분석과 detailed vision 분석 분리
3. `prompt_pipeline.py`: translation/upgrade/ollama common 분리
4. `comparison_pipeline.py`: edit v3와 generic compare 분리
5. `comfy_api_builder.py`: generate/edit/video builder 분리

주의:
- mock.patch 위치 규칙이 이미 중요한 프로젝트다.
- 분할 시 테스트 patch target을 반드시 lookup 모듈 기준으로 갱신한다.

### Recommended

#### R1. AppHeader / ImageLightbox 내부 컴포넌트 분리

파일:
- `frontend/components/chrome/AppHeader.tsx` — 457 lines
- `frontend/components/studio/ImageLightbox.tsx` — 466 lines

권장:
- `chrome/ShutdownButton.tsx`
- `studio/lightbox/LightboxInner.tsx`

#### R2. mock stream 함수 분리

파일:
- `frontend/lib/api/generate.ts`
- `frontend/lib/api/edit.ts`
- `frontend/lib/api/video.ts`
- `frontend/lib/api/vision.ts`
- `frontend/lib/api/compare.ts`

권장:
- `frontend/lib/api/mocks/`로 mock generator 분리.
- real API client 파일은 실제 request/response 처리만 담당.

#### R3. 직접 fetch 호출 정리

확인:
- `frontend/app/loading/page.tsx:74`에서 API fetch 직접 호출.
- `frontend/lib/image-actions.ts`, `frontend/lib/image-crop.ts`의 fetch는 이미지 변환/다운로드 성격이라 API client 통합 대상은 아님.

권장:
- `/api/health` 호출 wrapper를 `frontend/lib/api/process.ts` 또는 `client.ts`에 둔다.

#### R4. inline style 중복은 점진 처리

Claude가 지적한 token 반복은 사실이다. 다만 CLAUDE.md가 "디자인 토큰 + 인라인 스타일 + Tailwind 혼합"을 허용하므로 강제 리팩토링 대상은 아니다.

권장:
- 새 기능 작성 시에만 반복되는 shell/card/button 스타일을 class 또는 small primitive로 흡수한다.
- 대규모 style 이동은 시각 회귀 비용이 커서 별도 UI pass로 분리한다.

## 5. 최종 실행 순서

### Phase 0 — baseline 복구

1. backend ruff 9건 수정
2. `pytest`, `ruff`, `vitest`, `tsc`, `lint` baseline clean 확인

### Phase 1 — correctness fix

1. compare-analyze `historyItemId` 정책을 실제 history id 기준으로 수정
2. multipart meta object 검증 공통화
3. referenceTemplateId 사용 시 서버가 template 파일 bytes를 직접 읽도록 수정
4. promote conditional update와 rollback 추가
5. 위 4건에 회귀 테스트 추가

### Phase 2 — safe cleanup

1. active reference 0건 frontend 컴포넌트 삭제
2. 문서/CLAUDE.md에서 삭제된 컴포넌트 목록 갱신
3. `workflow_runner.py`는 삭제/legacy 보존 중 결정 후 테스트와 같이 처리

### Phase 3 — frontend structure

1. stage slice 또는 stage helper 추출
2. SettingsDrawer 섹션 분할
3. AppHeader ShutdownButton 분리
4. ImageLightbox inner 분리
5. mock stream 분리

### Phase 4 — backend structure

1. history_db 도메인 분할
2. vision pipeline 분할
3. prompt pipeline 분할
4. comparison pipeline 분할
5. comfy_api_builder 모드별 분할

## 6. 완료 기준

각 phase 완료 시 최소 검증:

```powershell
cd backend
..\.venv\Scripts\python.exe -m ruff check .
..\.venv\Scripts\python.exe -m pytest tests

cd ..\frontend
npm test
npm run lint
npx tsc --noEmit
```

Phase 1 추가 검증:
- 새 edit 결과의 비교 분석이 DB에 저장되고 새로고침 후 유지된다.
- `/edit`, `/video`, `/vision-analyze`, `/compare-analyze`에 `meta=null` 요청 시 400.
- template id와 조작된 multipart image가 함께 들어와도 서버 template 파일이 권위가 된다.
- 같은 historyId promote 중복 요청에서 orphan template/file이 남지 않는다.

## 7. 최종 평가

현재 프로젝트는 큰 방향이 좋다.

- task-based SSE와 stage timeline은 잘 통일되어 있다.
- GPU gate와 Ollama unload 정책은 16GB VRAM 환경을 잘 반영한다.
- v9 reference pool/promote/cascade 설계도 구조는 맞다.

다만 지금 리팩토링의 다음 단계는 "더 예쁘게 나누기"보다 "실제 상태와 기록의 정합성 복구"가 먼저다.  
Claude의 구조 리뷰는 Phase 2 이후부터 큰 효과가 있고, Codex의 correctness 리뷰는 Phase 0-1에서 먼저 처리해야 한다.
