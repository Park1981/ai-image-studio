# Refactor Review — 2026-04-27

작성: Claude (Opus 4.7) — 1차 (정적 분석)
보강 1: Codex 라운드 2 결과 수신 후 §5 비교 분석 추가 (2026-04-27 후반)
보강 2: Codex 라운드 3 fact-check 5건 반영 (2026-04-27 후반 · §7 fact-check 블록 참조)
보강 3: **Phase 0' 작업 시작 후 Linux mount 라인 endings 사고 발생 → §12-§14 신설** (2026-04-27 야간)
보강 4: **Codex/하루 Windows 실행으로 Phase 0' 5건 완료** (2026-04-27 야간)

작업 진행 요약 (2026-04-27 기준):
- ✅ C2-P0-2 backend ruff 정리 완료 (`ruff check .` clean)
- ✅ C2-P0-3 공용 GPU gate 도입 (`studio/_gpu_lock.py`)
- ✅ C2-P0-4 ComfyUI mock fallback 설정화 (`settings.comfy_mock_fallback`, 기본 False)
- ✅ C2-P0-1 frontend 활성 테스트 baseline 작성 (`npm test` 8 passed)
- ✅ C2-P0-5 수동 QA 체크리스트 작성 (`docs/qa-checklist.md`)
- ⚠️ Linux mount 에서 backend 코드 직접 수정 시 라인 endings 변환 사고 발생 → 정책 변경 (§13)
- ✅ Windows 측에서 line endings 검사 + CRLF 보정 완료

