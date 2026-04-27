# Changelog

> 누적 변경 로그 — 완료된 작업의 역사적 기록.
> 최신 변경 + 활성 정책은 `CLAUDE.md` 참조. 자세한 작업 내역은 git log + memory.

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
