# 디자인 시안 — 좌측 패널 V5 Aurora Glass

> 좌측 패널 5 메뉴 (생성 / 수정 / 분석 / 비교 / 영상) 통합 리디자인 시안.
> **2026-05-01 작업 · 오빠 결정 대기 (확정 시 React 적용)**

## 파일

| 파일 | 용도 |
|---|---|
| [`cards-v1.html`](cards-v1.html) | 옛 시안 (V1 Refined / V2 Signature / V3 Aurora) — 비교 reference |
| [`cards-v2.html`](cards-v2.html) | **최종 시안** — V5 톤 5 패널 풀 시안 |
| [`resize_cards.py`](resize_cards.py) | 이미지 자동화 (PIL · @1x/@2x WebP) |
| `assets/card-bg-*.webp` | 7 인물 이미지 (1024×576 + @2x) |
| `assets/raw/` | 원본 PNG 백업 |

## 보기

cards-v2.html 더블클릭 (서버 X · 인터넷 연결 필요 — 폰트 CDN).

## V5 핵심 결정

### 톤
**Aurora Glass** — frosted glass (`backdrop-filter: blur(12px) saturate(160%)`) + 카드 전체 클릭 + hover 검정 pill 툴팁 + 시그니처 컬러 + K-pop 인물 fade.

### 시그니처 6 컬러

```css
violet → blue   (#8B5CF6 → #3B82F6)  /* AI 보정 */
amber → orange  (#F59E0B → #FB923C)  /* Claude 조사 / 결과 자동 평가 (페어) */
lime → cyan     (#84CC16 → #06B6D4)  /* 퀄리티 모드 */
rose → pink     (#F43F5E → #EC4899)  /* 사이즈 / 추가 참조 / 영상 해상도 (트리오) */
crimson → red   (#DC2626 → #F87171)  /* 성인 모드 */
```

### 라벨 이모지

```
🪄 AI 프롬프트 보정
🔍 Claude 프롬프트 조사
📊 결과 자동 평가
💎 퀄리티 모드
🖼️ 추가 참조 이미지
🔞 성인 모드
```

### 카드 패턴

- 카드 전체 클릭 = ON/OFF 토글 (토글 스위치 *제거*)
- desc 텍스트 *제거* + hover 검정 pill 툴팁 (data-tooltip)
- 비활성 segmented `display: none` (활성 시에만)
- 비활성 이미지 `opacity 0.28 · saturate 0.4` (희미)
- 활성 텍스트 `ink + 600` 굵기
- segmented 반투명 (`rgba 0.7 + backdrop-blur 8px`)

### CTA 위치 (시안 결정)

**5 패널 모두 상단 sticky** 통일 (시안 일관성 우선).

> ⚠️ 실제 코드는 *생성/수정/영상 = 상단* / *분석/비교 = 하단*. React 적용 시 결정.

## 5 패널 구조

```
docs/design-test/cards-v2.html
└── main.grid (auto-fit · 460px)
    ├── 1. 생성 (Generate)        — V5 핵심 시안 final fix
    ├── 2. 수정 (Edit)            — 실제 EditLeftPanel.tsx 100% 매칭
    ├── 3. 분석 (Vision Analyze)  — 간소 (이미지 + CTA + 안내)
    ├── 4. 비교 (Vision Compare)  — A/B 슬롯 + 스왑 + 비교지시
    └── 5. 영상 (Video Generate)  — LTX-2.3 i2v · 영상 해상도 sub-section 통합
```

### 수정 패널 특이

- AI 보정 = **Edit 필수** (disabled checked · segmented 항상 노출)
- 자동 평가 = Claude 와 같은 amber 시그니처 (분석 도구 페어)
- 참조 ON 시 → **카드 외부 별도 sub-section**: 비율 chip 4 + 320px Cropper + zoom + 도움말 + 역할 chip 5

### 영상 패널 특이

- 영상 해상도 = `.size-card-v` 패턴 재사용 (사이즈 카드와 페어 · 핑크)
- 성인 모드 = 새 crimson 시그니처 (6번째 색)

## 이미지 7장

ChatGPT image 2.0 으로 *Vogue Korea* 톤 K-pop 인물 (16:9 · rule of thirds 우측 1/3 · 3/4 측면 looking away).

| 카드 | 톤 / 모티브 |
|---|---|
| AI 보정 | violet · 마법 / 별 입자 |
| Claude 조사 | amber · 골든아워 |
| 퀄리티 모드 | cyan/teal · 홀로그램 의상 |
| 사이즈 | pink · architect 포즈 |
| 추가 참조 | pink · curator (패브릭 swatch) |
| 자동 평가 (옛) | teal/emerald · 안경 — *시그니처 amber 변경됨* / 임시 Claude 이미지 재사용 |
| 성인 모드 | crimson · 검정 silk slip + sultry editorial |

## 자동화

```bash
# 새 이미지 추가
# 1. raw/ 에 ChatGPT png 드롭
# 2. resize_cards.py 의 MAPPING 갱신
# 3. python 실행
D:/AI-Image-Studio/.venv/Scripts/python.exe docs/design-test/resize_cards.py
```

매핑 형식:
```python
"ChatGPT Image 2026년 5월 1일 오후 NN_NN_NN.png": "role-name",
```

## React 적용 가이드 (확정 후)

### 변경 위치

```
frontend/app/globals.css                        # V5 토큰 + 새 클래스
frontend/public/studio/cards/                   # 7 webp 복사 (또는 components/studio/_cards-bg/)
frontend/components/ui/primitives.tsx           # Toggle: flat + tooltip + cardImage props
frontend/components/studio/generate/GenerateLeftPanel.tsx
frontend/components/studio/edit/EditLeftPanel.tsx
frontend/components/studio/video/VideoLeftPanel.tsx
frontend/components/studio/compare/CompareLeftPanel.tsx
frontend/app/vision/page.tsx
frontend/components/studio/generate/SizeCard.tsx       # className 정리
```

### 추정 시간

- Phase 1 (5 패널 React 적용): 6-8 시간
- Phase 2 (새 amber evaluator 이미지): 선택
- Phase 3 (AI/Claude 통합 — 별도 cycle): 후속 plan

## 후속 plan 후보

1. **AI 보정 + Claude 조사 통합** (4-way segmented: off/instant/thinking/claude) — UX 단순화 (4 → 3 카드)
2. **새 amber evaluator 이미지** (자동 평가 카드 — Claude 와 다른 인물)

---

상세: [memory/project_session_2026_05_01_design_v5_5panels.md](../../../../../Users/pzen/.claude/projects/d--AI-Image-Studio/memory/project_session_2026_05_01_design_v5_5panels.md)
