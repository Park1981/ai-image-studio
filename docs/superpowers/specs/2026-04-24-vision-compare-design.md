# Vision Compare — 임의 두 이미지 비교 분석 메뉴 설계 (Spec)

**작성일**: 2026-04-24
**상태**: 구현 완료
**작성자**: Opus 4.7 (사용자 공동 기획)
**세션 참고**: 메뉴 UX v2 통일 후 (HEAD `207ae77`) 기반 신규 메뉴 추가

## 1. 배경 & 목적

기존 /edit 의 "비교 분석" 은 **Edit 결과 vs 원본** 자동 평가에 한정됨 (5축 = face_id/body_pose/attire/background/intent_fidelity). 사용자가 **임의로 고른 두 이미지** 를 직접 비교하고 싶을 때 활용할 수 없음.

→ 메인 메뉴에 "비전 비교" 를 독립 메뉴로 신설. 비전 카테고리를 (분석 / 비교) 2개 메뉴로 확장.

### 유스케이스
- 두 인물 사진 비교 (동일 인물 여부 · 자세 · 표정 변화)
- 동일 장면 다른 시간/조명 비교
- 생성 결과끼리 비교 (다른 시드/모델 결과의 스타일 차이)

### 비목표 (YAGNI)
- 히스토리 (페이지 떠나면 결과 휘발 · DB 저장 X)
- 3장 이상 동시 비교
- 생성/편집 페이지로 결과 자동 라우팅
- 프롬프트 추출 (그건 /vision 메뉴의 역할)

## 2. 결정 사항 요약

| 항목 | 결정 |
|------|------|
| 라우트 | `/vision/compare` 신설 (메인 메뉴 비전 카테고리 2번째 카드) |
| 5축 | composition / color / subject / mood / quality (구성·색감·피사체·분위기·품질) |
| 백엔드 격리 | 신규 `analyze_pair_generic()` + `SYSTEM_COMPARE_GENERIC` · Edit 의 `analyze_pair()` 코드 경로 100% 무영향 |
| context 분기 | `/api/studio/compare-analyze` 의 `meta.context` (기본 "edit" · 미전송 시 기존 동작 보존) |
| 비교 지시 | 좌측 패널 textarea (선택 입력 · 시스템 프롬프트에 주입) |
| 비전 모델 | `useSettingsStore.visionModel` 공용 (페이지 내 노출 X · 설정 드로어에서 변경) |
| 히스토리 | 완전 휘발 (Zustand store · persist X · DB 저장 X) |
| A↔B 스왑 | 좌측 패널 중앙 스왑 버튼 (자리만 바꾸면 분석 결과 초기화) |
| 뷰어 모드 | 토글 `↔ 슬라이더` / `◫ 나란히` (비율 10% 이상 다르면 슬라이더 비추천 배지) |

## 3. 아키텍처

### 3.1 서버-클라이언트 구조

```
┌─────────── Frontend ───────────┐   ┌──────────── Backend ────────────┐
│  app/page.tsx (메뉴 활성화)     │──▶│  studio/router.py               │
│  app/vision/compare/page.tsx   │   │  POST /api/studio/compare-analyze│
│   (신규 · 통합 페이지)          │   │   meta.context="compare"        │
│                                │   │     → analyze_pair_generic()     │
│  stores/useVisionCompareStore  │   │   meta.context 미전송 / "edit"   │
│   (신규 · persist X 휘발)       │   │     → analyze_pair() (기존 그대로)│
│                                │   │                                  │
│  lib/api/compare.ts            │   │  studio/comparison_pipeline.py  │
│   (context, compareHint 옵션)  │   │   ├ SYSTEM_COMPARE (edit · 보존)│
│                                │   │   ├ SYSTEM_COMPARE_GENERIC (신) │
│  components/studio/            │   │   ├ AXES (edit · 보존)          │
│   BeforeAfterSlider            │   │   ├ COMPARE_AXES (신)           │
│   (afterSrc 옵션 추가)          │   │   ├ analyze_pair() (기존 그대로)│
│                                │   │   └ analyze_pair_generic() (신) │
└────────────────────────────────┘   └──────────────────────────────────┘
```

### 3.2 Edit 무영향 보장 메커니즘

1. **시스템 프롬프트 분리**: `SYSTEM_COMPARE` 는 손대지 않음. 새로운 `SYSTEM_COMPARE_GENERIC` 추가만.
2. **5축 키 분리**: `AXES` 는 손대지 않음. 새로운 `COMPARE_AXES` 추가만.
3. **함수 분리**: `analyze_pair()` 는 손대지 않음. 새로운 `analyze_pair_generic()` 추가만.
4. **헬퍼 axes 파라미터**: `_empty_scores`, `_empty_comments`, `_coerce_scores`, `_coerce_comments`, `_translate_comments_to_ko` 는 `axes: tuple[str, ...] = AXES` 기본값으로 추가 — Edit 호출자가 axes 인자 미전달 → AXES 기본값 사용 → 기존 동작 100% 동일.
5. **라우트 분기**: `compare_analyze` 엔드포인트가 `meta.context` 가 없거나 "edit" 일 때만 `analyze_pair()` 호출 (기존 코드 경로 100% 동일).
6. **테스트 검증**: 기존 21개 comparison_pipeline 테스트 + 91개 전체 백엔드 테스트 모두 통과.

## 4. 데이터 모델

