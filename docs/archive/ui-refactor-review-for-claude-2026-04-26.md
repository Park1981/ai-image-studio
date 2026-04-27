# UI Refactor Review for Claude

작성일: 2026-04-26  
대상: `frontend/app`, `frontend/components/chrome`, `frontend/components/studio`  
관점: 프로젝트 리더 관점의 UI/UX 리팩토링 리뷰  
주의: 이 문서는 diff 리뷰가 아니라, 현재 코드 구조와 화면 설계를 기준으로 한 리팩토링 지시서다.

---

## 0. Claude에게 전달할 작업 방식

이 문서는 바로 구현하기 위한 체크리스트가 아니라, 먼저 위험도와 사용자 경험 기준을 정렬하기 위한 리뷰 문서다.

Claude는 아래 순서로 처리한다.

1. 이 문서를 먼저 읽고, 각 항목의 `판단`, `영향`, `권장 수정`, `완료 기준`을 확인한다.
2. `docs/ui-consistency-audit-2026-04-24.md`도 함께 읽는다. 해당 문서의 상당수 항목은 이미 구현되어 있으므로, 과거 지적을 그대로 반복하지 말고 현재 코드와 대조한다.
3. P0 항목은 UI 안정성과 접근성에 직접 영향을 주므로 먼저 처리한다.
4. P1 항목은 화면 품질과 유지보수성에 영향을 주므로 다음 작업 단위로 묶는다.
5. P2 항목은 구조 개선, 디자인 시스템화, 장기 품질 개선으로 분리한다.
6. 수정 후에는 `npm run lint`, `npm test`, `npm run build`를 기준 검증으로 사용한다.
7. 가능하면 Playwright 스크린샷 검증을 추가한다. 현재 리뷰 시점에는 로컬 `frontend/node_modules/.bin/playwright.cmd`가 없어 런타임 스크린샷 검증은 수행하지 못했다.

Claude 작업 원칙:

- 사용자 화면을 먼저 보고, 코드 구조는 그 다음에 정리한다.
- 작은 스타일 수정처럼 보여도 실제로는 레이아웃, 접근성, 상태 전달, 취소 동작과 연결될 수 있다.
- 기존 공통 컴포넌트 방향은 유지한다. 새 디자인 시스템을 크게 도입하기보다 이미 생긴 `StudioResultHeader`, `StudioUploadSlot`, `StudioLoadingState`, `StudioEmptyState`, `StudioLayout` 계열을 먼저 정리한다.
- 임의의 대규모 색상 개편이나 브랜드 변경은 하지 않는다.
- 작업 중 기존 사용자 변경을 되돌리지 않는다.

---

## 1. 현재 UI 상태 요약

### 1.1 좋아진 점

현재 UI는 이전 감사 문서 기준으로 많이 개선되어 있다.

- 결과 카드 헤더가 `StudioResultHeader`로 정리되어 결과 영역의 반복 구조가 줄었다.
- 업로드 슬롯이 `StudioUploadSlot`으로 공통화되어 생성, 편집, 비전, 비교 화면에서 비슷한 UX를 제공한다.
- 빈 상태와 로딩 상태가 `StudioEmptyState`, `StudioLoadingState`로 분리되어 화면 일관성이 좋아졌다.
- 분석 진행 모달은 가짜 퍼센트 표시를 제거하고 실제 단계 중심으로 바뀌었다.
- 편집 진행 모달도 단순 `stepDone / 4` 방식에서 벗어나 파이프라인 진행 상태를 쓰는 방향으로 개선되어 있다.
- 이미지 소스 카드의 검은 레터박스 문제는 상당 부분 완화되어 있다.
- 비교 분석 화면은 이전보다 오른쪽 분석 패널과 결과 영역의 역할이 분명해졌다.

### 1.2 남은 핵심 문제

남은 문제는 개별 컴포넌트의 미세한 스타일보다, 화면 전체의 제품 품질 기준에 가깝다.

- 앱이 사실상 데스크톱 고정폭 도구처럼 구성되어 있는데, 이 정책이 명시되어 있지 않다.
- 반응형 대응이 거의 없어서 1024px 이하, 태블릿, 작은 노트북, 브라우저 사이드바 환경에서 깨질 가능성이 높다.
- 접근성 측면에서 `div` 클릭, hover-only 액션, disabled button 처리 누락, 키보드 조작 누락이 남아 있다.
- 상단 시스템 상태 영역이 밀도 높고 hover 중심이라 좁은 화면과 키보드 사용자에게 약하다.
- 진행 모달의 취소 버튼 의미가 실제 중단 가능한 작업 범위와 완전히 맞지 않을 수 있다.
- 공통 컴포넌트가 생겼지만 여전히 inline style이 많아 반응형, focus 상태, theme token 정리가 어렵다.

---

## 2. 검증 범위

이번 UI 리뷰는 정적 코드 리뷰 중심으로 진행했다.

확인한 주요 경로:

- `frontend/app/page.tsx`
- `frontend/app/generate/page.tsx`
- `frontend/app/edit/page.tsx`
- `frontend/app/video/page.tsx`
- `frontend/app/vision/page.tsx`
- `frontend/app/vision/compare/page.tsx`
- `frontend/components/chrome/AppHeader.tsx`
- `frontend/components/chrome/SystemMetrics.tsx`
- `frontend/components/chrome/SystemStatusChip.tsx`
- `frontend/components/studio/StudioLayout.tsx`
- `frontend/components/studio/StudioUploadSlot.tsx`
- `frontend/components/studio/SourceImageCard.tsx`
- `frontend/components/studio/StudioResultCard.tsx`
- `frontend/components/studio/VisionResultCard.tsx`
- `frontend/components/studio/VideoPlayerCard.tsx`
- `frontend/components/studio/ProgressModal.tsx`
- `frontend/components/studio/AnalysisProgressModal.tsx`
- `frontend/components/studio/PipelineSteps.tsx`
- `frontend/components/menu/MenuCard.tsx`

검증된 것:

- UI 코드의 구조와 공통 컴포넌트 적용 상태
- 반응형 관련 코드 존재 여부
- 접근성 위험이 있는 상호작용 패턴
- 진행 상태 UI의 의미와 실제 동작 가능성
- 디자인 토큰 사용 일관성

검증하지 못한 것:

- 실제 브라우저 스크린샷
- 모바일/태블릿 viewport 렌더링
- 키보드 탭 순서 실제 체감
- 시스템 메트릭 hover overlay의 실제 겹침 여부

사유:

- 리뷰 시점에 `frontend/node_modules/.bin/playwright.cmd`가 없어 Playwright 스크린샷 검증을 수행하지 못했다.

---

## 3. P0 항목

P0는 사용성, 접근성, 화면 안정성에 직접 영향을 줄 수 있는 항목이다.

---

### P0-1. 화면이 데스크톱 고정폭에 가깝지만 정책이 명확하지 않음

#### 판단

현재 Studio 계열 화면은 실질적으로 데스크톱 전용 도구에 가깝다.

근거:

- `frontend/components/studio/StudioLayout.tsx`
  - `STUDIO_MIN_WIDTH = 1024`
  - `STUDIO_GRID_COLUMNS = "400px minmax(624px, 1fr)"`
