# 📋 진행 모달 표시 항목 풀 정리

**작성일**: 2026-04-27 (Phase 6 통일 + 라벨 체계화 후)
**소스**: `frontend/lib/pipeline-defs.tsx` · `frontend/components/studio/ProgressModal.tsx`
**목적**: 5 mode (Generate / Edit / Video / Vision / Compare) 진행 모달의 모든 표시 항목 + 문구를 한 곳에 모아 검토·개선 작업의 baseline 으로 사용.

---

## 🎬 공통 구조 (5 mode 모두 동일 layout)

```
┌──────────────────────────────────────────────────┐
│ 🔄 [모달 헤더]                  [ComfyUI 중단] [×] │  ← Header
├──────────────────────────────────────────────────┤
│ 🕐 mm:ss     ⚙️ 스텝 N/M                    42% │  ← StatusBar
├──────────────────────────────────────────────────┤
│  ① ▢ 단계 라벨            subLabel    elapsed     │
│  ② ▢ 단계 라벨            subLabel    elapsed     │
│        ┌─ 보조 박스 (renderDetail) ─┐              │  ← Body (PipelineTimeline)
│        │ ...                        │              │
│        └────────────────────────────┘              │
│  ③ ▢ ...                                          │
└──────────────────────────────────────────────────┘
```

### 모달 헤더 (`MODE_TITLES`)

| 모드 | 헤더 타이틀 |
|------|------------|
| generate | **이미지 생성 중** |
| edit | **이미지 수정 중** |
| video | **영상 생성 중** |
| vision | **비전 분석 중** |
| compare | **비교 분석 중** |

오른쪽:
- **`ComfyUI 중단`** 버튼 — 빨강 톤. 조건: `running && lastStage === "comfyui-sampling"` 일 때만 노출. vision/compare 는 ComfyUI 미사용이라 항상 X.
  - 툴팁: "ComfyUI 샘플링 중단"
  - aria-label: "ComfyUI 샘플링 중단"
- **`×`** 닫기 버튼 (모달만 닫음 · 작업은 백그라운드 계속)
  - 툴팁: "모달 닫기 (생성은 계속됨)"
  - aria-label: "닫기"

### StatusBar (헤더 바로 아래 한 줄)

| 위치 | 표시 | 비고 |
|------|------|------|
| 좌측 chip 1 | 🕐 `mm:ss` | 총 경과 시간 (500ms tick · 툴팁 "총 경과 시간") |
| 좌측 chip 2 | ⚙️ `스텝 N/M` | ComfyUI 샘플링 진행 (vision/compare 는 항상 숨김 · 툴팁 "ComfyUI 샘플러 진행 스텝") |
| 우측 | `42%` | 전체 파이프라인 % (accent 색 · mono · letter-spacing 0.04em) |

---

## 🟢 Generate (생성 · 7 stage 정의 · research/warmup 조건부)

| # | type | label (메인) | subLabel (보조) | enabled 조건 |
|---|------|-------------|----------------|-------------|
| 1 | `prompt-parse` | **프롬프트 해석** | — | 항상 |
| 2 | `claude-research` | **프롬프트 조사** | `Claude · 최신 팁` | research 토글 ON 시만 |
| 3 | `gemma4-upgrade` | **프롬프트 강화** | `gemma4-un` | 항상 |
| 4 | `workflow-dispatch` | **워크플로우 설정** | — | 항상 |
| 5 | `comfyui-warmup` | **ComfyUI 깨우는 중** | `최대 30초` | ComfyUI 자동기동 시만 (Phase 5) |
| 6 | `comfyui-sampling` | **이미지 생성** | `qwen-image-2512` | 항상 |
| 7 | `save-output` | **결과 저장** | — | 항상 |

---

## 🔵 Edit (수정 · 6 stage)

| # | type | label | subLabel | enabled | 보조 박스 (renderDetail) |
|---|------|-------|---------|---------|------------------------|
| 1 | `vision-analyze` | **이미지 분석** | `qwen2.5vl:7b` | 항상 | ① 슬롯 매트릭스 chip (`editVisionAnalysis` 있을 때) ② "비전 설명" 단락 (`description` 있을 때) — 단, **Settings "Edit 프롬프트 숨김" ON 시 둘 다 안 그림** |
| 2 | `comfyui-warmup` | **ComfyUI 깨우는 중** | `최대 30초` | 자동기동 시만 | — |
| 3 | `prompt-merge` | **프롬프트 통합** | `gemma4-un` | 항상 | ① "최종 프롬프트 (ollama\|fallback)" 박스 ② "한국어 번역" 박스 — Settings 토글 ON 시 안 그림 |
| 4 | `param-extract` | **사이즈/스타일 추출** | `auto` | 항상 | — |
| 5 | `comfyui-sampling` | **이미지 수정** | `qwen-image-edit-2511` | 항상 | — |
| 6 | `save-output` | **결과 저장** | — | 항상 | — |

---

## 🟣 Video (영상 · 6 stage)

