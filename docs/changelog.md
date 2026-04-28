# Changelog

> 누적 변경 로그 — 완료된 작업의 역사적 기록.
> 최신 변경 + 활성 정책은 `CLAUDE.md` 참조. 자세한 작업 내역은 git log + memory.

## 2026-04-28

### Launcher v2 (start_v2 / stop_v2 + ShutdownBtn + /loading) — 현재 master

**브랜치**: `claude/launcher-v2` → master merge `--no-ff` (`af0a9cf`)
**검증**: pytest 235 / vitest 74 / tsc / lint clean (0 회귀)
**작성**: codex 직접 작성 (이번 세션은 검토 + 분할 commit + master 머지)

#### 동기

옛 `start.bat` 콘솔 1개 + Hidden 흐름은 유지하되, 종료를 좀더 안전하게:
1. PowerShell 단독 종료 스크립트 (단계별)
2. 브라우저 앱 윈도우의 종료 버튼이 백엔드 endpoint 통해 종료 트리거
3. Backend 부팅 전에는 정적 `loading.html`, Backend ready 시 Next.js `/loading` 으로 전환

#### 구조

- **`start_v2.bat` / `start_v2.ps1`** (`c034bdf`)
  - 콘솔 1개만 + Backend/Frontend/Ollama Hidden + ComfyUI headless
  - 브라우저 app window 가 `launcher/loading.html` 부터 띄우고 backend ready 후 `/loading` 으로 전환
  - 로그: `logs/launcher-v2.log` / `logs/{backend,frontend}.{log,err.log}`
- **`stop_v2.ps1`** — ComfyUI/Frontend/Backend 단계별 kill + (옵션) Ollama kill + 브라우저 창 닫기
- **`launcher/loading.html`** — PowerShell 단계 정적 로딩 (Next.js 미가동 구간 대비)
- **Backend `POST /api/studio/system/shutdown`** — localhost only + subprocess 로 `stop_v2.ps1 -KillOllama -CloseBrowser` 실행 (CREATE_NO_WINDOW)
- **Frontend `ShutdownBtn`** (AppHeader) — `NEXT_PUBLIC_ENABLE_LOCAL_SHUTDOWN=true` 일 때만 노출. confirm 모달 → 5단계 진행 (ComfyUI/Ollama/Frontend/Backend/브라우저) → 실패 시 toast + failed phase 유지
- **Frontend `/loading` 페이지** (`89a6f77`) — 부팅 대기 화면 (4 서비스 ready 표시 · 1.2s polling · backend ready 시 `/` redirect · "메인으로/종료" 액션)

#### 안전망

- **Localhost 게이트**: backend 가 client.host 검사로 `127.0.0.1`/`::1`/`localhost` 만 허용
- **환경변수 게이트**: 프런트 종료 버튼은 `ENABLE_LOCAL_SHUTDOWN` 미설정 시 렌더 0
- **subprocess `shell=False`** + 절대경로 + `creationflags=CREATE_NO_WINDOW`

### Edit Multi-Reference 수동 Crop UI (Phase 1-3 MVP)

**브랜치**: `claude/edit-multi-ref` → master merge `--no-ff`
**검증**: pytest 234 (231 → +3) · vitest 74 (61 → +13) · tsc / lint clean
**Codex 리뷰**: 3회 의뢰 (Phase 1/2/3) + 결함 2건 fix

#### 동기

`edit-153d2c13` 검증 결과: gemma4 가 정확한 영문 prompt 를 만들어도 Qwen Edit 가 image2 를 broad reference 로 처리해 의상/배경이 결과에 누수. face geometric crop 도입 (`0d7ff57`) 했다가 얼굴 위치 다양성에 빗나가 제거. 사용자가 *직접* 영역을 자르는 매뉴얼 UI 가 가장 실용적 해결책으로 결정.

#### Phase 1 — UI scaffolding (`16b75eb` + `6f56cc7` + `5754f8c`)

- `react-easy-crop@^5.5.7` 도입 (`next/dynamic({ ssr:false })` 격리)
- `frontend/components/studio/EditReferenceCrop.tsx` 신규 — 인라인 crop UI (모달 X)
  · 자유/1:1/4:3/9:16 비율 lock 토글 (자유 = 이미지 자연 비율 사용 · `onMediaLoaded` 자동 계산)
  · 256px 최소 가드 (미만 시 `onAreaChange(null)` 무효 처리)
  · `bypassCrop` prop 자리만 (라이브러리 plan 진입 시 활성)
  · 외부 dim 0.75 (기본 0.5 → 가독성 ↑)