- `StudioPage`가 `minWidth: STUDIO_MIN_WIDTH`를 사용한다.
- 작업 영역은 기본적으로 좌측 패널 400px, 우측 결과 영역 최소 624px을 요구한다.
- `rg "@media|gridTemplateColumns|minWidth|maxWidth|width:" frontend/app frontend/components` 기준으로 실질적인 responsive breakpoint가 보이지 않는다.
- 메인 메뉴도 `gridTemplateColumns: "repeat(3, 1fr)"` 구조를 사용한다.
- 비교 화면도 `gridTemplateColumns: "1fr 1fr"` 구조가 고정적으로 쓰인다.

이 자체가 무조건 잘못은 아니다. AI 이미지 스튜디오가 로컬 데스크톱 작업 도구라면 desktop-first 정책은 합리적이다. 문제는 이 정책이 명시되어 있지 않고, 작은 화면에서 어떤 품질을 보장할지 정해져 있지 않다는 점이다.

#### 영향

- 1024px 이하 viewport에서 가로 스크롤, 버튼 겹침, 결과 카드 축소 실패가 발생할 수 있다.
- 브라우저 사이드바를 켠 사용자는 13인치 노트북에서도 화면이 답답해질 수 있다.
- 태블릿 대응을 기대한 사용자는 업로드, 진행 모달, 결과 확인 흐름에서 이탈할 수 있다.
- UI 버그가 발생해도 의도된 제약인지 실제 버그인지 판단하기 어렵다.

#### 권장 수정

둘 중 하나를 명확히 선택한다.

선택 A: 데스크톱 전용 정책을 명시한다.

- 최소 지원 viewport를 문서화한다.
- 1024px 미만에서는 모바일 최적화 대신 명확한 안내 UI를 보여준다.
- 앱 헤더와 메인 메뉴도 같은 정책을 따른다.

선택 B: 반응형을 실제로 지원한다.

- `StudioWorkspace`를 1024px 이하에서 1열로 전환한다.
- 좌측 입력 패널은 상단, 결과 패널은 하단으로 쌓는다.
- 메인 메뉴는 3열에서 1열 또는 2열로 전환한다.
- 비교 화면의 원본/비교 이미지 슬롯도 작은 화면에서 세로 배치한다.
- 상단 헤더는 오른쪽 시스템 상태 영역을 접거나 2행으로 분리한다.

프로젝트 리더 관점 권장안:

- 단기에는 선택 A로 정책을 명확히 하고, 깨지는 구간을 막는다.
- 이후 P1 작업으로 선택 B의 핵심 breakpoint만 추가한다.

#### 완료 기준

- 최소 지원 viewport가 README 또는 UI 문서에 명시되어 있다.
- 1024px 미만 정책이 코드상으로도 일관된다.
- 반응형을 지원한다면 최소 1440px, 1280px, 1024px, 768px에서 주요 화면이 깨지지 않는다.
- 업로드 슬롯, 결과 카드, 진행 모달, 상단 헤더가 서로 겹치지 않는다.

#### Claude 코멘트

```md
Claude comment:
- 선택한 정책:
- 수정한 파일:
- 검증 viewport:
- 남은 리스크:
```

---

### P0-2. `SystemMetrics`에서 정의되지 않은 CSS 토큰 사용 가능성

#### 판단

`frontend/components/chrome/SystemMetrics.tsx`에서 `borderRadius: "var(--radius-md)"`를 사용한다.

그러나 `frontend/app/globals.css` 기준으로 확인되는 radius token은 다음 계열이다.

- `--radius`
- `--radius-sm`
- `--radius-card`
- `--radius-lg`
- `--radius-xl`
- `--radius-full`

`--radius-md`는 정의되어 있지 않은 것으로 보인다.

#### 영향

- 해당 style 선언은 브라우저에서 유효하지 않은 값이 될 수 있다.
- 시스템 메트릭 overlay의 radius가 의도와 다르게 보일 수 있다.
- 디자인 토큰 체계 신뢰도가 떨어진다.

#### 권장 수정

- `--radius-md`를 쓰지 말고 기존 토큰 중 하나로 맞춘다.
- 가장 자연스러운 후보는 `--radius` 또는 `--radius-card`다.
- 만약 `--radius-md`가 필요하다면 `globals.css`에 명시적으로 추가하되, 전체 토큰 체계와 이름 규칙을 함께 정리한다.

프로젝트 리더 관점 권장안:

- 이번에는 새 token을 추가하지 말고 `--radius`로 치환한다.
- radius token naming 정리는 별도 P2 디자인 토큰 작업으로 분리한다.

#### 완료 기준

- `rg "radius-md" frontend` 결과가 없거나, `--radius-md`가 실제로 정의되어 있다.
- 시스템 메트릭 overlay가 의도된 radius로 렌더링된다.
- lint/build가 통과한다.

#### Claude 코멘트

```md
Claude comment:
- 선택한 token:
- 수정한 파일:
- 확인 결과:
```

---

### P0-3. disabled 메뉴 카드가 실제 button disabled 상태가 아닐 가능성

#### 판단

`frontend/components/menu/MenuCard.tsx`는 카드 전체를 `button`으로 렌더링한다.  
disabled 상태일 때 cursor와 opacity는 바뀌지만, 실제 `disabled` 속성이 부여되어 있는지 확인이 필요하다.

현재 구조상 disabled 카드에 `onClick`을 넘기지 않는 방식은 시각적으로는 동작하지 않는 것처럼 보일 수 있다. 하지만 접근성 관점에서는 keyboard focus, screen reader 상태, Enter/Space 반응이 명확하지 않을 수 있다.

#### 영향

- disabled 카드가 탭 순서에 남을 수 있다.
- 스크린 리더가 disabled 상태를 정확히 전달하지 못할 수 있다.
- 사용자는 "준비 중"인지 "클릭 가능한데 오류가 난 것"인지 혼동할 수 있다.

#### 권장 수정

- 실제 `button`에 `disabled={disabled}`를 부여한다.
- 필요한 경우 `aria-disabled={disabled}`도 함께 검토한다.
- disabled 카드의 tooltip 또는 상태 텍스트는 유지하되, 키보드 초점이 가지 않게 할지 여부를 정책으로 정한다.

프로젝트 리더 관점 권장안:

- 준비 중 기능은 focus 가능한 CTA가 아니라, 비활성 상태 카드로 두는 편이 맞다.
- `disabled` 속성을 직접 부여하고, 설명 텍스트로 "준비 중" 상태를 명확히 전달한다.

#### 완료 기준

- disabled 메뉴 카드는 Enter/Space로 실행되지 않는다.
- 탭 순서에서 disabled 카드 정책이 일관된다.
- screen reader가 disabled 상태를 알 수 있다.
- 시각적 disabled 스타일은 기존과 유지된다.

#### Claude 코멘트

```md
Claude comment:
- disabled 처리 방식:
- 접근성 확인:
- 남은 이슈:
```

---

### P0-4. 업로드 슬롯이 클릭 가능한 `div` 중심이라 키보드 접근성이 약함

#### 판단

`frontend/components/studio/StudioUploadSlot.tsx`는 공통화가 잘 되어 있지만, 사용자 상호작용의 핵심이 `div` 클릭과 hidden file input에 묶여 있다.

이 방식은 마우스 사용자는 자연스럽지만, 키보드 사용자에게는 다음 문제가 생길 수 있다.

- 슬롯이 tab focus 대상이 아닐 수 있다.
- Enter/Space로 파일 선택을 열 수 없을 수 있다.
- paste 가능 영역이라는 사실이 focus 상태와 연결되지 않는다.
- dropzone, paste zone, file select button의 역할이 스크린 리더에 충분히 전달되지 않을 수 있다.