| # | type | label | subLabel | enabled | 보조 박스 |
|---|------|-------|---------|---------|----------|
| 1 | `vision-analyze` | **이미지 분석** | `qwen2.5vl:7b` | 항상 | "비전 설명" 단락 (Settings "영상 프롬프트 숨김" ON 시 안 그림) |
| 2 | `comfyui-warmup` | **ComfyUI 깨우는 중** | `최대 30초` | 자동기동 시만 | — |
| 3 | `prompt-merge` | **프롬프트 통합** | `gemma4-un` | 항상 | "LTX 프롬프트 (provider)" + "한국어 번역" (토글 영향) |
| 4 | `workflow-dispatch` | **워크플로우 설정** | `LTX i2v builder` | 항상 | — |
| 5 | `comfyui-sampling` | **영상 생성** | `ltx-2.3-22b-fp8` | 항상 | — |
| 6 | `save-output` | **MP4 저장** | `h264 인코딩` | 항상 | — |

---

## 🔍 Vision (이미지 분석 · 3 stage · Phase 6 신규)

| # | type | label | subLabel | enabled | 보조 박스 |
|---|------|-------|---------|---------|----------|
| 1 | `vision-encoding` | **이미지 인코딩** | `browser` | 항상 | — |
| 2 | `vision-analyze` | **이미지 분석** | `qwen2.5vl:7b` | 항상 | "분석 요약 (provider)" 박스 |
| 3 | `translation` | **한국어 번역** | `gemma4-un` | gemma4 토글 ON 일 때만 | "한국어 요약" 박스 |

---

## 🔄 Compare (비교 분석 · 4 stage · Edit 비교 + Vision Compare 공용 · Phase 6 신규)

| # | type | label | subLabel | enabled | 보조 박스 |
|---|------|-------|---------|---------|----------|
| 1 | `compare-encoding` | **이미지 A/B 인코딩** | `browser` | 항상 | — |
| 2 | `intent-refine` | **수정 의도 정제** | `gemma4-un` | Edit 컨텍스트 + 캐시 미스 시만 (Vision Compare 메뉴는 항상 안 보임) | — |
| 3 | `vision-pair` | **이미지 비교 분석** | `qwen2.5vl:7b` | 항상 | "비교 요약 · 종합 N% (provider)" 박스 |
| 4 | `translation` | **한국어 번역** | `gemma4-un` | gemma4 토글 ON 일 때만 | "한국어 요약" 박스 |

---

## 🎨 보조 박스 종류 (`DetailBox kind`)

stage row 아래 들여쓰기 (`marginLeft: 34`) 로 표시되는 박스. 3 종류:

| kind | 색상 | 용도 |
|------|------|------|
| `info` | accent (파랑 톤) | 일반 정보 — `ollama` provider 결과 |
| `warn` | amber (주황 톤) | provider=`fallback` 일 때 (gemma4 호출 실패 → SYSTEM 만 적용된 결과) |
| `muted` | 회색 톤 | 한국어 번역 부속 정보 |

## 📊 stage row 의 시각 상태

각 row 는 **3 상태** 중 하나:

| 상태 | 시각 | 트리거 |
|------|------|--------|
| **pending** | 회색 동그라미 + 숫자 | 미도착 stage |
| **running** | accent 색 spinner | 현재 진행 중 (도착 직후 + 다음 stage 도착 전) |
| **done** | 녹색 체크 (✓) | 다음 stage 도착했거나 done event 와서 종료 |

오른쪽에 `elapsed` (다음 stage 도착 - 본인 도착) 가 mono `1.5s` 식으로 표시. 마지막 stage 는 elapsed 없음.

## 🔧 Settings 영향 토글 (현재)

| Settings 토글 | 영향 mode | 영향 row |
|--------------|----------|---------|
| **생성 프롬프트 숨김** (`hideGeneratePrompts`) | generate | 현재 Generate timeline 의 detail 박스 (옛 GenerateTimeline 안에서 분기) |
| **수정 프롬프트 숨김** (`hideEditPrompts`) | edit | `vision-analyze` chip + `prompt-merge` 보조 박스 |
| **영상 프롬프트 숨김** (`hideVideoPrompts`) | video | `vision-analyze` 비전 설명 + `prompt-merge` 보조 박스 |

> 모두 **기본값 ON (숨김)** — 사용자 설정에서 OFF 로 바꿔야 보임.

---

## 💡 라벨 체계화 (2026-04-27 적용 후 상태)

| 항목 | 상태 |
|------|------|
| Generate timeline 통일 | ✅ PipelineTimeline 단일 컴포넌트 사용 (옛 GenerateTimeline 제거) |
| Compare/Vision 보조 박스 | ✅ Edit/Video 패턴 일관 — 분석 요약 / 한국어 요약 박스 추가 |
| 5 mode 라벨 일관 | ✅ "이미지 분석" / "프롬프트 통합" / "워크플로우 설정" / "이미지 생성·수정·영상 생성" 통일 |
| gemma4 토글 | 인프라만 있음 — UI 미구현 (사용자 직접 결정) |
| ComfyUI 자동 기동 | ✅ Phase 5 적용 완료 — ComfyUI 꺼져있는 상태에서만 row 표시 |