이전 리뷰: `docs/refactor-review-for-claude-2026-04-26.md` + `docs/ui-refactor-review-for-claude-2026-04-26.md`
대상 코드 시점: HEAD `0c4b999` 직후 + spec 19 후속 누적 + Vision Recipe v2.1 + Compare v2.2.
실측 baseline (Phase 0' 완료 시점): backend pytest 207 passed / backend ruff clean / frontend npm test 8 passed / frontend lint+build pass.

---

## 0. 이번 리뷰의 위치

어제 (2026-04-26) Codex + Claude cross-review 가 백엔드 26 항목 (P0×5 + P1×7 + Claude A-G 7) + UI 24 항목 (P0×6 + P1×6 + Claude A-H 8) 식별. 그 이후 사용자가 router.py 풀 분해 (1,769→118 facade) + legacy quarantine + spec 19 비전/gemma4 시스템 프롬프트 점검 + Ollama 단계별 unload 옵션 A/B + VRAM Breakdown 오버레이 등 굵직한 작업 진행.

이 리뷰는 **(1)** 어제 식별 항목들의 처리 상태 추적, **(2)** 어제 이후 추가된 새 영역의 신규 리뷰, **(3)** Codex 병렬 리뷰와 비교 가능한 인벤토리 형태 정리.

검증 결과 (Windows 실행):
- `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m ruff check .` → clean
- `cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests` → 207 passed
- `cd frontend && npm test` → 8 passed
- `cd frontend && npm run lint` → pass
- `cd frontend && npm run build` → pass

---

## 1. 어제 백엔드 리뷰 처리 상태 (Codex P0/P1 + Claude A-G)

### 1.1 Codex P0 (5건) — 모두 처리 완료

| ID | 항목 | 상태 | 근거 |
|----|------|------|------|
| P0-1 | Task TTL 활성 작업 cancel | **✅ 처리** | `tasks.py:74-88` — `TASK_TTL_SEC=600` 단일 정책 → `_CLOSED_TTL_SEC` + `_ACTIVE_IDLE_TTL_SEC` 분리. `last_event_at` 기반 좀비 판정. |
| P0-2 | `logger` undefined (F821) | **✅ 처리** | router.py 가 facade 로 분해되어 metrics 호출 자체 사라짐. system_metrics.py 자체엔 `logger = logging.getLogger(__name__)` 정의 (line 34). |
| P0-3 | duplicate `comfyui_pid` (F811) | **✅ 처리** | `process_manager.py` 에 `comfyui_pid` 한 곳만 (line 48). |
| P0-4 | `mark_generation_complete` 누락 | **✅ 처리** | `pipelines/{generate,edit,video}.py` 3 곳 모두 `_mark_generation_complete()` 호출 (line 216/198/238). `_dispatch.py:53` 에 통합 정의 + graceful 처리. |
| P0-5 | AutoStartBoot fake running | **✅ 처리** | `frontend/components/app/AppShell.tsx:35` — `setProcessStatus("comfyui","start")` 실 백엔드 호출. UI 만 토글하던 패턴 제거. |

**평가**: Phase 0 안정화는 깔끔히 완료. 회귀 위험 없는 수정들.

### 1.2 Codex P1 (7건) — 부분 처리

| ID | 항목 | 상태 | 근거 |
|----|------|------|------|
| P1-1 | `router.py` 분리 | **✅ 완료 (대규모)** | 1,769→118 facade. `routes/` 7 파일 + `pipelines/` 5 파일. mock.patch 5건 갱신. |
| P1-2 | legacy quarantine | **✅ 완료** | `backend/legacy/{routers,services,tests}/` 격리. main.py 등록 끊김. |
| P1-3 | preset parity test | **❌ 미처리** | `find backend/tests -name "*preset*"` 결과 0. 백엔드/프론트 동기화 사고가 spec 누적 중 2회 발생 (Lightning 8/1.5 + extra LoRA 교체) → drift detection 자체 가치 큼. |
| P1-4 | mock 정책 명시 | **✅ 처리** | `config.py` 의 `settings.comfy_mock_fallback` 으로 이동. 기본 False. `_dispatch.py` 는 설정값을 읽고, frontend header 는 `NEXT_PUBLIC_USE_MOCK` badge 표시. |
| P1-5 | Edit upload validation | **✅ 처리** | size + image 형식 검증 적용. Phase 1에서 `storage.STUDIO_MAX_IMAGE_BYTES` 단일 상수로 Edit/Video/Vision/Compare 4곳 통합 완료. |
| P1-6 | versioned migrations | **❌ 미처리** | `history_db.py` 여전히 ALTER TABLE 인라인 (line 144/159/177/191). `schema_version` 테이블 미도입. P2 강등 가능. |
| P1-7 | active path tests (frontend) | **⚠️ 부분 처리** | 활성 테스트 3 파일 추가: `api-client.test.ts`, `pipeline-stream.test.ts`, `process-api.test.ts`. `npm test` 8 passed. hook 4개 직접 테스트는 Phase 1 보강으로 잔류. |

### 1.3 Claude cross-review 추가 (A-G, 7건) — 부분 처리

| ID | 항목 | 상태 | 근거 |
|----|------|------|------|
| A | Ollama 호출 분산 → `_ollama_client.py` | **❌ 미처리** | `ls backend/studio/_ollama_client.py` 부재. `prompt_pipeline` / `vision_pipeline` / `comparison_pipeline` / `ollama_unload` 4 모듈이 각각 `httpx.AsyncClient` + `/api/chat` 또는 `/api/ps` 직접 호출. |
| B | `_TASKS_LOCK` 일관성 | **✅ 처리** | `tasks.py` 에 `_TASKS_LOCK` + `_new_task` (line 93) + `_cleanup_stale_tasks` (line 112) 모두 `async with _TASKS_LOCK` 적용. read-only 부분도 `tasks.py:47` 주석에 "single-threaded asyncio 라 lock 없이 안전 (Codex 검증)" 로 명시. |
| C | 동적 import 순환 | **✅ 처리** | `pipelines/_dispatch.py:36` — `if TYPE_CHECKING: from ..tasks import Task` 만 1군데 (정상 패턴). 옛 router.py 함수 내부 지연 import 들 사라짐. |
| D | Mode Literal 타입 안전 | **✅ 처리** | `backend/studio/types.py` 신설 — `Mode = Literal[...]` + `HistoryMode`. frontend `lib/api/types.ts:18` 의 `StudioMode = "generate"\|"edit"\|"video"\|"vision"` 와 한쌍. |
| E | `upgrade_*_prompt` 3 함수 중복 | **❌ 미처리** | `prompt_pipeline.py` 의 `upgrade_generate_prompt` (410) / `upgrade_edit_prompt` (581) / `upgrade_video_prompt` (654) 3 함수 그대로. spec 19 에서 SYSTEM_EDIT/VIDEO/GENERATE 분기 강화로 차이는 더 커졌지만 호출 boilerplate (httpx + payload + 응답 파싱) 는 여전히 중복. |
| F | LoRA 체인 중복 | **❌ 미처리** | `comfy_api_builder.py:105` `_build_lora_chain` (이미지) + `:565` `_build_video_lora_chain` 그대로. spec 19 의 GENERATE_STYLES 시스템 추가로 분기 가능성 더 늘었지만 통합 헬퍼 미도입. |
| G | `_errors.py` 도메인 예외 | **❌ 미처리** | `ls backend/studio/_errors.py` 부재. `OllamaError` / `ComfyError` 분류 미도입. |

**처리율**: P0 5/5 (100%) · P1 2/7 (29%) · Claude 추가 3/7 (43%) = **백엔드 전체 10/19 (53%)**

---

## 2. 어제 UI 리뷰 처리 상태 (Codex P0/P1 + Claude A-H)

### 2.1 Codex UI P0 (6건) — 모두 처리 완료 또는 부분

| ID | 항목 | 상태 | 근거 |
|----|------|------|------|
| P0-1 | 데스크톱 정책 미명시 | **❌ 미처리 (정책 결정 대기)** | `STUDIO_MIN_WIDTH = 1024` 그대로. README/문서에 정책 명시 부재. **결정 사항 — 오빠 컨펌 필요**. |
| P0-2 | `--radius-md` 미정의 | **✅ 처리** | `grep "radius-md" frontend/` 결과 0. globals.css 에 6단계 토큰 정의 (`--radius-sm/--radius/--radius-card/--radius-lg/--radius-xl/--radius-full`). |
| P0-3 | MenuCard disabled | **✅ 처리** | `MenuCard.tsx` — `disabled={disabled}` + `aria-disabled={disabled}` 둘 다 적용 (50-51, 197-198). 시각 + 접근성 모두 일관. |
| P0-4 | StudioUploadSlot keyboard | **✅ 처리** | `StudioUploadSlot.tsx:212` — 주석 "UI P0-4: keyboard 접근성 (role+tabIndex+Enter/Space+focus-visible)" + `role="button"` `tabIndex={0}` `onKeyDown` `aria-label`. |
| P0-5 | SystemMetrics hover-only | **✅ 처리** | `SystemMetrics.tsx:111-112` — `aria-label="시스템 자원 사용률"` + 주석 "UI P0-5: keyboard focus 시에도 펼쳐지게. globals.css 의 :focus-within 분기와 한쌍". |
| P0-6 | ProgressModal 취소 의미 | **⚠️ 부분 처리** | `ProgressModal.tsx:11` — "닫기 버튼 — 생성 취소 아님, 모달만 닫음" 명시. line 408 — "UI P0-6: 실제 /interrupt 가 먹히는 ComfyUI 단계에서만 노출". **단계별 노출 토글 적용은 됐지만 단계별 라벨 정밀화 (`ComfyUI 중단` vs `생성 중단`) 추가 검토 가능**. |

### 2.2 Codex UI P1 (6건) — 일부만 처리

| ID | 항목 | 상태 | 근거 |
|----|------|------|------|
| P1-1 | paste listener 중앙화 | **❌ 미처리** | `useImagePasteTarget.ts` 부재. `StudioUploadSlot.tsx:156` + `vision/compare/page.tsx:176` 분산 listener 그대로. |
| P1-2 | inline → CSS module | **❌ 미처리** | 페이지 레벨 인라인 style 객체 다수 잔존 (검증 미수행 — Codex 다음 라운드에서 깊이 보면 좋음). |
| P1-3 | 메인 메뉴 3열 고정 | **❌ 미처리 (P0-1 결정 대기)** | breakpoint 도입 전 정책 결정 선행 필요. |
| P1-4 | ResultHoverActionBar focus-within | **❌ 미처리** | `grep "focus-within\|focus-visible\|onFocus" ResultHoverActionBar.tsx` 결과 0. |
| P1-5 | VisionResultCard 정보 밀도 | **❌ 미처리** | spec 19 후속으로 9 슬롯 (Vision Recipe v2.1) 추가되어 부담 더 커짐. P0-1 후 자연 처리. |
| P1-6 | 색상/아이콘 token | **❌ 미처리** | spec 19 의 `#DC2626` 위험 그라데이션 등은 아직 raw color. |

### 2.3 Claude UI cross-review 추가 (A-H, 8건) — 핵심 4건 처리

| ID | 항목 | 상태 | 근거 |
|----|------|------|------|
| A | `usePipelineStream` SSE 추상화 | **✅ 처리** | `frontend/hooks/usePipelineStream.ts` 신설 + `consumePipelineStream` 함수. 3 hook (`useGeneratePipeline:25` / `useEditPipeline:17` / `useVideoPipeline:12`) 모두 import. |
| B | `useAutoCloseModal` | **✅ 처리** | `frontend/hooks/useAutoCloseModal.ts` 신설. |
| C | `useAutoGrowTextarea` | **✅ 처리** | `frontend/hooks/useAutoGrowTextarea.ts` 신설. |
| D | 페이지 루트 의존성 폭발 | **⚠️ 부분 처리 (라운드 3 fact-check 후 좁힘)** | generate/edit/video 페이지는 이미 상당히 분해됨. **남은 진짜 압박 지점은 `frontend/app/vision/compare/page.tsx` 859줄 단독** — Codex C2-P1-1 으로 통합 처리. Claude D 단독 항목은 사실상 폐기. |
| E | StudioMode union | **✅ 처리** | `frontend/lib/api/types.ts:18` `StudioMode = "generate"\|"edit"\|"video"\|"vision"`. backend `Mode` 와 한쌍. |
| F | HistoryGallery 가상화 | **❌ 미처리** | `grep "react-window\|IntersectionObserver" HistoryGallery.tsx` 결과 0. |
| G | persist migrate 모듈 분리 | **❌ 미처리** | 인라인 migrate 그대로. P2 — 당장 위험 없음. |
| H | 호버 inline → CSS `:hover` | **❌ 미처리** | 4 페이지 메인 CTA 의 `onMouseEnter/Leave` mutation 그대로. P1-2 와 한쌍. |

**처리율**: UI P0 5/6 (83% · P0-1 정책 대기) · UI P1 0/6 (0%) · UI Claude 추가 4/8 (50%) = **UI 전체 9/20 (45%)**

---

## 3. 새 영역 리뷰 — router 분해 후 routes/+pipelines/

어제 리뷰에서는 router.py 분해 자체가 P1-1 권고였고, 사용자가 그걸 받아 풀 분해했음. 이번 리뷰는 분해된 결과 평가.

### 3.1 강점 (잘 된 부분)

- **도메인 응집도 우수**: `routes/_common.py` (SSE/태스크 유틸 공용) → `streams/prompt/vision/compare/system` 5 도메인 분기. `pipelines/_dispatch.py` (ComfyUI 디스패치 공용 헬퍼) → `generate/edit/video` 3 모드 별 파이프라인. 도메인별 라인수 균형 (routes 84-259, pipelines 206-311) — 한 모듈이 비대해지지 않음.
- **mock.patch 갱신 5건 명시**: CLAUDE.md 의 "mock.patch 위치 = lookup 모듈 기준" 규칙 신설. 분해 시 회귀 차단.
- **외부 호환 re-export 정확**: router.py facade 가 storage/schemas/tasks/pipelines/routes._common + 외부 모듈 alias 모두 re-export → 옛 테스트 무수정 호환.
- **`_dispatch_to_comfy` 의 idle/hard timeout 인자화**: Generate/Edit (1200/7200) vs Video 의 차등 적용 가능. 16GB swap 케이스 안전망.
- **`_proc_mgr` 격리 호환**: legacy quarantine 후에도 `from services.process_manager import process_manager as _proc_mgr` 만 그대로 — `services/process_manager.py` 만 backend/services/ 에 단독 잔존하는 정책 일관.

### 3.2 새 발견 사항 (어제 리뷰 미언급)

#### 🟡 N1. `_proc_mgr` import 중복 (DRY)
**파일**: `routes/_common.py:21-24` + `pipelines/_dispatch.py:42-45`
**문제**: 같은 `services.process_manager.process_manager` 싱글톤을 두 곳에서 try/except 로 import. 동작은 OK (Python module cache 가 동일 인스턴스 보장) 이지만 fallback 패턴 (`_proc_mgr = None`) 도 두 번 작성. 신규 코드가 어느 쪽을 쓸지 일관 없음.
**수정안**: `backend/studio/_proc_mgr.py` 단일 모듈 (`from services.process_manager import process_manager` + 폴백) → routes/pipelines 모두 import.
**위험도**: 🟢 낮음 (DRY 개선).

#### ✅ N2. Image-bytes 상수 4 분기 (P1-5 단일화 처리)
**파일**: `pipelines/edit.py:37` + `pipelines/video.py:43` + `routes/vision.py:23` + `routes/compare.py:35`
**문제**: 동일 값 `20 * 1024 * 1024` 가 4 곳 별도 상수 (`_EDIT_/_VIDEO_/_VISION_/_COMPARE_MAX_IMAGE_BYTES`). 모두 20MB. 하나만 바꾸면 일관성 깨짐.
**처리**: `backend/studio/storage.py` 에 `STUDIO_MAX_IMAGE_BYTES = 20 * 1024 * 1024` 상수 한 번 정의. Edit/Video/Vision/Compare 업로드 검증 경로가 공용 상수를 import.
**위험도**: 🟡 중간 (미통일 시 차후 회귀 위험).

#### 🟢 N3. `routes.streams` import 부담
**파일**: `routes/streams.py:22-27`
**문제**: `pipelines` 패키지에서 12+ 심볼 import (`_EDIT_MAX_IMAGE_BYTES, _VIDEO_MAX_IMAGE_BYTES, _run_*_pipeline, _extract_image_dims, ...`). pipelines 의 internal helper 가 routes 로 노출됨 → 캡슐화 약간 누수.
**수정안**: `pipelines/__init__.py` 의 `__all__` 정리 (현재 11 심볼) — public 심볼 / internal helper 명확화. 신규 코드는 public 만 사용 권장 명시.
**위험도**: 🟢 낮음 (현재 동작 OK).

#### 🟢 N4. router.py facade 의 30+ 심볼 re-export 수명
**파일**: `router.py:42-118`
**문제**: 외부 호환 re-export 30+ 심볼. CLAUDE.md "신규 코드는 본래 위치 직접 import 권장" 정책은 명시됐지만 강제 수단 (mypy strict / lint rule) 부재. 시간 흐르면서 facade 수명 늘 수 있음.
**수정안**: (a) `router.py` 에 deprecation 주석 + 사용 안 되는 심볼 매분기 정리, 또는 (b) ruff rule 로 신규 코드의 `from .router import X` 차단.
**위험도**: 🟢 낮음 (점진 정리 가능).

---

## 4. 새 영역 리뷰 — spec 19 + VRAM Breakdown 오버레이

### 4.1 강점

- **`force_unload_all_before_comfy` 깔끔**: `/api/ps` → 병렬 unload (asyncio.gather) → `wait_sec sleep`. graceful 실패 흡수. ComfyUI 디스패치 직전 안전망 정확.
- **단계별 unload (옵션 B)**: `vision_pipeline` / `video_pipeline` 안에서 모델 전환마다 `unload_model + asyncio.sleep(1.0)` 호출 — 16GB swap 케이스 안전. 사용자 체감 검증 (3분+ → 30~60초).
- **`_json_utils.parse_strict_json` quoted-string aware scanner**: `in_string` 상태 + backslash escape 추적 정확. JSON 안 brace 무시 처리 깔끔. 모듈 leaf 위치라 순환 import 안전.
- **`get_vram_breakdown` 폴백 휴리스틱**: Windows 권한 정책으로 nvidia-smi `used_memory=[N/A]` 케이스 발견 후 `total - ollama - other` 차이를 ComfyUI 추정. 0.5GB 미만 잡음 컷오프.

### 4.2 새 발견 사항 (어제 리뷰 미언급)

#### 🟡 N5. `force_unload_all_before_comfy` 함수명 vs 사용처 의미 어긋남
**파일**: `routes/compare.py:163-164` + `ollama_unload.py:103`
**문제**: 함수명 "before_comfy" 가 명시. compare-analyze 는 ComfyUI 디스패치 안 함 — 비전 분석 후 keep_alive deferred unload 정리용으로 호출. naming 의미 어긋남.
**수정안**: (a) 함수명 `force_unload_all` 로 generic 화 + ComfyUI 직전 호출은 의도 주석으로, 또는 (b) `unload_all_for_compare_post()` 별 함수.
**위험도**: 🟢 낮음 (가독성).

#### 🟡 N6. unload wait 시간 1.0 vs 1.5 비일관
**파일**: `ollama_unload.py:42` (`GPU_RELEASE_WAIT_SEC = 1.5`) vs `vision_pipeline.py` 단계별 unload (`asyncio.sleep(1.0)` — CLAUDE.md 인용).
**문제**: ComfyUI 직전 안전망은 1.5초, 단계별 unload 는 1.0초. 둘 다 GPU 메모리 반납 대기 목적이지만 값 다름.
**수정안**: 공통 상수 `GPU_RELEASE_WAIT_SEC` 하나로 통일. `ollama_unload` 에 모듈 상수 + vision/video pipeline 도 import.
**위험도**: 🟢 낮음 (실제 영향 거의 없음, DRY 개선).

#### 🟡 N7. `dispatch_state` 단일 워커 가정
**파일**: `dispatch_state.py:13` 주석 — "단일 워커 가정 + 단순 dict 쓰기는 GIL 보호. 별도 lock 불필요"
**문제**: uvicorn workers=1 가정 정확 (현재 환경). 향후 `--workers 2+` 설정 시 모듈 변수 race + 각 worker 별로 별도 dict → VRAM Breakdown UI 가 worker 별 다른 값 표시 가능.
**수정안**: 현재는 OK — README/CLAUDE.md 에 "uvicorn 단일 워커 필수" 명시만. 향후 multi-worker 시 Redis 또는 SQLite 공유 필요.
**위험도**: 🟢 낮음 (현재 환경 안전).

#### 🟡 N8. `get_vram_breakdown` Other 프로세스 분류 잡음
**파일**: `system_metrics.py:300-315` 폴백 계산
**문제**: "0.5GB 미만 잡음 컷오프" 적용. 하지만 Chrome 4K 탭 / 게임 / OBS 등 실제 GPU 점유 1-2GB 가능. 이 경우 ComfyUI 추정치가 Other 점유분만큼 부풀려짐 → 사용자 UI 에 "ComfyUI 9.2G" 표시되지만 실제 Other 1.5G + ComfyUI 7.7G 같은 케이스.
**수정안**: 1차 — Other 점유 0.5GB 이상이면 별도 row 표시 (UI 에 "기타 1.5G" 노출). 2차 — `_OLLAMA_NAME_HINTS` / `_COMFYUI_NAME_HINTS` 외 process_name allowlist 만 ComfyUI 로 추정 + 나머지는 Other 확정.
**위험도**: 🟡 중간 (사용자가 노이즈 점유 헷갈릴 수 있음).

#### 🟢 N9. `_json_utils` 에 `_coerce_score` 누락
**파일**: `comparison_pipeline.py` (CLAUDE.md spec 19 후속 3 fix 중 1)
**문제**: `coerce_str` 만 `_json_utils.py:74` 에 통합. `_coerce_score` (문자열 `"95"`/`"95%"`/`"95/100"` → int 변환) 는 comparison_pipeline.py 에 인라인 가능성. 두 함수 같은 도메인 (모델 응답 파싱) — 한 곳 통합 권장.
**수정안**: `_coerce_score` 도 `_json_utils.py` 로 이동. comparison_pipeline import 갱신.
**위험도**: 🟢 낮음 (DRY).

---

## 5. Codex 라운드 2 비교 분석 (2026-04-27 후반 합산)

Codex 가 같은 코드 베이스를 독립 리뷰. P0 3 개를 새로 잡았는데 그 중 2 개는 **Claude 단독 리뷰가 정적 분석 한계로 못 잡은 운영 위험**, 1 개는 **동시성 시나리오 추적 누락**. 직교적이라 합치면 빈틈 거의 메워짐.

### 5.1 Codex 라운드 2 P0 (5건)

| ID | 항목 | 합산 위험도 | Claude 라운드 1 결과 |
|----|------|-------------|----------------------|
| C2-P0-1 | **프론트 활성 테스트 0개 → npm test fail** | 🔴 운영 영향 직접 | 어제 P1-7 미처리로 봤지만 **fail 한다는 건 못 잡음** (npm test 실행 안 함). 파일은 `frontend/__tests__/setup.ts` + `frontend/legacy/__tests__/slices.test.ts` 존재 — vitest 가 legacy/** 제외해서 활성 0개 상태. |
| C2-P0-2 | **백엔드 ruff 26건 fail — legacy 제외 정책 + tests lint 범위 결정 + active 6건 수정** | 🔴 lint gate 깨짐 | Linux 환경 + Windows venv 충돌로 ruff 실행 못 함. 26건 분포: **active 6건 + tests 19건 + legacy 1건**. 작업 단위는 (1) ruff config 의 legacy 제외 (2) tests 디렉토리 lint 범위 결정 (3) active 6건 수정. |
| C2-P0-3 | **GPU 작업 직렬화 재설계 — compare lock vs ComfyUI dispatch lock 분리** | 🔴 swap 회귀 가능 | spec 19 ollama_unload 안전망에 만족해서 동시성 시나리오 추적 누락. ⚠️ **A 가 compare 분석 중일 때 B 가 generate 시작하면 vision 호출과 ComfyUI dispatch 가 동시 GPU 점유 → swap**. |
| C2-P0-4 | ComfyUI mock fallback 설정화 | 🟡 어제 P1-4 동의 → 격상 | Claude 어제 P1-4 동의 + 오늘 미처리 확인. Codex 가 P0 격상. |
| C2-P0-5 | 실제 workflow smoke QA 체크리스트 | 🟢 자동화 어려운 영역 | 어제 P2-4 였음. Codex 가 P0 격상. |

### 5.2 Codex 라운드 2 P1 (8건)

| ID | 항목 | 합산 평가 | Claude 라운드 1 결과 |
|----|------|-----------|----------------------|
| C2-P1-1 | **vision/compare/page.tsx 859줄 분해** | 🔴 새 발견 (라운드 3 fact-check) | generate/edit/video 페이지는 이미 분해됨. **진짜 압박 지점은 vision/compare/page.tsx 859줄 단독**. paste/upload hook + compare pipeline hook + viewer + analysis panel 로 분리. (Claude D 항목은 이 항목으로 대체됨.) |
| C2-P1-2 | 큰 컴포넌트 분해 (ProgressModal/ImageLightbox/VisionResultCard 각 800줄대) | 🔴 새 발견 | Claude 단독은 페이지 분해만 봤고 컴포넌트 자체 라인 수 측정 안 함. |
| C2-P1-3 | `@/lib/api-client` barrel 의존 줄이기 (24 곳) | 🟢 새 발견 | Claude 미언급. lib/api/* 직접 import 로 응집도 향상. |
| C2-P1-4 | 프론트 active path 테스트 추가 | ✅ 합의 | 어제 P1-7 동일. C2-P0-1 (npm test fail) 과 한쌍. |
| C2-P1-5 | 모델 프리셋 단일 기준화 + drift test | ✅ 합의 | 어제 P1-3 동일. |
| C2-P1-6 | 업로드 제한 상수 통합 | ✅ 합의 | 어제 P1-5 + 오늘 N2 강조. 4 곳 동일값 (20MB) 정리 강한 신호. |
| C2-P1-7 | paste listener 중앙화 | ✅ 합의 | 어제 UI P1-1 동일. |
| C2-P1-8 | ResultHoverActionBar focus-within | ✅ 합의 | 어제 UI P1-4 동일. |

### 5.3 Codex 라운드 2 P2 (7건)

| ID | 항목 | Claude 라운드 1 결과 |
|----|------|----------------------|
| C2-P2-1 | OpenAPI / 계약 테스트 | 어제 P2-1 합의. 미처리 누적. |
| C2-P2-2 | CI 품질 게이트 | 어제 P2-2 합의. 미처리 누적. |
| C2-P2-3 | SQLite migration 버전화 | 어제 P1-6 → C2-P2-3 강등 (Codex 도 P2 동의). |
| C2-P2-4 | startup script 설정화 | 어제 P2-3 합의. 미처리 누적. |
| C2-P2-5 | UI visual regression | 어제 P2-2 (UI) 합의. 미처리 누적. |
| C2-P2-6 | 디자인 시스템 문서화 | 어제 P2-1 (UI) 합의. 미처리 누적. |
| C2-P2-7 | inline style 점진 축소 | 어제 P1-2 + Claude UI H 합의. |

### 5.4 비교 매트릭스 — 둘 다 잡음 / Codex 만 / Claude 만

| 분류 | 항목 | 의미 |
|------|------|------|
| **둘 다 잡음** (8건 — 강한 신호) | ComfyUI mock 설정화 / 업로드 상수 통합 / paste listener 중앙화 / 모델 프리셋 parity / ResultHoverActionBar focus-within / 프론트 active path 테스트 / SQLite migration 버전화 / inline style 축소 | 진짜 이슈 확정 — 우선 처리 |
| **Codex 만** (10건 — Claude 사각지대) | C2-P0-1 npm test fail / C2-P0-2 ruff 26건 / C2-P0-3 GPU lock 통합 / C2-P0-5 smoke QA / C2-P1-1 compare page 분해 / C2-P1-2 800줄 컴포넌트 분해 / C2-P1-3 api-client barrel / C2-P2-1 OpenAPI / C2-P2-2 CI 게이트 / C2-P2-4 startup script / C2-P2-5 visual regression / C2-P2-6 디자인 시스템 문서 | **운영/실행/동시성 관점** — Codex 강함 |
| **Claude 만** (12건 — Codex 사각지대) | Claude A `_ollama_client.py` / Claude E upgrade 통합 / Claude F LoRA 통합 / Claude G `_errors.py` / N1 `_proc_mgr` 중복 / N3 routes import / N4 facade 수명 / N5 force_unload 함수명 / N6 wait 1.0 vs 1.5 / N7 dispatch_state multi-worker / N8 VRAM Other 분류 / N9 _coerce_score 위치 | **백엔드 DRY/명명 일관성** — Claude 강함 |

**관점 차이**: Codex = 운영/실행/사용자 영향 / Claude = 코드 구조/DRY. 직교적이라 합쳐야 완전.

---

## 6. 우선순위 통합 추천 (Codex 라운드 2 합산)

어제 리뷰의 Phase 0 (5건) 완료 → 새 P0 3건 (Codex 라운드 2) 발견 → Phase 1 + Claude 추가 절반 진행 중. 아래는 **합산 후 갱신된 우선순위**.

### Phase 0' (즉시 — 1-2일 · Codex 라운드 2 P0 합산)

```text
🔴 즉시 fix (운영 직접 영향):
  1. C2-P0-2 백엔드 ruff 정리 (1-2h)
     → 26건 분포: active 6 / tests 19 / legacy 1
     → 작업 3단계:
       (a) pyproject.toml ruff 설정에 backend/legacy/** 제외 → 1건 자동 사라짐
       (b) tests/ lint 범위 결정 — 풀 lint vs 일부 rule 만 (E501/F401 등)
       (c) active 6건 수정 (소수)
     → 호흡 짧고 회귀 위험 적음 → 첫 번째로 처리 추천
  2. C2-P0-3 GPU 작업 직렬화 재설계 — **최소 GPU gate 단계** (4-6h) ⚠️ 핵심
     → 공용 _GPU_LOCK (asyncio.Lock) 도입
     → compare/vision-analyze (Ollama 비전) + generate/edit/video (ComfyUI dispatch) 모두 같은 락
     → 30s timeout → 503 backpressure 패턴은 _COMPARE_LOCK 그대로 일반화
     → spec 19 ollama_unload 안전망의 마지막 빈틈 메움
     → ⚠️ 라운드 3 fact-check: **이 단계에선 _ollama_client.py 동시 도입 X**
        (HTTP client 추상화 + 동시성 제어 = 영향 범위 둘 다 넓음 → 한 번에 묶으면 위험)
        Phase 1 보강에서 별도 작업으로 진행
  3. C2-P0-4 ComfyUI mock fallback 설정화 (1-2h)
     → COMFY_MOCK_FALLBACK 상수 → settings.comfy_mock_fallback (기본 False)
     → frontend 도 NEXT_PUBLIC_USE_MOCK 가시성 (UI badge)
  4. C2-P0-1 프론트 활성 테스트 작성 (1-2일)
     → 완료: 활성 테스트 3 파일 / 8 tests (`parseSSE`, process mapping, stream consumer)
     → 잔류: useGeneratePipeline / useEditPipeline / useVideoPipeline / useVisionPipeline 직접 테스트
  5. C2-P0-5 수동 QA 체크리스트 (30분)
     → docs/qa-checklist.md — generate/edit/video/vision/compare 5 시나리오
```

### Phase 1 보강 (Codex 라운드 2 P1 + Claude 추가 — 3-5일)

**합의 항목 묶음** (둘 다 잡은 이슈 — 우선):
```text
1. C2-P1-6 STUDIO_MAX_IMAGE_BYTES 단일화 (30분 · N2) ✅ 완료
   → `storage.py` 상수 1개 + Edit/Video/Vision/Compare import 갱신
2. C2-P1-5 모델 프리셋 parity test (3-4h)
   → backend presets.py vs frontend model-presets.ts JSON export 후 비교
3. C2-P1-7 paste listener 중앙화 (3-4h)
   → useImagePasteTarget(activeSlotId) hook
4. C2-P1-8 ResultHoverActionBar focus-within (1h)
   → 4 페이지 자동 전파
```

**Codex 단독 항목** (Claude 사각지대):
```text
5. C2-P1-2 800줄대 컴포넌트 분해 (3-4일)
   → ProgressModal / ImageLightbox / VisionResultCard 각각
   → spec 19 v2.1 9 슬롯이 VisionResultCard 압박 — 분해 시 정보 위계 정리 자연 처리
6. C2-P1-1 vision/compare/page.tsx 분해 (4-6h)
   → 페이지 / paste hook / pipeline hook / viewer / analysis panel
7. C2-P1-3 api-client barrel 24 곳 정리 (4-6h)
   → 점진 — active 코드 lib/api/* 직접 import 전환
```

**Claude 단독 항목** (Codex 사각지대 — 백엔드 DRY):
```text
8. Claude A _ollama_client.py 신설 (4-6h)
   → httpx 풀 + call_chat 통합 (4 모듈 + ollama_unload 중복 제거)
   → ⚠️ 라운드 3 fact-check: Phase 0' C2-P0-3 GPU lock 작업 완료 + 테스트 통과 후 진행
      (HTTP client 추상화 + 동시성 제어 = 영향 범위 둘 다 넓어 한 번에 묶으면 회귀 위험)
   → 호출부 정리는 GPU lock 안정화 후 자연 따라옴
9. Claude E upgrade_*_prompt 공통 헬퍼 (3h)
   → pipelines/_upgrade_common.py
10. Claude G _errors.py 도메인 예외 (2h)
    → OllamaError / ComfyError + 호출부 매핑
11. N1 _proc_mgr.py 단일 모듈 (30분)
12. N6 GPU_RELEASE_WAIT_SEC 단일 상수 (15분)
13. N9 _coerce_score → _json_utils 이동 (15분)
```

### Phase 2 정책 결정 + 정리 (1-2일)

```text
1. UI P0-1 데스크톱-only 정책 명시 (오빠 결정 필요)
   → README + StudioLayout 주석 + 1024 미만 안내 UI
   → 결정 후 UI P1-3 (메뉴) / P1-5 (Vision 카드) 자연 처리
2. UI Claude D 페이지 루트 분리 (1일 — 페이지 라인 수 측정 후 결정)
3. UI Claude H 호버 inline → CSS :hover (1일, P1-2 와 한쌍)
4. Claude F LoRA 체인 통합 _apply_loras (2h)
```

### 차후 (선택 · P2)

```text
- C2-P2-1 OpenAPI / 계약 테스트
- C2-P2-2 CI 품질 게이트
- C2-P2-3 SQLite migration 버전화
- C2-P2-4 startup script 설정화
- C2-P2-5 UI visual regression
- C2-P2-6 디자인 시스템 문서화
- C2-P2-7 inline style 점진 축소 (P1-2 와 한쌍)
- UI Claude F HistoryGallery 가상화 (100+ 누적 후)
- UI Claude G persist migrate 모듈 분리
- N3 routes.streams import 정리
- N4 router.py facade 수명 정책
- N5 force_unload_all_before_comfy 함수명
- N7 dispatch_state multi-worker 대비
- N8 VRAM Breakdown Other 분류 정밀화
```

---

## 7. Codex 라운드 2 합산 요약

```text
처리율 통계 (어제 리뷰 26+24=50 항목 기준):
  백엔드 P0:        5/5  (100%)
  백엔드 P1:        2/7  ( 29%)
  백엔드 Claude+:   3/7  ( 43%)
  UI P0:            5/6  ( 83%) — P0-1 정책 결정 대기
  UI P1:            0/6  (  0%)
  UI Claude+:       4/8  ( 50%)
  ─────────────────────────────
  전체:            19/39 ( 49%)

Codex 라운드 2 새 P0 (2026-04-27 후반):
  C2-P0-1 프론트 활성 테스트 0개 → npm test fail   🔴
          (파일: setup.ts + legacy/__tests__ 존재 · vitest legacy 제외 → 활성 0)
  C2-P0-2 백엔드 ruff 26건 → 분포 active 6 / tests 19 / legacy 1   🔴
  C2-P0-3 GPU 작업 직렬화 재설계 (compare lock + ComfyUI dispatch lock 분리)  🔴
  C2-P0-4 ComfyUI mock fallback 설정화 (어제 P1-4 격상)  🟡
  C2-P0-5 수동 QA 체크리스트 (어제 P2-4 격상)  🟢

Codex 라운드 3 fact-check (2026-04-27 후반):
  ① ruff 26건 = "active 26건" 부정확 → active 6 + tests 19 + legacy 1 분포
  ② 백엔드 pytest 기대값 201/201 가정 → 당시 실측 203 passed, Phase 0' 완료 후 207 passed
  ③ 프론트 "테스트 파일 0개" 부정확 → "활성 테스트 0개" 정확 (legacy 제외 결과)
  ④ Claude UI D "페이지 분리 미진행" 부정확 → generate/edit/video 이미 분해
     남은 진짜 압박 = vision/compare/page.tsx 859줄 단독 (C2-P1-1 으로 통합)
  ⑤ GPU lock + _ollama_client.py 한 묶음 → 위험 (영향 범위 둘 다 넓음)
     순서: 최소 GPU gate → 테스트 통과 → _ollama_client.py 별도 단계

Claude 새 발견 (오늘 1차):
  N1 _proc_mgr import 중복         🟢
  N2 image-bytes 상수 4 분기        ✅ 처리 (Codex P1 합의)
  N3 routes.streams import 부담    🟢
  N4 router.py facade 수명          🟢
  N5 force_unload 함수명 어긋남     🟢
  N6 unload wait 1.0 vs 1.5         🟢
  N7 dispatch_state multi-worker    🟢 (현재 안전)
  N8 VRAM Other 분류 잡음           🟡
  N9 _coerce_score → _json_utils    🟢

합산 후 P0 즉시 처리 항목 (5건):
  → §6 Phase 0' 참조 (총 1-2일 예상)

핵심 미해결 (오빠 결정 필요):
  - UI P0-1 데스크톱-only vs 반응형
  - C2-P0-3 GPU lock 통합 시점 — Phase 0' 첫 작업 추천
  - C2-P0-1 프론트 테스트 작성 범위 — hook 4개 + parseSSE/history sync 6개?
  - Claude A _ollama_client.py 와 C2-P0-3 GPU lock 통합 한 번에 묶기?
```

---

## 8. 미해결 / 오빠 결정 필요

```text
1. UI P0-1 viewport 정책:
   - 옵션 A (데스크톱-only 명시) — Claude 추천 (16GB VRAM 로컬 도구 ROI 관점)
   - 옵션 B (반응형 baseline) — Codex 단기 추천
   → 결정 후 UI P1-3 (메뉴), UI P1-5 (Vision 카드) 자동 처리

2. C2-P0-3 GPU lock 통합 설계 (즉시):
   - 옵션 A: 단일 _GPU_LOCK (asyncio.Lock) — compare/vision/edit 비전 + generate/edit/video ComfyUI 모두
   - 옵션 B: 큐 기반 (asyncio.Queue + worker) — 차후 multi-job 큐 확장 가능
   → 추천: A 먼저 (단순 · 회귀 위험 적음). 나중에 사용자 대기 길어지면 B 로 진화.
   → 30s timeout → 503 backpressure 패턴은 _COMPARE_LOCK 그대로 일반화.
   → ⚠️ 라운드 3 fact-check: 이 단계에선 **_ollama_client.py 동시 도입 X**.
     HTTP client 추상화 + 동시성 제어 = 영향 범위 둘 다 넓음. 한 번에 묶으면 회귀 위험.

3. Phase 1 보강 진행 순서 (라운드 3 fact-check 반영):
   - GPU lock 단계 완료 + pytest/ruff/npm test 모두 ✅ 확인 후
   - → Claude A _ollama_client.py (Phase 1 내 별도 단계)
   - → 호출부 정리는 GPU lock 안정화 후 자연 따라옴 (의존성 그래프 깔끔)
   - 결정 필요: Phase 0' 직후 Phase 1 즉시 시작 vs 별도 spec 사이에 끼울지?

4. C2-P0-1 프론트 테스트 작성 범위:
   - 옵션 A: hook 4개만 (useGeneratePipeline / useEditPipeline / useVideoPipeline / useVisionPipeline)
   - 옵션 B: A + parseSSE + history sync (6개)
   - 옵션 C: B + useGenerateStore (사이즈 스냅) + useHistoryStore (서버 hydration) (8개)
   → Claude 추천: B (npm test baseline 회복 + SSE 파서 회귀 차단).

5. preset parity test (C2-P1-5):
   - JSON export 후 비교 vs runtime fetch 후 비교
   → Claude 추천: JSON export. 빌드 의존성 적고 단순.

6. legacy/ 격리 후속:
   - 현재 코드 본체 무수정 정책 그대로 유지
   - main.py 등록 끊김 — frontend/legacy 만 호출하던 dead path
   - 6개월 후 완전 삭제 검토 시점 결정?
```

---

## 9. 검증 체크리스트 (Phase 0' 완료 후)

```powershell
# 현재 baseline 확인
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/  # 207 passed
D:\AI-Image-Studio\.venv\Scripts\python.exe -m ruff check .   # clean

cd ..\frontend
npm test    # 8 passed
npm run lint
npm run build
```

**기대 결과**:
- pytest: **207 passed** ✅
- ruff: clean ✅
- npm test: **8 passed** ✅
- npm lint/build: pass ✅

이 baseline 이 다음 Phase 1 보강 작업의 출발점.

---

## 10. Codex 라운드 3 합산 절차 (필요 시)

이번 라운드 2 합산은 §5-§7 에 통합 완료. 다음 라운드 (Phase 1 보강 전 검증 라운드) 진행 시:

1. Phase 0' 완료 결과(ruff/pytest/npm test/lint/build) 기준으로 새 회귀 여부 확인
2. Codex 에 "Phase 0' 결과 검증 + 새 회귀 발견" 요청
3. Claude 가 받은 결과를 §5 비교 매트릭스에 "라운드 3" 컬럼 추가
4. 합의 항목 → 처리 완료 / 미합의 → §8 결정 사항으로 격상
5. 새 회귀 발견 → P0 즉시 fix

CLAUDE.md "Code Review (Codex 연동)" 정책 일관 — 상호 보완 관계 유지.

---

## 11. 메모

- 이 문서는 진행형 — Phase 0' 완료 시점에 §5 비교 매트릭스의 "둘 다 잡음" 항목들을 처리 완료로 마킹 + §6 Phase 1 보강으로 진행.
- 작업 순서는 §6 Phase 0' 의 추천 (ruff → GPU lock → mock 설정화 → 프론트 테스트 → QA 체크리스트). 호흡 짧은 작업부터 시작해 컨텍스트 유지 + GPU lock 같은 핵심 회귀 차단 작업에 충분한 집중 시간 확보.
- Codex 와 Claude 의 관점 차이는 약점이 아니라 자산 — 한쪽이 운영 위험을 잡고 다른 쪽이 구조 위험을 잡으면 한 사람이 한 라운드에 다 못 잡는 영역까지 커버 가능.

---

## 12. Phase 0' 진행 상황 (2026-04-27 야간 갱신)

### 12.1 C2-P0-2 백엔드 ruff 정리 — **✅ 완료**

| Step | 작업 | 상태 | 비고 |
|------|------|------|------|
| ① | ruff 실 분포 측정 | ✅ 완료 | active 6 + tests 19 + legacy 1 = 26건 (Codex fact-check 100% 일치) |
| ② | `backend/ruff.toml` 작성 (legacy 제외 + tests E741 면제) | ✅ 완료 | TOML 신규 파일. legacy quarantine 유지. |
| ③ | tests 16건 자동 fix (`ruff check tests/ --fix`) | ✅ 완료 | Windows venv 기준 실행. |
| ④ | active 6건 수동 fix | ✅ 완료 | `main.py`, `dispatch_state.py`, `comfy_api_builder.py`. |
| ⑤ | ruff clean (`Found 0 errors`) | ✅ 완료 | `ruff check .` clean. |
| ⑥ | pytest 회귀 0 검증 | ✅ 완료 | 207 passed (신규 backend 테스트 4개 포함). |

→ 결과: backend lint/test baseline 회복.

### 12.2 C2-P0-3 GPU 작업 직렬화 재설계 — **✅ 완료**

- 신규 `backend/studio/_gpu_lock.py`: 단일 `asyncio.Lock` + 30s timeout + `GpuBusyError`.
- 적용 범위: `vision-analyze`, `compare-analyze`, `upgrade-only`, generate/edit/video Ollama 단계, ComfyUI dispatch.
- `_dispatch_to_comfy` 내부에서 GPU gate 획득 후 `force_unload_all_before_comfy()` 실행 → unload/dispatch race 축소.
- `_ollama_client.py` 는 의도대로 동시 도입하지 않음. Phase 1 보강 항목으로 유지.
- 검증: backend ruff clean / pytest 207 passed.

### 12.3 C2-P0-4 ComfyUI mock fallback 설정화 — **✅ 완료**

- `config.py`: `comfy_mock_fallback: bool = False` 추가.
- `_dispatch.py`: `COMFY_MOCK_FALLBACK = settings.comfy_mock_fallback` 로 변경.
- `frontend/components/chrome/AppHeader.tsx`: `NEXT_PUBLIC_USE_MOCK` 활성 시 `MOCK` badge 표시.
- 신규 backend 정책 테스트: `test_dispatch_policy.py` 2건.

### 12.4 C2-P0-1 프론트 활성 테스트 작성 — **✅ 최소 baseline 완료**

- 신규 활성 테스트 3 파일:
  - `frontend/__tests__/api-client.test.ts` — `parseSSE`, `normalizeImageRef`, `normalizeItem`
  - `frontend/__tests__/pipeline-stream.test.ts` — `consumePipelineStream` done/error/incomplete 경로
  - `frontend/__tests__/process-api.test.ts` — process/status snake→camel 매핑
- 결과: `npm test` 8 passed.
- 잔류: hook 4개 직접 테스트는 Phase 1 보강으로 이동.

### 12.5 C2-P0-5 수동 QA 체크리스트 — **✅ 완료**

- 산출: `docs/qa-checklist.md`
- 범위: generate/edit/video/vision/compare 5 시나리오 + regression commands.

---

## 13. 학습 사항 — Linux mount 라인 endings 정책 (사고 후속)

### 13.1 사고 요약

**증상**:
- Linux mount (Cowork sandbox) 에서 `Edit` / `Write` 도구로 `backend/*.py` 파일 수정 시:
  1. CRLF → LF 자동 변환 (8 파일에서 391 insertions/deletions per file = 모든 라인 changed)
  2. 일부 파일 끝부분 truncate (main.py 243→238 / comfy_api_builder.py 982→978)
  3. dispatch_state.py 는 git 이 binary 로 인식 (`Bin 1590 -> 1590 bytes`)

**원인**: Linux mount 가 Windows NTFS 의 CRLF 파일에 쓸 때 라인 endings 정책이 일치하지 않음 + 일부 케이스 truncate 까지.

**복구**: `git restore` 로 원본 복원 가능 (Windows 측에서 실행 필수 — Linux 측 git restore 는 "Operation not permitted" 실패).

### 13.2 영구 정책 (이후 모든 작업에 적용)

| 작업 유형 | 도구 | 정책 |
|-----------|------|------|
| 신규 파일 작성 (`backend/ruff.toml` 같은 config) | `Write` | ✅ Linux 측 OK — 다만 LF 로 작성됨 (TOML/MD/YAML 표준 LF 라 OK) |
| **기존 backend `.py` 파일 수정** | `Edit` | 🚫 **금지** — 라인 endings 변환 + truncate 위험 |
| **ruff `--fix` 같은 자동 수정 도구** | `Bash` | 🚫 **Linux 측 실행 금지** — Windows 측에서만 실행 |
| backend 코드 읽기 | `Read` / `Grep` / `Bash cat` | ✅ Linux 측 OK — 읽기 전용 |
| frontend 파일 수정 | `Edit` / `Write` | ⚠️ 미검증 — backend 와 같은 위험 가능, Windows 측 우선 |
| 마크다운/문서 (`docs/*.md`) | `Edit` / `Write` | ✅ Linux 측 OK — 라인 endings 무관, LF 표준 |
| `git restore` / `git checkout` | `Bash` | 🚫 Linux 측 실행 금지 — Windows 측에서 실행 |

### 13.3 작업 흐름 변경

이전 (사고 전): Claude 가 Linux mount 에서 직접 코드 수정.
이후 (사고 후): **Windows PowerShell/apply_patch 기준으로 수정 + line endings 검사/보정**.

장점:
- 라인 endings 일관성 보장 (backend Python CRLF, frontend LF-only 상태 확인)
- truncate 위험 0
- `git diff --numstat` / line-ending count 로 대량 rewrite 즉시 탐지

단점:
- 작업 속도 약간 느려짐 (수정 후 line endings 검사 추가)
- 한 번에 많은 파일 변경 시 부담 증가 → patch 묶음 단위 잘게 쪼개기

### 13.4 ruff.toml 라인 endings 보정 옵션

내가 만든 `backend/ruff.toml` 이 LF 인 게 backend 다른 파일 (CRLF) 과 비일관:

(a) **간단**: Windows IDE 로 ruff.toml 열어서 CRLF 로 re-save
(b) **정석**: `.gitattributes` 파일 신설 — 파일 종류별 라인 endings 명시
   ```
   *.toml text eol=lf
   *.yaml text eol=lf
   *.yml text eol=lf
   *.md text eol=lf
   *.py text eol=crlf
   *.tsx text eol=lf
   *.ts text eol=lf
   ```
   → TOML/YAML/MD 는 표준 LF + Python 은 현재 프로젝트가 CRLF 라 그대로 + TS/TSX 는 표준 LF.
   → 이 정책 도입하면 Linux mount 에서 만든 LF 파일도 git diff 가 깔끔해짐.

권장: **(b) `.gitattributes` 도입** — Phase 1 P1-2 (inline style 축소) 또는 별도 작업 단위에서 처리. 당장 급하진 않음.

---

## 14. 과거 수동 작업 가이드 (완료됨 · 기록용)

> 2026-04-27 Codex/하루가 Windows 환경에서 Step 1-6 을 완료했다.
> 아래 절차는 Linux mount 사고 당시 복구/수동 적용 가이드로 보존한다.

### Step 1. tests 라인 endings 변환 되돌리기

```powershell
cd D:\AI-Image-Studio
git status -s backend/tests/studio/
# 8 파일 M 표시 확인

git restore backend/tests/studio/
# 가짜 변경 (391 insertions/deletions × 8 파일) 모두 사라짐

git status -s backend/tests/studio/
# 빈 출력이어야 정상
```

### Step 2. Windows 측에서 ruff 자동 fix 다시

```powershell
cd D:\AI-Image-Studio\backend

# ruff 설치 (한 번만 · 이미 있으면 skip)
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pip install ruff

# tests 자동 fix (이번엔 Windows 측이라 CRLF 보존됨)
D:\AI-Image-Studio\.venv\Scripts\python.exe -m ruff check tests/ --fix
# 기대: Found 19 errors (16 fixed, 3 remaining)
# remaining 3건 = E741 → ruff.toml per-file-ignores 로 다음 ruff check tests/ 시 사라짐

D:\AI-Image-Studio\.venv\Scripts\python.exe -m ruff check tests/
# 기대: All checks passed!
```

### Step 3. active 6건 IDE 직접 적용

3 파일 6 위치. Windows IDE (VS Code 등) 에서 직접 수정.

#### 파일 ① — `backend/studio/dispatch_state.py` line 19

```python
# 변경 전:
from typing import Any, TypedDict

# 변경 후:
from typing import TypedDict
```

#### 파일 ② — `backend/main.py` 3 위치 (line 58 + 64 + 66)

```python
# line 58 — 함수 시그니처:
# 변경 전:  def _handler(l: asyncio.AbstractEventLoop, context: dict) -> None:
# 변경 후:  def _handler(inner_loop: asyncio.AbstractEventLoop, context: dict) -> None:

# line 64 — 본문:
# 변경 전:              l.default_exception_handler(context)
# 변경 후:              inner_loop.default_exception_handler(context)

# line 66 — 본문:
# 변경 전:              default_handler(l, context)
# 변경 후:              default_handler(inner_loop, context)
```

#### 파일 ③ — `backend/studio/comfy_api_builder.py` GENERATE (line 322 + 325)

```python
# line 322:
# 변경 전:          (l for l in GENERATE_MODEL.loras if l.role == "lightning"),
# 변경 후:          (lora for lora in GENERATE_MODEL.loras if lora.role == "lightning"),

# line 325:
# 변경 전:      extras = [l for l in GENERATE_MODEL.loras if l.role == "extra"]
# 변경 후:      extras = [lora for lora in GENERATE_MODEL.loras if lora.role == "extra"]
```

#### 파일 ④ — `backend/studio/comfy_api_builder.py` EDIT (line 527 + 530)

```python
# line 527:
# 변경 전:          (l for l in EDIT_MODEL.loras if l.role == "lightning"),
# 변경 후:          (lora for lora in EDIT_MODEL.loras if lora.role == "lightning"),

# line 530:
# 변경 전:      extras = [l for l in EDIT_MODEL.loras if l.role == "extra"]
# 변경 후:      extras = [lora for lora in EDIT_MODEL.loras if lora.role == "extra"]
```

### Step 4. 최종 검증

```powershell
cd D:\AI-Image-Studio\backend

# 1) ruff 0건 확인
D:\AI-Image-Studio\.venv\Scripts\python.exe -m ruff check .
# 기대: All checks passed!

# 2) pytest 회귀 0 확인
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/
# 기대: 203 passed (CLAUDE.md 기준 + 라운드 3 fact-check 일치)
```

### Step 5 (선택). ruff.toml 라인 endings 보정

§13.4 의 (a) 또는 (b) 선택:

(a) Windows IDE 로 `backend/ruff.toml` 열어 CRLF 로 re-save
(b) `.gitattributes` 신설 (라인 endings 정책 통합) — Phase 1 후반부에 같이 처리해도 OK

### Step 6 (선택). git commit 권장 단위

작업 완료 후 commit 단위 분리 권장:

```powershell
# 커밋 1: ruff config 도입
git add backend/ruff.toml
git commit -m "chore(ruff): backend/ruff.toml 신설 — legacy 제외 + tests E741 면제

- Codex 라운드 2 P0-2 + 라운드 3 fact-check 합산
- 분포 26건 = active 6 + tests 19 + legacy 1
- legacy/ 격리 정책 일관 (CLAUDE.md Rules)
- tests/ 의 list comp 변수 \`l\` 면제 (E741)"

# 커밋 2: tests 자동 fix (16건)
git add backend/tests/studio/
git commit -m "chore(ruff): tests F401 unused import 16건 정리

- ruff check tests/ --fix 자동 적용
- E741 3건은 ruff.toml per-file-ignores 로 면제"

# 커밋 3: active 6건 변수명 정정
git add backend/main.py backend/studio/dispatch_state.py backend/studio/comfy_api_builder.py
git commit -m "fix(ruff): active 6건 — E741 변수명 \`l\` → \`lora\`/\`inner_loop\` + F401 제거

- main.py:58 _handler(l) → _handler(inner_loop) (3 위치)
- comfy_api_builder.py 4건 GENERATE/EDIT lora 체인 변수명
- dispatch_state.py:19 typing.Any 미사용 import 제거"
```

---

## 15. Phase 0' 완료 후 다음 단계

Phase 0' 5건은 완료. 다음 라운드는 Phase 1 보강으로 이동.

1. **C2-P1-6 / N2 업로드 제한 상수 단일화** ✅ 완료
   - `storage.STUDIO_MAX_IMAGE_BYTES` 단일 소스.

2. **C2-P1-5 모델 프리셋 parity test**
   - backend presets vs frontend model-presets drift 방지.

3. **Claude A `_ollama_client.py`**
   - GPU gate 안정화 후 별도 단계로 진행. HTTP client 통합과 동시성 제어를 한 patch 에 묶지 않는 원칙 유지.

4. **Frontend hook 테스트 확장**
   - 이번 baseline 은 공통 유틸 중심 8 tests. 다음은 useGenerate/Edit/Video/VisionPipeline 직접 테스트.

5. **UI/컴포넌트 분해**
   - `vision/compare/page.tsx`, `ProgressModal`, `ImageLightbox`, `VisionResultCard` 순서로 검토.