#### 영향

- 이미지 업로드가 앱의 핵심 액션인데, 접근성 품질이 낮아진다.
- 접근성뿐 아니라 touch device에서도 명확한 조작 affordance가 약해진다.
- compare 화면처럼 슬롯이 2개인 경우 현재 활성 슬롯이 어디인지 더 헷갈릴 수 있다.

#### 권장 수정

아래 중 하나로 정리한다.

선택 A: 슬롯 자체를 keyboard-accessible dropzone으로 만든다.

- `role="button"` 또는 더 적합한 role을 검토한다.
- `tabIndex={0}`를 추가한다.
- Enter/Space에서 file input click을 실행한다.
- `aria-label`에 슬롯 이름과 가능한 액션을 포함한다.
- focus-visible 스타일을 추가한다.

선택 B: 명시적 버튼을 제공한다.

- 슬롯 내부에 실제 `button`을 두고 파일 선택은 그 버튼에서만 실행한다.
- drop/paste는 슬롯 영역에서 유지한다.
- 접근성 측면에서는 이 방식이 더 명확할 수 있다.

프로젝트 리더 관점 권장안:

- 기존 UX를 크게 바꾸지 않기 위해 선택 A를 우선 적용한다.
- 이후 필요하면 선택 B로 더 명시적인 액션 구조를 도입한다.

#### 완료 기준

- Tab으로 업로드 슬롯에 접근할 수 있다.
- Enter/Space로 파일 선택을 열 수 있다.
- focus-visible 상태가 명확하다.
- compare 화면의 두 슬롯에서 현재 focus 또는 hover 대상이 구분된다.
- paste/drop/click 동작이 기존과 동일하게 유지된다.

#### Claude 코멘트

```md
Claude comment:
- 적용 방식:
- 키보드 테스트:
- compare 화면 확인:
- 남은 리스크:
```

---

### P0-5. 상단 시스템 메트릭이 hover 중심이고 좁은 화면에서 겹칠 위험이 있음

#### 판단

상단 헤더는 `Chrome`/`AppHeader`/`SystemStatusChip`/`SystemMetrics` 조합으로 구성된다. 오른쪽 영역에는 상태 chip, 메트릭, 설정 버튼이 함께 들어간다.

`SystemMetrics`는 hover 시 상세 overlay가 열리는 구조다. 시스템 상태를 보여주는 면에서는 좋지만, UI 안정성 측면에서는 몇 가지 위험이 있다.

- hover-only 상세 정보는 keyboard/touch 접근성이 약하다.
- overlay가 좁은 화면에서 잘리거나 설정 버튼, status chip과 겹칠 수 있다.
- VRAM, 모델명, job 상태처럼 긴 문자열이 들어오면 폭 계산이 불안정할 수 있다.
- `Chrome`의 topbar가 `gridTemplateColumns: "1fr auto 1fr"` 구조라 중앙 title과 오른쪽 메트릭이 동시에 길어질 때 압박을 받을 수 있다.

#### 영향

- 헤더는 모든 화면에 고정적으로 노출되므로 작은 불안정도 전체 제품 품질을 낮춘다.
- 시스템 상태는 사용자가 작업 진행 여부를 판단하는 정보라, 잘림이나 hover 의존성은 실제 사용성에 영향을 준다.

#### 권장 수정

- `SystemMetrics` overlay를 hover뿐 아니라 focus/click으로도 열 수 있게 한다.
- `aria-expanded`, `aria-controls`를 검토한다.
- overlay 위치는 오른쪽 기준 정렬하되 viewport overflow를 막는다.
- 1024px 이하 또는 좁은 헤더에서는 compact 모드로 전환한다.
- 긴 문자열은 ellipsis와 tooltip 또는 detail row 확장으로 처리한다.
- 이 영역의 emoji icon 사용은 lucide/icon token 체계로 맞추는 것을 검토한다.

프로젝트 리더 관점 권장안:

- 우선 hover + focus-within을 동시에 지원한다.
- 그 다음 좁은 viewport에서 메트릭 상세를 숨기고 status chip만 남기는 compact 모드를 추가한다.

#### 완료 기준

- 키보드 focus로 시스템 메트릭 상세를 확인할 수 있다.
- overlay가 viewport 밖으로 잘리지 않는다.
- 긴 모델명/VRAM 텍스트가 헤더 레이아웃을 밀지 않는다.
- 1024px, 1280px, 1440px 폭에서 헤더가 겹치지 않는다.

#### Claude 코멘트

```md
Claude comment:
- overlay 접근 방식:
- compact breakpoint:
- 확인한 긴 문자열 케이스:
- 남은 리스크:
```

---

### P0-6. 진행 모달의 취소 버튼 의미가 실제 중단 범위와 어긋날 수 있음

#### 판단

`frontend/components/studio/ProgressModal.tsx`는 진행 중 상태에서 `취소` 버튼을 제공한다. 내부적으로 interrupt 계열 동작과 연결되어 있을 가능성이 높다.

문제는 사용자가 보는 "취소"의 의미가 전체 파이프라인 취소인지, ComfyUI job interrupt인지, 현재 단계 이후 중단인지 명확하지 않다는 점이다.

특히 LLM 분석, 프롬프트 생성, 이미지 다운로드, 후처리처럼 ComfyUI sampling이 아닌 단계에서는 같은 버튼이 실제로 어디까지 취소하는지 애매할 수 있다.

#### 영향

- 사용자는 "취소"를 눌렀는데 작업이 계속되는 것처럼 느낄 수 있다.
- 반대로 실제로는 ComfyUI job만 중단되는데 전체 작업 취소로 오해할 수 있다.
- 실패/중단 상태 메시지와 재시도 UX가 복잡해진다.

#### 권장 수정

- 버튼 라벨을 실제 동작에 맞춘다.
- ComfyUI 작업만 중단한다면 `ComfyUI 중단` 또는 `생성 중단`처럼 범위를 좁힌다.
- 전체 취소가 가능하지 않은 단계에서는 버튼을 disabled 처리하거나 보조 텍스트로 설명한다.
- 분석 모달처럼 취소가 없는 작업은 `닫기`와 진행 상태 확인을 분리한다.

프로젝트 리더 관점 권장안:

- 단기에는 sampling 단계에서만 취소 버튼을 활성화한다.
- 다른 단계에서는 버튼을 숨기거나 `중단 준비 중` 같은 애매한 표현을 쓰지 않는다.
- 상태 메시지에 실제 중단 가능 여부를 명확히 반영한다.

#### 완료 기준

- 버튼 라벨과 실제 API 동작이 일치한다.
- 취소 불가능한 단계에서는 취소 버튼이 노출되지 않거나 disabled 상태다.
- 중단 후 사용자에게 보이는 결과 상태가 명확하다.
- 생성, 편집, 비디오 작업에서 동일한 기준을 따른다.

#### Claude 코멘트

```md
Claude comment:
- 실제 interrupt 범위:
- 버튼 노출 조건:
- 생성/편집/비디오 확인:
- 남은 리스크:
```

---

## 4. P1 항목

P1은 현재 당장 치명적이지는 않지만, 제품 완성도와 유지보수성을 빠르게 떨어뜨릴 수 있는 항목이다.

---