### 4.1 VisionCompareScores / VisionCompareComments / VisionCompareAnalysis (`lib/api/types.ts`)
- ComparisonScores 의 5축과 별도로 새 5축 인터페이스 신설.
- `composition / color / subject / mood / quality` 각 `number | null`.

### 4.2 useVisionCompareStore (`stores/useVisionCompareStore.ts`)
- imageA / imageB: `VisionCompareImage` (dataUrl + label + width + height)
- hint: string
- running: boolean
- analysis: `VisionCompareAnalysis | null`
- viewerMode: `"slider" | "sidebyside"`
- actions: setImageA / setImageB / swapImages / setHint / setRunning / setAnalysis / setViewerMode / reset
- **persist X · DB 저장 X · 페이지 떠나면 모두 사라짐** (Q3 = A 결정)

## 5. UI 레이아웃 (`/vision/compare`)

```
┌ TopBar (BackBtn + Logo · VRAM + Settings) ──────────────────────────┐
├─ 400px 좌 패널 ─────────┬─ 1fr 우 패널 ─────────────────────────────┤
│ ┌ Vision Compare title ┐│ ┌ 뷰어 (62%) ──────────────────────────┐ │
│ │ 두 이미지 5축 비교    ││ │ [↔ 슬라이더][◫ 나란히] 토글         │ │
│ └─────────────────────┘ ││ │   슬라이더: BeforeAfterSlider 재사용 │ │
│                         ││ │   나란히: 1:1 grid · A·B 풀폭         │ │
│ [이미지 A 슬롯]          ││ │   비율 10% 이상 다르면 슬라이더 경고  │ │
│  업로드 / 미리보기      ││ │   비어있으면 EmptyViewer (안내)      │ │
│  변경 · 해제 액션        ││ └────────────────────────────────────┘ │
│                         ││                                          │
│ [↕ A↔B 자리 바꾸기]     ││ ┌ 분석 결과 (38%) ─────────────────────┐ │
│                         ││ │ 5축 막대 + 코멘트 (구성/색감/...)     │ │
│ [이미지 B 슬롯]          ││ │ 80%↑ 초록, 60%↑ 앰버, 미만 회색       │ │
│                         ││ │ Summary 카드 (한국어 총평)            │ │
│ 비교 지시 (선택):        ││ │ Loading: spinner + 안내                │ │
│ [textarea placeholder]  ││ │ Empty: 안내 메시지                     │ │
│                         ││ │ Fallback: amber 박스 + 사유            │ │
│ [비교 분석 시작 sticky] ││ └────────────────────────────────────┘ │
└─────────────────────────┴───────────────────────────────────────────┘
```

## 6. 변경 파일 목록

### 백엔드 (2 파일)
- **수정** `backend/studio/comparison_pipeline.py` — `COMPARE_AXES`, `SYSTEM_COMPARE_GENERIC`, `_call_vision_pair_generic()`, `analyze_pair_generic()` 추가 + 헬퍼 5개에 `axes` 파라미터 추가 (기본 AXES)
- **수정** `backend/studio/router.py` — `compare_analyze` 에 `meta.context` 분기 추가 + `analyze_pair_generic` import

### 프론트엔드 (7 파일)
- **신규** `frontend/app/vision/compare/page.tsx` — 페이지 메인 (~700 lines)
- **신규** `frontend/stores/useVisionCompareStore.ts` — 휘발 store
- **수정** `frontend/lib/api/types.ts` — `VisionCompare*` 3 타입 추가
- **수정** `frontend/lib/api/compare.ts` — `context`, `compareHint` 옵션 추가 + Mock 분기 + 응답 union 타입
- **수정** `frontend/lib/api-client.ts` — barrel 에 `VisionCompare*` re-export
- **수정** `frontend/hooks/useComparisonAnalysis.ts` — Edit 호출자에서 union 타입 narrow (`as ComparisonAnalysis`)
- **수정** `frontend/components/studio/BeforeAfterSlider.tsx` — `afterSrc?` + `beforeLabel` + `afterLabel` 옵션 추가 (Edit 호출자 미전달 → 기존 동작)
- **수정** `frontend/app/page.tsx` — 비전 비교 카드 활성화 (disabled 제거 · `tag="NEW"` · onClick 라우팅)

## 7. 검증

- 백엔드: `pytest tests/studio/` — 91/91 통과 (Edit 코드 경로 무영향 확인)
- 프론트엔드: `npm run lint` — 신규/수정 파일 0 error 0 warning (5 pre-existing errors 는 모두 레거시 `components/Settings*`, `components/creation/*` 폴더 · CLAUDE.md "수정 금지" 표시)
- 프론트엔드: `npx tsc --noEmit` — 0 error

## 8. 한계 & 후속 과제

- 비교 결과 휘발 — 좋은 분석 결과를 다시 보고 싶으면 재분석 (5~10초). 추후 옵션: localStorage 캐시 (최근 5건) 또는 통합 히스토리 페이지.
- 동시 다중 비교 미지원 — `_COMPARE_LOCK` 으로 직렬화. ComfyUI 와 충돌 회피 목적.
- 두 이미지 동시 업로드 후 자동 분석 미실행 — 명시 CTA 클릭 필요 (의도 · 실수 분석 방지).
- 슬라이더 모드에서 비율 다른 두 이미지는 contain 으로 letterboxed 됨 (왜곡 X 이지만 여백 발생). 사용자가 토글로 나란히로 전환 가능.