- `useEditStore.referenceCropArea: CropArea | null` + reset 트리거 3개 자동 적용
  · 새 업로드 / 해제 / multi-ref 토글 OFF
- `EditLeftPanel` 통합 — `key={referenceImage}` 로 새 이미지 시 컴포넌트 local state 강제 reset (Codex 리뷰 결함 #1 fix)
- vitest 신규 6 케이스 (store 단위 + reset 트리거 검증)

#### Phase 2 — 클라이언트 crop → cropped File 전송 (`76f29cf` + `e6ad93a`)

- `frontend/lib/image-crop.ts` 신규 (3 헬퍼)
  · `dataUrlToBlob(dataUrl)` / `cropBlobByArea(blob, area)` (canvas drawImage + toBlob) / `cropBlobIfArea(blob, area | null)` (no-crop path)
- `useEditPipeline` submit 흐름 수정
  · `referenceCropArea` 있으면 `dataUrlToBlob → cropBlobIfArea → new File('reference-crop.png', 'image/png')` → multipart 의 `reference_image` 필드
  · area null 이면 원본 data URL 그대로 (옛 흐름 100% 동일)
  · crop 변환 실패 시 `toast.error` + 진입 차단 (`setRunning` 호출 X)
- `effectiveUseRef = useReferenceImage && !!referenceImage` 단일 게이트 (Codex 리뷰 결함 #3 fix · race 시 백엔드 400 차단)
- vitest 신규 7 케이스 (jsdom canvas 미구현 우회 — `getContext("2d")` mock 으로 fake ctx)

#### Phase 3 — 백엔드 회귀 테스트 (`3a04953` + `87ed7f1`)

- 백엔드 코드 변경 0 — multipart 는 이미 image2 그대로 받고 있음
- `test_multi_ref_edit.py` 에 cropped reference 흐름 회귀 2건 (256x256 + 64x64)
  · 클라이언트 256px 가드 우회한 작은 사이즈도 백엔드는 거부 안 함 (UX/백엔드 책임 분리 신호)
- `test_dispatch_extra_uploads.py` 에 dispatch 까지 도달 회귀 1건 (Codex 리뷰 의심 #2 보강)
  · cropped bytes → `comfy.upload_image` → factory 의 `extra_uploaded_names=["reference-crop.png"]` 정확 전달

#### 알려진 한계 (의도된 trade-off)

- **얼굴 transfer 약함**: Qwen Edit 본질 한계 — manual crop 으로 image2 의 의상/배경 누수는 차단되나 face identity 전송은 약함. 별도 InstantID plan 후보.
- **저장**: cropped Blob 은 영구 저장 X (메모리 → multipart → ComfyUI 임시 input). 영구 저장 + 라이브러리 재선택은 `docs/superpowers/plans/2026-04-27-edit-reference-library.md` 후속 plan 에서 다룸.
- **mediaAspect 깜빡임**: onMediaLoaded 전 1:1 1ms 이내. trade-off 인정 (별도 image preload 비용 대비 효용 낮음).
- **Phase 2 fake canvas false negative**: jsdom 한계로 drawImage 호출 인자만 검증, 실 픽셀은 manual / Playwright 도입 시 보강.

## 2026-04-27

### 진행 모달 통일 + Tier 2/3 (현재 master)

- **AI 프롬프트 보정 우회 토글** (`claude/prompt-skip-toggle`). Generate / Video 좌측 패널 프롬프트 카드 직후 신규 토글 (`🪄 AI 프롬프트 보정` ⇄ `✏️ 프롬프트 직접 사용`). 사용자가 정제된 영문 프롬프트를 복사해 붙여넣은 케이스 — gemma4(+vision) 단계 우회. Generate: 기존 `preUpgradedPrompt` 재사용 (백엔드 변경 0). Video: `VideoRequest.preUpgradedPrompt` 신설 + `pipelines/video.py` 분기 (~15초 절약 · vision/gemma4 둘 다 skip). 의미 반전 + 라벨 동적 패턴 (Lightning 과 통일). 스토어 `useGenerateStore` v5→v6 / `useVideoStore` skipUpgrade 신설. Edit 는 매트릭스 분석 본질이라 보류. pytest 215 / vitest 50 / tsc / lint clean.
- **Harness cleanup** — CLAUDE.md / MEMORY.md / docs/ 정리. 변경 로그 → `docs/changelog.md` (이 파일) 분리. 옛 audit/review 문서 → `docs/archive/`.
- **Tier 3 — OpenAPI 자동 타입 생성** (`ef64d63`). `openapi-typescript ^7.13.0` (devDep) + `backend/scripts/dump_openapi.py` (FastAPI 풀 OpenAPI 3.1 dump) + npm script `gen:types` (chain). `frontend/lib/api/generated.ts` (1,261줄 자동) + `generated-helpers.ts` (Schemas/Paths alias). 시범 마이그레이션 5건 (lib/api/{generate,edit,video,vision,compare}.ts inline cast → `as TaskCreated`). hybrid 정책 — 한글 주석 + narrow union 은 types.ts 손편집 유지.
- **Tier 2 — Phase 6 산출물 단위 테스트** (`d5ee0b0`). vitest 19 → 50 (+31). 신규 3 파일: `stores-stage-history.test.ts` (Vision/VisionCompare store 의 stageHistory) · `api-vision-compare.test.ts` (SSE drain + onStage callback · jsdom Blob 호환 우회) · `pipeline-defs-consistency.test.ts` (5 mode 정적 검증).
- **Phase 6 후속 — 라벨 체계화 + Generate timeline 통일** (`3057c50`). 5 mode 라벨 사용자 친화화 (ComfyUI 샘플링 → "이미지 생성" / "이미지 수정" / "영상 생성") · "비전 분석" → "이미지 분석" 통일 · "워크플로우 전달/구성" → "워크플로우 설정" · `gemma4-upgrade` → "프롬프트 강화" + subLabel `gemma4-un` · `Claude 조사` → "프롬프트 조사" + subLabel `Claude · 최신 팁` · vision-call → vision-analyze (edit/video 와 동일 type) · Generate `postprocess` → `save-output`. 옛 `progress/Timelines.tsx` 제거 (97줄) → 5 mode 모두 PipelineTimeline 단일. Vision/Compare 보조 박스 추가 (Edit/Video 패턴 일관).
- **Phase 6 — Vision/Compare 진행 모달 통일** (`ef536c9`). `/api/studio/vision-analyze` + `/compare-analyze` 동기 JSON → task-based SSE. 신규 `pipelines/{vision_analyze,compare_analyze}.py`. `analyze_image_detailed` / `analyze_pair` / `analyze_pair_generic` 셋 모두 옵셔널 `progress_callback` 추가. `PipelineMode = HistoryMode | "vision" | "compare"` union. PIPELINE_DEFS 에 vision (3 stage) + compare (4 stage) 추가. **gemma4 translation StageDef 에 `enabled: !c.gemma4Off`** — 옵션 B 통일의 진짜 가치 (미래 토글 한 줄 자동 정리). `AnalysisProgressModal.tsx` 삭제 (337줄). pytest 215. mock.patch 위치 갱신 8건.
- **Phase 5 — ComfyUI 자동 기동** (`7c7b9a5`). `_dispatch._ensure_comfyui_ready` 헬퍼. `_dispatch_to_comfy` 의 `acquire_gpu_slot` 직후 호출. ComfyUI 꺼져있으면 stage emit + start. 진행 모달에 "ComfyUI 깨우는 중 (~30초)" warmup row 자동 노출. 프론트 추가 코드 0 (PIPELINE_DEFS 의 enabled: warmupArrived). pytest 210→215.
- **Phase 1-4 — 진행 모달 store 통일** (`be51476`). 3 mode 분리 패턴 → 단일 StageDef 시스템. 신규 `frontend/lib/pipeline-defs.tsx` (PIPELINE_DEFS 진실의 출처) + `progress/{PipelineTimeline,TimelineRow,DetailBox}.tsx`. 백엔드 emit 통일 (step → stage payload 흡수). useEditStore/useVideoStore 의 stepDone/currentStep/stepHistory 제거 → stageHistory + pushStage. PIPELINE_DEFS.video 의 `workflow-build` → `workflow-dispatch` 잠재 버그 fix. interrupt 판정 통일 (`lastStage === "comfyui-sampling"`). 후속 폴리시: `hideVideoPrompts` 신설 + Lightning 토글 라벨 동적 분기.

## 2026-04-26

- **Codex 리뷰 + 퀄리티 리팩토링** (8 commit, `544066f`). Phase 0 P0 안정화 + 분해 + SSE 추상화 + frontend/legacy quarantine. pytest 197→201. 신규 모듈 6개: backend (`types.py`, `tasks.py`, `schemas.py`, `storage.py`) + frontend (`hooks/usePipelineStream.ts` + `components/studio/generate/*` 4 파일). frontend/legacy/ 39파일 quarantine.
- **router.py 풀 분해 + legacy quarantine** (3 commit `0c4b999`). `backend/studio/router.py` 1,769 → **118줄 (facade only · -93%)**. `studio/{routes,pipelines}/` 분리 (12 신규 파일 · 2,005줄). 옛 5 라우터 + 5 services + 4 tests + conftest = 15 파일 `backend/legacy/` 격리. **신규 정책**: mock.patch 위치 = lookup 모듈 기준. **잠재 NameError fix 1건**: 옛 router.py 1213줄의 `getattr(settings, ...)` 가 `settings` import 없이 참조 → pipelines/video.py 명시 import.
- **edit/video page 풀 분해** (`ac1b7db`). edit/page.tsx 646→170 (-74%) · video/page.tsx 591→87 (-85%). Generate 패턴 복제. 신규 컴포넌트 5개. vitest exclude `legacy/**` 추가.
- **spec 19 — 시스템 프롬프트 통합 + Ollama race fix** (4 라운드, `2c8b024`). pytest 166→197. 신규 모듈 3개: `_json_utils.py` (parse_strict_json) · `ollama_unload.py` · `CompareExtraBoxes.tsx`. 라운드 1: SYSTEM_COMPARE v3.1 + person background 흡수 + format=json. 라운드 2: parse_strict_json quoted-string aware + DB v6 refined_intent 캐싱. 라운드 3: SYSTEM_EDIT/VIDEO/GENERATE adaptive + Claude CLI 격리. 라운드 4 (CRITICAL): vision_pipeline / video_pipeline 안에서 단계별 Ollama unload (qwen2.5vl + gemma4 동시 점유 → swap → ComfyUI sampling 3분+ → 30~60초로 정상화).
- **VRAM Breakdown 오버레이** (`63ae160`). 헤더 80% 임계 시 ComfyUI/Ollama 점유 + 모델 정보 오버레이. **Windows nvidia-smi 권한 정책 폴백** (CRITICAL): `used_gpu_memory` 컬럼이 일반 사용자 권한 [N/A] → `total - ollama - other = ComfyUI` 추정. 막대 시각 개편 (collapsed 22→44px / 위험 그라데이션). CPU 색상 빨강 → 시안.
- **Codex 3가지 미세 fix**. `_coerce_score` 문자열 방어 (CRITICAL · 옛엔 종합 0% 버그) · keep_alive 타입 통일 (str "0") · transform_prompt 트리거 조건 명확화 ("ALL 5 axes >= 95").
- **Compare v2.2 + Ollama keep_alive=0** (Codex+Claude 공동 spec). 점수 calibration rubric 5단계 + Subject 하드 캡 (recreation fidelity 보호) + transform_prompt + uncertain 슬롯 + format=json + SYSTEM 200→80줄 단축. **CRITICAL VRAM 정책**: 모든 Ollama `/api/chat` 호출에 `"keep_alive": "0"` 추가 (7 호출). 응답 직후 모델 unload, VRAM 즉시 반납.
- **Chrome 통합 + Vision Recipe v2.1**. AppHeader (라우트 자동 분기) + SystemMetrics (CPU/GPU/VRAM/RAM 4-bar · macOS 색상 매핑) + SystemStatusChip (ComfyUI 가동 표시) + 메인 카피라이트 풋터. Backend `system_metrics.py` 신설 (psutil + nvidia-smi). `/process/status` 응답 v2 (`vram_used_gb`, `system.cpu_percent` 등). ComfyUI timeout 확장 (idle 600→1200s, hard 1800→7200s · 16GB VRAM swap 안전망). Vision Recipe v2.1: SYSTEM_VISION_RECIPE_V2 (9 슬롯 STRICT JSON · Codex+Claude 공동) + width/height 주입 + POSITIVE self-containment + multi-subject 핸들링 + 광역 race 라벨. 히스토리 가로 흐름 (height-aware Masonry · greedy).

## 2026-04-25

- **Edit 한 사이클 완성 (spec 14-17)** (`91348bb`). Edit 모드 5단계가 도메인 슬롯 매트릭스 패러다임으로 통합. `analyze_edit_source` v2 (인물/물체·풍경 5 슬롯) + `clarify_edit_intent` (gemma4 정제) + `SYSTEM_EDIT` STRICT MATRIX DIRECTIVES + spec 17 preserve 누출 차단 + `analyze_pair` v3 (도메인 분기 + 의도 컨텍스트 점수). 신규 `EditVisionBlock` 매트릭스 행 UI 공용 컴포넌트. DB 스키마 무변경 (옛 row 자동 폴백). 후속 폴리시: 진행 모달 prompt 토글 분리 (생성/수정) · Generate Lightning 8/1.5 튜닝 (블러 개선).
- **Headless Launcher (창 0개) + 가동 fix 5건**. start.bat 콘솔 1개만 + Backend/Frontend/Ollama Hidden + ComfyUI Headless Python 직접 호출 (Electron GUI 없음). 5 fix: lifespan ComfyUI 비차단 / Wait-ForPort / stdout redirect / `--base-directory` / globals.css `@import` 순서.
- **UI Polish + Generate LoRA 시스템**. 메인 헤딩 "AI Image Studio" + 메뉴 6장 동일 인물 시리즈. MenuCard 아이콘/tag 제거. /generate 좌측 패널 재구성 (Lightning 단독 + SizeCard 분리). StylePreset 인프라 신설 (활성 0 · 시도 #1 보류). Extra LoRA 교체: FemNude → female-body-beauty_qwen.
- **클립보드 Paste + Compare hybrid fallback**. 전역 Ctrl+V 로 스크린샷 업로드. Compare 페이지 호버 슬롯 우선 + 페이지 fallback (A 비면 A · B 비면 B).

## 2026-04-24

- **메뉴 UX v2 통일** (`207ae77`, 11 commit). 4 페이지 결과/히스토리/레이아웃 일괄 통일. 공용 컴포넌트 6개 신설 (HistoryGallery / SectionHeader / HistorySectionHeader / ResultHoverActionBar / ResultInfoModal / BeforeAfterSlider). DB 스키마 v5 (adult/duration_sec/fps/frame_count). Generate 입력 UX: Step/CFG/Seed UI 제거 (백엔드 자동 + seed 매번 랜덤).
- **Edit 비교 분석** (`45b6e2e`, 19 commit). qwen2.5vl 5축 평가 + 영구 저장 + UI 통합 + BeforeAfter 일관성 규칙.
- **UI Consistency Audit (P0+P1+R1+R2+R3)**. 디자인 시스템 중추 완성. 토큰 6단계 (`--radius-sm/md/card/lg/xl/full`) + 기능 토큰 3개. 공용 shell 5개 (StudioResultHeader/Card/Empty/Loading/UploadSlot). radius 하드코딩 76건 토큰화. edit-source + result 파일 orphan cleanup (path traversal 4-layer 방어).
- **Vision Compare 메뉴 신설** (`/vision/compare`). Edit 무영향 백엔드 격리 (analyze_pair_generic). 메인 메뉴 3카테고리 6카드 그리드.
- **LTX Video 2.3 추가** (`027817d`). 성인 모드 + 해상도 슬라이더 + Lightning 토글. 얼굴 drift 미해결 보류.
- **Codex 교차리뷰 fix 머지**. video mode 필터 4-layer 통일 · SSE lifecycle 정리 · 3 훅 finally 보강 · HistoryBootstrap 재시도 · HistoryTile 옵티미스틱 롤백.

## 2026-04-22

- **전면 재설계 완료** (Phase 1+2 merged, `5ff36bf`). 신규 구조 `backend/studio/` + `frontend/components/studio/` + 4 route pages. 레거시 코드 (`backend/services/*`, `frontend/components/{Creation,History,Settings}Panel.tsx`) 보존만 — 직접 수정 금지.

## 그 이전 — Phase 1 + Phase F + 기타

- 초기 개발 단계 (Phase A-E) → Phase F 리팩토링 (22건 리뷰) → Phase F+ 픽스 (회귀 8건) → 재설계 직전. 자세한 내역은 memory archive 참조.