### P1-1. document-level paste listener가 여러 슬롯과 페이지에 흩어져 있음

#### 판단

`StudioUploadSlot`은 paste 업로드를 지원하기 위해 document-level paste listener를 등록한다. compare 화면처럼 업로드 슬롯이 2개 있고 페이지 레벨 fallback paste listener도 있는 경우, 이벤트 흐름이 복잡해진다.

현재 코드에는 conflict를 줄이기 위한 hover 상태, editable target 체크, `preventDefault` 처리가 들어가 있다. 하지만 구조적으로는 여전히 다음 위험이 있다.

- 어느 슬롯이 paste를 받을지 예측하기 어렵다.
- focus와 hover가 다를 때 사용자가 기대한 슬롯이 아닌 곳에 이미지가 들어갈 수 있다.
- 페이지 레벨 listener와 슬롯 listener가 동시에 유지되면 장기적으로 버그가 생기기 쉽다.
- 텍스트 입력 중 paste 예외 처리가 누락되면 prompt textarea UX를 깨뜨릴 수 있다.

#### 영향

- paste는 편리한 기능이지만 실패하면 사용자가 원인을 이해하기 어렵다.
- compare 화면에서 base/compare 이미지가 뒤바뀌면 분석 결과 신뢰도가 크게 떨어진다.

#### 권장 수정

- paste handling을 페이지당 하나의 hook 또는 provider로 중앙화한다.
- 활성 업로드 대상은 hover보다 focus/selected slot 우선으로 정한다.
- compare 화면은 현재 활성 슬롯을 명시적으로 표시한다.
- editable target 예외 처리는 공통 유틸로 분리한다.

프로젝트 리더 관점 권장안:

- `useImagePasteTarget` 같은 작은 hook을 만들고, 각 페이지에서 active target을 넘기는 방식으로 정리한다.
- 단, 대규모 이벤트 시스템까지 만들 필요는 없다.

#### 완료 기준

- 한 페이지에서 paste listener는 실질적으로 하나만 동작한다.
- textarea/input/contenteditable 안에서는 이미지 paste가 아닌 일반 paste가 유지된다.
- compare 화면에서 paste 대상이 시각적으로 명확하다.
- paste/drop/click 업로드 동작이 기존과 동일하게 유지된다.

#### Claude 코멘트

```md
Claude comment:
- 중앙화한 위치:
- active target 결정 규칙:
- compare 확인:
- editable paste 확인:
```

---

### P1-2. inline style이 많아 responsive/focus/theme 수정 비용이 높음

#### 판단

현재 UI는 공통 컴포넌트가 생겼지만 여전히 inline style이 많다.

대표 영역:

- `frontend/app/page.tsx`
- `frontend/app/generate/page.tsx`
- `frontend/app/edit/page.tsx`
- `frontend/app/video/page.tsx`
- `frontend/app/vision/page.tsx`
- `frontend/app/vision/compare/page.tsx`
- `frontend/components/chrome/SystemMetrics.tsx`
- `frontend/components/studio/*`

inline style 자체가 항상 나쁜 것은 아니다. 현재처럼 빠르게 로컬 도구 UI를 만들 때는 의존성을 줄이고 즉시 수정하기 좋다. 하지만 지금 단계에서는 아래 문제가 더 커지고 있다.

- media query를 적용하기 어렵다.
- `:hover`, `:focus-visible`, `:disabled`, `:focus-within` 같은 상태 스타일을 일관되게 관리하기 어렵다.
- 같은 토큰 조합이 여러 파일에 반복된다.
- 디자인 토큰이 실제로 적용되는지 검색하기 어렵다.

#### 영향

- UI 품질 수정이 컴포넌트별 수작업이 된다.
- 반응형 대응을 시작하면 inline style의 한계가 바로 나타난다.
- 접근성 focus 스타일을 빠뜨리기 쉽다.

#### 권장 수정

전면 CSS 프레임워크 도입은 권장하지 않는다. 대신 작은 범위의 CSS module 또는 전역 utility class를 도입한다.

우선 분리할 후보:

- studio page shell
- studio workspace grid
- field header
- upload slot focus/drag/hover 상태
- result action bar
- topbar system metrics overlay
- menu grid/card responsive 상태

프로젝트 리더 관점 권장안:

- 한 번에 전체를 바꾸지 않는다.
- P0 수정에 필요한 컴포넌트부터 CSS module로 이동한다.
- 공통 상태 스타일은 `globals.css`에 token 기반 class로 작게 둔다.

#### 완료 기준

- 새 responsive breakpoint와 focus-visible 스타일이 inline style 없이 적용된다.
- 중복되는 layout style이 줄어든다.
- build/lint가 통과한다.
- 기존 시각 스타일이 과하게 변하지 않는다.

#### Claude 코멘트

```md
Claude comment:
- CSS module로 분리한 범위:
- 유지한 inline style 이유:
- 중복 제거 결과:
- 남은 후보:
```

---

### P1-3. 메인 메뉴가 시각적으로 좋지만 고정 3열과 큰 카드 높이에 의존함

#### 판단

`frontend/app/page.tsx`의 메인 메뉴는 제품 첫인상으로는 충분히 좋다. 각 기능 카드가 명확하고 시각 자산도 들어가 있다.

다만 구조적으로는 다음 제약이 있다.

- 3열 고정 grid
- 카드 `minHeight`가 큰 편
- 상단 헤더와 함께 작은 높이의 노트북에서 스크롤 압박 가능성
- disabled 기능 카드가 실제 button disabled와 연결되어야 함

#### 영향

- 13인치 노트북, 브라우저 확대, OS scaling 환경에서 첫 화면이 답답할 수 있다.
- 기능이 늘어나면 같은 grid 구조가 바로 한계에 닿는다.

#### 권장 수정

- 1280px 이하에서 2열, 900px 이하에서 1열로 전환한다.
- 카드 내부 이미지 높이를 viewport나 container에 맞게 줄인다.
- disabled 카드는 실제 disabled button 처리한다.
- 기능이 늘어날 가능성을 고려해 메뉴 섹션 구조를 유지한다.

#### 완료 기준

- 1440px에서는 현재 첫인상이 유지된다.
- 1280px 이하에서도 카드 텍스트와 버튼이 겹치지 않는다.
- 900px 이하에서는 1열로 자연스럽게 쌓인다.
- disabled 기능은 실행되지 않고 상태가 명확하다.

#### Claude 코멘트

```md
Claude comment:
- 적용 breakpoint:
- 카드 높이 조정:
- disabled 확인:
```

---

### P1-4. 결과 카드 action bar가 hover 중심일 가능성

#### 판단

결과 카드와 이미지 카드에는 다운로드, 복사, 확대 같은 액션이 있다. 현재 구조는 시각적으로는 깔끔하지만, 일부 액션이 hover 상태에 강하게 의존할 가능성이 있다.

#### 영향

- 키보드 사용자나 touch 사용자에게 액션 발견성이 낮다.
- 결과물이 핵심 산출물인 앱에서 다운로드/복사 액션을 찾기 어려워질 수 있다.
- hover가 없는 환경에서는 버튼이 갑자기 나타나지 않는 문제가 생길 수 있다.

#### 권장 수정

- hover-only action은 focus-within에서도 표시한다.
- 핵심 액션 하나는 항상 보이게 둔다.
- 보조 액션은 overflow menu 또는 header action group으로 묶는다.
- 모든 icon button에 `aria-label`과 tooltip을 유지한다.

#### 완료 기준

- Tab 이동으로 결과 카드 액션을 모두 사용할 수 있다.
- touch 환경에서도 핵심 액션이 보인다.
- hover, focus, disabled 상태가 일관된다.

#### Claude 코멘트

```md
Claude comment:
- 항상 노출한 액션:
- focus-within 처리:
- keyboard 확인:
```

---

### P1-5. Vision 결과 카드의 정보 밀도가 높아 작은 폭에서 깨질 수 있음

#### 판단

`frontend/components/studio/VisionResultCard.tsx`는 분석 결과, 태그, 컬러, 디테일, 프롬프트 후보 등 정보량이 많다. 현재 결과 카드는 데스크톱 폭에서는 유용하지만, 폭이 좁아질수록 grid와 긴 텍스트가 부담이 된다.

#### 영향

- 긴 한국어/영어 문장이 카드 폭을 밀 수 있다.
- copy button, tag chip, score label이 겹칠 수 있다.
- 사용자는 핵심 분석 결과보다 부가 정보에 먼저 압도될 수 있다.

#### 권장 수정

- 핵심 요약, 프롬프트 후보, 세부 분석을 시각적으로 더 명확히 분리한다.
- 긴 섹션은 collapsible 영역으로 바꾼다.
- 1024px 이하에서는 detail grid를 1열로 전환한다.
- copy action은 각 텍스트 블록 오른쪽 상단에 고정하되, 작은 폭에서 줄바꿈을 허용한다.

#### 완료 기준

- 긴 분석 결과에서도 카드가 가로로 넘치지 않는다.
- copy 버튼이 텍스트와 겹치지 않는다.
- 핵심 분석 결과가 첫 화면에서 바로 보인다.
- 작은 폭에서는 1열 구조로 자연스럽게 내려간다.

#### Claude 코멘트

```md
Claude comment:
- 정리한 정보 구조:
- collapsible 적용 여부:
- 긴 텍스트 확인:
```

---

### P1-6. 색상과 아이콘 표현이 token 체계와 일부 어긋남

#### 판단

전체적으로 디자인 토큰을 쓰려는 방향은 보인다. 하지만 일부 컴포넌트에는 raw color, emoji, hardcoded dark surface가 남아 있다.

예시:

- `rgba(0, 0, 0, ...)`
- `#0a0a0a`
- `#DC2626`
- `#F59E0B`
- `#C0392B`
- emoji 기반 row icon

비디오 플레이어, lightbox, danger 상태처럼 raw dark/danger color가 필요한 경우도 있다. 다만 제품 전체 디자인 시스템 기준에서는 어느 색이 의미 색상이고 어느 색이 일회성인지 정리가 필요하다.

#### 영향

- 색상 의미가 파일마다 달라질 수 있다.
- dark overlay와 danger 상태가 접근성 contrast 기준을 만족하는지 확인하기 어렵다.
- 아이콘 체계가 섞이면 제품 완성도가 낮아 보인다.

#### 권장 수정

- danger, warning, success, info token을 명확히 둔다.
- 시스템 상태 메트릭의 emoji icon은 lucide icon 또는 텍스트 label로 교체를 검토한다.
- lightbox/video처럼 진짜 black surface가 필요한 영역은 예외로 문서화한다.
- 새 color token 추가는 최소화하고 기존 token을 먼저 재사용한다.

#### 완료 기준

- 의미 색상은 token으로 관리된다.
- 예외 raw color는 이유가 명확하다.
- 아이콘 표현이 화면별로 일관된다.

#### Claude 코멘트

```md
Claude comment:
- token화한 색상:
- 유지한 raw color와 이유:
- 교체한 icon:
```

---

## 5. P2 항목

P2는 당장 버그는 아니지만, UI 품질을 오래 유지하기 위해 필요한 구조 개선이다.

---

### P2-1. Studio 화면 단위의 디자인 시스템 문서가 필요함

#### 판단

공통 컴포넌트는 생겼지만, 어떤 화면에서 어떤 컴포넌트를 써야 하는지 문서화되어 있지 않다.

#### 권장 수정

`docs/studio-ui-system.md` 같은 문서를 만든다.

포함할 내용:

- Studio page shell 구조
- 좌측 입력 패널과 우측 결과 패널 기준
- 업로드 슬롯 사용 규칙
- 결과 카드 헤더 action 기준
- 진행 모달 상태 기준
- empty/loading/error/success 상태 표현
- desktop-first 또는 responsive 정책

#### 완료 기준

- 새 기능 화면을 만들 때 참고할 UI 규칙이 문서화되어 있다.
- Claude나 다른 에이전트가 같은 패턴으로 화면을 추가할 수 있다.

#### Claude 코멘트

```md
Claude comment:
- 문서 생성 여부:
- 포함한 컴포넌트 규칙:
- 남은 문서화 대상:
```

---

### P2-2. Storybook 또는 lightweight visual test가 있으면 회귀를 줄일 수 있음

#### 판단

현재 UI 컴포넌트는 상태가 많다.

- upload empty/dragging/has image
- result loading/success/error
- progress modal stage
- system metrics connected/disconnected/running
- menu card enabled/disabled
- vision result long text

이 상태를 실제 화면에서만 확인하면 회귀를 놓치기 쉽다.

#### 권장 수정

큰 Storybook 도입이 부담되면, 먼저 lightweight visual test route를 만든다.

예:

- `/dev/ui-lab`
- 각 공통 컴포넌트를 mock data로 렌더링
- Playwright screenshot으로 회귀 확인

#### 완료 기준

- 핵심 UI 컴포넌트의 주요 상태를 한 화면에서 볼 수 있다.
- Playwright 또는 screenshot 검증으로 최소 desktop viewport를 확인한다.

#### Claude 코멘트

```md
Claude comment:
- 선택한 방식:
- 만든 테스트 화면:
- 캡처한 상태:
```

---

## 6. 화면별 리뷰

### 6.1 Main Menu

강점:

- 제품 첫 화면으로 기능 구분이 명확하다.
- 이미지 자산이 있어 단순 관리 도구보다 완성도가 높다.
- 카드 단위 CTA가 명확하다.

개선:

- 3열 고정 grid를 breakpoint 기반으로 바꾼다.
- disabled 카드에 실제 `disabled` 속성을 부여한다.
- 작은 height 환경에서 카드 minHeight를 줄이는 compact mode가 필요하다.

Claude comment:

```md
- Main Menu 수정 의견:
- 실제 수정:
- 검증:
```

### 6.2 Generate Page

강점:

- 좌측 입력, 우측 결과 구조가 명확하다.
- 진행 모달과 결과 카드 흐름이 자연스럽다.
- 공통 결과 헤더 적용 방향이 좋다.

개선:

- prompt textarea focus/paste와 이미지 paste listener 충돌을 계속 주의해야 한다.
- 진행 취소 버튼 의미를 실제 interrupt 범위와 맞춘다.
- 작은 viewport에서 입력 패널과 결과 패널을 세로로 쌓는 정책이 필요하다.

Claude comment:

```md
- Generate 수정 의견:
- 실제 수정:
- 검증:
```

### 6.3 Edit Page

강점:

- 소스 이미지와 결과 이미지의 비교 흐름이 명확하다.
- 진행 상태가 파이프라인 중심으로 개선되어 있다.

개선:

- 업로드 슬롯 keyboard 접근성 보완이 필요하다.
- 편집 진행 중 취소 버튼의 동작 범위를 명확히 해야 한다.
- 결과 액션이 hover-only라면 focus-within 지원이 필요하다.

Claude comment:

```md
- Edit 수정 의견:
- 실제 수정:
- 검증:
```

### 6.4 Video Page

강점:

- 비디오 결과는 이미지와 다른 컨테이너가 필요하고, 현재 `VideoPlayerCard`로 분리된 점은 좋다.
- 로딩 UI에서 가짜 progress를 제거한 방향이 맞다.

개선:

- 비디오 컨트롤 영역이 작은 폭에서 깨지지 않는지 확인해야 한다.
- video surface의 raw black color는 예외로 문서화한다.
- 생성 중단 버튼 의미를 ComfyUI interrupt 범위와 맞춘다.

Claude comment:

```md
- Video 수정 의견:
- 실제 수정:
- 검증:
```

### 6.5 Vision Page

강점:

- 분석 결과 UI가 독립 카드로 분리되어 있다.
- 분석 진행 모달이 fake percent 없이 단계 중심으로 개선되어 있다.

개선:

- 긴 분석 결과와 다수 태그가 작은 폭에서 넘치지 않는지 확인해야 한다.
- 핵심 요약과 세부 분석의 정보 위계를 더 분명히 한다.
- copy action의 keyboard 접근성을 확인한다.

Claude comment:

```md
- Vision 수정 의견:
- 실제 수정:
- 검증:
```

### 6.6 Vision Compare Page

강점:

- 두 이미지 비교라는 복잡한 흐름을 비교적 명확하게 나누고 있다.
- 분석 패널과 이미지 슬롯의 역할이 구분되어 있다.

개선:

- 두 업로드 슬롯에서 paste 대상이 명확해야 한다.
- 2열 고정 구조는 작은 폭에서 깨질 가능성이 높다.
- base/compare 이미지가 뒤바뀌는 상황은 결과 신뢰도에 치명적이므로 active slot 표시를 더 명확히 한다.

Claude comment:

```md
- Compare 수정 의견:
- 실제 수정:
- 검증:
```

---

## 7. 추천 작업 순서

### Step 1. 빠른 P0 안정화

목표:

- 깨진 token 제거
- disabled button 정확화
- upload slot keyboard 접근성 보완
- progress cancel label/조건 정리
- system metrics hover/focus 보완

검증:

- `npm run lint`
- `npm test`
- `npm run build`
- 수동 keyboard tab 확인

Claude comment:

```md
- 완료한 P0:
- 제외한 P0와 이유:
- 검증 결과:
```

### Step 2. Desktop policy 또는 responsive baseline 결정

목표:

- 1024px 미만 정책을 명확히 한다.
- 선택한 정책에 맞춰 `StudioLayout`, main menu, compare grid를 정리한다.

검증:

- 1440px
- 1280px
- 1024px
- 768px

Claude comment:

```md
- 선택한 정책:
- 적용한 breakpoint:
- 검증 결과:
```

### Step 3. Paste handling 정리

목표:

- document-level paste listener를 중앙화한다.
- compare 화면의 active target을 명확히 한다.
- text input paste와 이미지 paste가 충돌하지 않게 한다.

검증:

- prompt textarea paste
- single upload paste
- compare base paste
- compare target paste

Claude comment:

```md
- paste listener 구조:
- active target 규칙:
- 검증 결과:
```

### Step 4. Visual regression 기반 마련

목표:

- Playwright 또는 dev UI lab으로 주요 상태를 확인한다.
- 최소한 desktop screenshot만이라도 회귀 기준을 만든다.

검증:

- main menu
- generate empty/loading/result
- edit upload/result
- video loading/result
- vision analysis result
- compare two-slot state

Claude comment:

```md
- 만든 검증 경로:
- 캡처한 화면:
- 자동화 여부:
```

---

## 8. Claude용 바로 실행 프롬프트

### Prompt A: P0 UI 안정화

```md
프로젝트: AI-Image-Studio

먼저 `docs/ui-refactor-review-for-claude-2026-04-26.md`를 읽고 P0 항목만 처리해줘.

작업 범위:
- `SystemMetrics`의 정의되지 않은 CSS token 사용 여부 수정
- `MenuCard` disabled 상태를 실제 button disabled/aria 상태와 맞추기
- `StudioUploadSlot` 키보드 접근성 추가
- `SystemMetrics` hover-only overlay를 focus 접근 가능하게 보완
- `ProgressModal` 취소 버튼 라벨/노출 조건을 실제 interrupt 가능 범위와 맞추기

주의:
- 기존 화면 톤은 크게 바꾸지 말 것
- 대규모 CSS 프레임워크 도입 금지
- 사용자 변경 되돌리지 말 것

검증:
- `npm run lint`
- `npm test`
- `npm run build`

결과 보고:
- 수정 파일
- P0별 처리 내용
- 검증 결과
- 남은 리스크
```

### Prompt B: Responsive baseline

```md
프로젝트: AI-Image-Studio

`docs/ui-refactor-review-for-claude-2026-04-26.md`의 P0-1, P1-3, P1-5를 기준으로 responsive baseline을 잡아줘.

작업 범위:
- `StudioLayout`의 2열 구조를 작은 viewport에서 1열로 전환
- main menu 3열 고정을 2열/1열 breakpoint로 전환
- vision compare의 2열 구조를 작은 viewport에서 세로 배치
- header 오른쪽 system area가 좁은 화면에서 겹치지 않도록 compact 처리

주의:
- desktop 1440px 화면의 현재 인상은 유지
- 모바일 완전 최적화보다 깨지지 않는 baseline이 목표
- inline style을 억지로 전부 제거하지 말고 필요한 범위만 CSS module/class로 분리

검증:
- 1440px
- 1280px
- 1024px
- 768px
- `npm run lint`
- `npm test`
- `npm run build`

결과 보고:
- 적용 breakpoint
- 수정 파일
- 확인한 화면
- 남은 반응형 리스크
```

### Prompt C: Paste UX 정리

```md
프로젝트: AI-Image-Studio

`docs/ui-refactor-review-for-claude-2026-04-26.md`의 P1-1을 기준으로 paste upload UX를 정리해줘.

작업 범위:
- document-level paste listener 중복을 줄이기
- 페이지별 active upload target 규칙 만들기
- compare 화면에서 base/target paste 대상이 명확하게 보이게 하기
- textarea/input/contenteditable paste는 깨지지 않게 유지

주의:
- 기존 drop/click upload 동작 유지
- paste image 기능 제거 금지
- compare 이미지가 뒤바뀌는 UX를 특히 조심

검증:
- generate prompt textarea paste
- edit image paste
- vision image paste
- compare base image paste
- compare target image paste
- `npm run lint`
- `npm test`
- `npm run build`

결과 보고:
- paste 처리 구조
- active target 결정 규칙
- 검증 결과
- 남은 리스크
```

---

## 9. 최종 판단

현재 UI는 "대충 만든 실험 도구" 수준은 이미 벗어났다. 공통 컴포넌트 분리와 진행 상태 정리는 방향이 좋고, 이미지/비디오/비전/비교 화면의 역할도 꽤 명확하다.

다만 다음 단계로 제품 품질을 올리려면 개별 색상이나 카드 모양보다 아래 네 가지를 먼저 고정해야 한다.

1. 지원 viewport 정책
2. 키보드와 touch 접근성
3. 상단 상태 영역의 안정성
4. paste/upload 이벤트 구조

이 네 가지를 정리하면 이후 디자인 시스템화, visual regression, 세부 레이아웃 정리는 훨씬 안전하게 진행할 수 있다.

---

## 10. 전체 코멘트 공간

```md
Claude overall comment:

- 이번 작업에서 실제로 처리한 것:

- 처리하지 않은 것과 이유:

- 추가로 발견한 문제:

- 사용자에게 확인이 필요한 결정:

- 다음 작업 추천:
```

---

## 11. Claude Cross-Review (2026-04-26)

작성: Claude (Opus 4.7, 1M ctx)
방식: 본 Codex 리뷰를 보지 않은 상태에서 `frontend/app`, `frontend/components/{chrome,studio}`, `hooks`, `stores`, `lib/api*` 전체 독립 스캔 → 본 문서와 cross-validate.
검증 명령: `npm run lint` (clean) · `vitest` 23/23 · 본 리뷰는 정적 분석만 사용 (Playwright 미사용 — Codex와 동일 환경 제약).

### 11.1 Codex 리뷰에 대한 동의 (P0)

여섯 P0 모두 검증됨. 특히 접근성/UX 관점은 Claude 독립 리뷰에서 약하게 다뤘던 영역이라 Codex 발견이 더 중요:

| 항목 | Claude 검증 | 코멘트 |
|------|-------------|--------|
| P0-1 데스크톱 고정폭 정책 미명시 | **검증** | `STUDIO_MIN_WIDTH = 1024` + `400px minmax(624px, 1fr)` 가 6 페이지 모두 동일 — 정책은 사실상 데스크톱 전용. CLAUDE.md 에는 "1024 + 400/624 통일"만 적혀있고 sub-1024 깨짐 정책은 없음. **선택 A (명시) 권장** — 로컬 도구 성격이라 모바일/태블릿 서포트는 ROI 낮음. |
| P0-2 `--radius-md` 미정의 | **검증 (Claude 독립으로 못 잡음)** | `globals.css` 에는 `--radius` / `--radius-sm` / `--radius-card` / `--radius-lg` / `--radius-xl` / `--radius-full` 만 있음. SystemMetrics 가 spec 19 (chrome 통합) 에서 새로 만들어진 컴포넌트라 token 검증이 누락된 것 — **2026-04-24 audit R1 의 6단계 토큰 결정과 모순**. one-liner fix (`var(--radius)` 또는 `--radius-card`). |
| P0-3 disabled MenuCard | **검증** | "준비중" 카드가 keyboard tab 으로 focus 되면 사용자 혼란. 실제 `disabled` + `aria-disabled` 둘 다 권장. |
| P0-4 StudioUploadSlot keyboard 접근성 | **검증 (Claude 독립으로 못 잡음)** | div 클릭 + hidden file input 패턴. 업로드가 앱 핵심 액션인데 tab focus / Enter / Space 미지원. **선택 A (role+tabIndex+focus-visible) 권장** — 기존 paste hybrid 정책 유지하면서 추가 가능. |
| P0-5 SystemMetrics hover-only | **검증 (Claude 독립으로 못 잡음)** | spec 19 chrome 통합에서 새로 만들었는데 hover only — 키보드 사용자 영구 차단. **focus-within 추가 + aria-expanded 권장**. compact mode (좁은 헤더에서 chip만) 는 P0-1 정책에 따라 결정. |
| P0-6 ProgressModal 취소 버튼 의미 | **검증 (부분 동의)** | router.py 의 `/interrupt` 가 ComfyUI sampling 만 중단함. Edit/Video 5단계 중 (1) 비전 분석 / (2) 프롬프트 정제 / (3) ComfyUI dispatch / (4) 다운로드 단계 별 취소 가능 범위가 다른데 UI 는 단일 버튼. **단계별 disabled 토글 + 라벨 정밀화 권장.** |

### 11.2 Codex 리뷰에 대한 동의 (P1/P2)

| 항목 | Claude 검증 | 코멘트 |
|------|-------------|--------|
| P1-1 paste listener 중앙화 | **동의** | spec 의 hybrid 정책 (호버 슬롯 우선 + 페이지 fallback) 자체는 좋지만 구현이 페이지마다 흩어짐. `useImagePasteTarget(activeSlotId)` hook 권장. |
| P1-2 inline style → CSS module | **동의 + 보강** | Claude 독립 리뷰에서도 generate page 만 30+ 인라인 객체 발견 (11.3-D 참고). 단순 정리가 아니라 **prop 참조 안정성 → 자식 리렌더 감소** 효과도 큼. |
| P1-3 메인 메뉴 3열 고정 | **동의** | P0-1 데스크톱 정책 결정 후 적용 |
| P1-4 결과 카드 hover-only action | **동의** | `ResultHoverActionBar` 는 hover 만. `focus-within` 추가 권장. 2026-04-24 메뉴 UX v2 통일 때 만든 공용 컴포넌트라 한 곳만 고치면 4페이지 적용. |
| P1-5 VisionResultCard 정보 밀도 | **동의** | 9 슬롯 (Vision Recipe v2.1) UI 가 1024px 에서 빡빡. P0-1 결정과 묶어서. |
| P1-6 색상/아이콘 token | **동의** | spec 19 의 위험 그라데이션 (#DC2626) 은 의미 색상이라 token 화 가치. emoji icon (☀️ 등) 은 lucide 로 교체 검토. |

### 11.3 Codex가 다루지 않은 항목 (Claude 추가 발견)

Codex 리뷰는 **UX/접근성/정책** 관점이 강하지만 **코드 중복/성능/타입 안전 갭** 은 약하게 다룸. Claude 독립 리뷰에서 잡은 보완 항목:

#### A. SSE 스트림 처리 3 hook 중복 (P0)
**파일**: `hooks/useGeneratePipeline.ts` · `useEditPipeline.ts` · `useVideoPipeline.ts`
**문제**: 세 hook 의 `for await (const evt of generator())` 루프가 거의 동일 — `sampling` / `step` / `stage` / `done` / `error` 이벤트 분기 70% 중복. spec 19 ollama race fix 시 세 곳 모두 finally 블록 보강 필요했던 게 신호.
**수정안**: `usePipelineStream<TMode>(generator, handlers)` 추상화. 모드별 차이 (response 형태, store update) 만 콜백 prop. 80+ 줄 중복 제거 + 향후 SSE 이벤트 추가 시 일관 적용.
**우선순위**: P0급 (Codex 가 P1-1 router 분리 강조한 것과 대칭 — 프론트엔드 핵심 추상화).

#### B. 진행 모달 트리거 4페이지 반복 (P1)
**파일**: `app/{generate,edit,video,vision}/page.tsx`
**문제**: `progressOpen` + `prevGenerating` + `useEffect` close 타이머 8줄 보일러플레이트가 4페이지에서 정확히 반복.
**수정안**: `useAutoCloseModal(active, delayMs)` 훅 (30분 작업).
**효과**: 32줄 중복 제거 + 모달 close 타이밍 일관성.

#### C. textarea autoGrow 3페이지 반복 (P2)
**파일**: `app/{generate,edit,video}/page.tsx`
**문제**: `promptTextareaRef` + `autoGrow()` + `useEffect([prompt])` 8줄이 3곳 반복.
**수정안**: `useAutoGrowTextarea(value)` (15분).

#### D. 페이지 루트 의존성 폭발 → 자식 리렌더 (P1)
**파일**: `app/generate/page.tsx:59-118`
**문제**: useState 5개 + Zustand 구독 18개 = **23개 dependency**. `style={{...}}` 객체 30+ 개 인라인 생성 → 매 렌더마다 새 ref → memo 깨짐. SizeCard / PromptCard / HistoryGallery 가 prop 변경 없는데 함께 리렌더.
**수정안**:
1. LeftPanel / RightPanel 컴포넌트 분리 (필요한 store slice 만 구독)
2. 인라인 style → globals.css 토큰 class (Codex P1-2 와 같은 방향, 다른 동기)
3. Zustand 선택자 그룹화: `useGenerateInputs()` selector hook (보일러 18줄 → 1줄)

#### E. mode 타입 union 부재 (P2)
**파일**: `frontend/lib/api/types.ts`, 4 hook, ProgressModal
**문제**: `HistoryItem.mode: string` (free string), ProgressModal `mode?: "generate"|"edit"|"video"|"vision"` 가 컴포넌트 prop 만 union, store/API 는 string. typo 시 컴파일 통과.
**수정안**: `type StudioMode = "generate"|"edit"|"video"|"vision"` 단일 정의 → API/Store/UI 일관 사용. backend 의 Codex/Claude 권장 `Mode = Literal[...]` 와 한쌍.

#### F. HistoryGallery 가상화 부재 (P2)
**파일**: `components/studio/HistoryGallery.tsx`
**문제**: height-aware Masonry 갤러리에서 100+ 타일 모두 DOM 생성. 사용자가 100건 이상 누적되면 스크롤 끊김. 현재 4페이지가 페이지 자연 스크롤로 갤러리 노출 → render 압박.
**수정안**: `react-window` 또는 IntersectionObserver 기반 lazy mount. P0-1 데스크톱 정책 확정 후.

#### G. Zustand persist v2→v3 migrate 누적 (P2)
**파일**: `useGenerateStore` (v2→v3, steps/cfg/seed 제거), `useSettingsStore` (v2→v3, hideGeneratePrompts 분리)
**문제**: migrate 함수가 store 안에 인라인. 다음 migrate (v3→v4) 때 누적 분기 — 각 store 별 5+ 회 누적 가능.
**수정안**: `lib/store-migrations/{generate,settings}.ts` 모듈 분리. P2 — 당장 위험 없음.

#### H. 호버 스타일 핸들러 4 CTA 반복 (P2)
**파일**: `app/{generate,edit,video,vision}/page.tsx` 메인 CTA 버튼
**문제**: `onMouseEnter` / `onMouseLeave` 가 `e.currentTarget.style.background = "var(--accent-ink)"` 식으로 인라인 mutation. 4 페이지 동일.
**수정안**: CSS `:hover` 우선 (가장 간단) 또는 `useHoverStyle()` 훅. CSS 만으로 충분 (Codex P1-2 의 inline style 정리 와 한쌍).

### 11.4 우선순위 통합 추천 (Codex Step 1-4 + Claude 추가)

```text
Step 0 (즉시 — 1일):
  P0-2 --radius-md 토큰 fix (5분)
  P0-3 MenuCard disabled 속성 (15분)
  P0-4 StudioUploadSlot tabIndex+role+focus-visible (1h)
  P0-5 SystemMetrics focus-within + aria-expanded (1h)
  P0-6 ProgressModal 취소 버튼 단계별 가시성 (2h)

Step 1 (정책 결정 — 0.5일):
  P0-1 데스크톱-only 정책 명시 (README + StudioLayout 주석)
   ↓ 정책 확정 후 Step 2 진행
  + Claude D (의존성 폭발) 의 핵심 결정 — 분리 vs 유지

Step 2 (구조 — 1주):
  Claude A: usePipelineStream 추상화 (4-6h)
   - SSE 이벤트 추가 시 4 hook 일관 적용 효과 큼
  Claude B: useAutoCloseModal (30m)
  Claude C: useAutoGrowTextarea (15m)
  Claude H: 호버 :hover CSS 전환 (1h, P1-2 inline → css 의 일부)
  P1-1 paste listener 중앙화 (3-4h)
  P1-4 ResultHoverActionBar focus-within (1h, 4 페이지 자동 전파)

Step 3 (drift 차단 — 2-3일):
  Claude E: StudioMode 단일 union (2h)
  P1-2 inline → CSS module (3-4일, 점진)
  P1-6 색상 token 정리 (1일)

Step 4 (최적화 — 1-2일):
  Claude D: 페이지 루트 분리 (LeftPanel/RightPanel) (1일)
  Claude F: HistoryGallery 가상화 (4-6h)
  P2-1 디자인 시스템 문서 (선택)
  P2-2 visual regression /dev/ui-lab (선택)
```

### 11.5 Codex 리뷰 신뢰도 평가

| 차원 | 평가 |
|------|------|
| 접근성 (a11y) 포착 | **우수** — P0-3/4/5 모두 Claude 독립 리뷰에서 못 잡음 |
| UX 정책 사고 | **우수** — 데스크톱-only 정책 명시 / 진행 취소 의미 정밀화 |
| 디자인 토큰 검증 | **우수** — `--radius-md` 미정의 같은 진짜 버그 포착 |
| 반응형 정책 | **우수** — Claude 리뷰는 코드 구조 위주라 viewport 관점 약함 |
| 코드 중복 / hook 추상화 | 보강 필요 — SSE 스트림 3 hook 중복 / 진행 모달 트리거 4 반복 미언급 |
| 성능 / 리렌더 | 보강 필요 — 인라인 style 30+ 객체의 prop ref 불안정 미언급 (Codex 는 maintenance 관점만) |
| 타입 안전 | 보강 필요 — `mode` union 부재 / discriminated union 관점 누락 |

**결론**: Codex UI 리뷰는 **사용자 경험과 접근성 관점이 압도적**. Claude 독립 리뷰는 **코드 구조와 추상화 기회 관점이 강함**. 두 리뷰는 직교(orthogonal) 적이라 병합 가치가 매우 큼. 11.4 통합 순서대로 진행 시 거의 모든 항목이 자연스럽게 한 번에 처리됨 (예: P1-2 inline style 정리 + Claude D 페이지 분리 + Claude H 호버 CSS = 한 작업 단위).

### 11.6 미해결/오빠 결정 필요

```text
Open questions for human reviewer:

1. P0-1 viewport 정책:
   - 선택 A (데스크톱-only 명시) — Claude 추천
   - 선택 B (반응형 baseline) — Codex 단기 추천
   - 사용자 의지: 16GB VRAM 로컬 도구라 모바일 ROI 낮음 → A 권장?

2. Claude D 페이지 분리:
   - generate page.tsx 1,800+ 줄 자체 분해할지?
   - 분해 시 store hook 재구성 부담 vs 유지 시 리렌더 비용 — TDD 점진 권장?

3. Claude A SSE 추상화:
   - 4 페이지 hook 통합 vs 개별 유지?
   - spec 19 처럼 race fix 가 4 hook 동시 수정 필요할 때 통합 가치 큼.
   - 단, 추상화 시 mode 별 done 처리 분기 콜백 늘어 복잡도 증가 가능.

4. Codex P2-2 (Storybook/ui-lab):
   - 우선순위 가장 낮음 — 다음 분기 작업?
```


