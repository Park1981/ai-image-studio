# AI Image Studio UI Consistency Audit

**작성일**: 2026-04-24  
**상태**: P0+P1a+P1b+R1+R2+R3 완료 · 디자인 시스템 중추 완성 (판매 퀄리티 도달)  
**범위**: 메뉴별 기능 차이를 제외한 디자인/레이아웃/상태 표현 일관성 검토  
**대상 화면**:
- `/generate` Image Generate
- `/edit` Image Edit
- `/vision` Vision Analyze
- `/vision/compare` Vision Compare
- `/video` Video Generate

---

## 1. 목적

현재 프로젝트는 기능적으로 거의 완성 단계지만, 메뉴별로 결과 영역, 입력 이미지 영역, 진행 표시, empty/loading/filled 상태 표현이 조금씩 다르게 구현되어 있다.

이 문서는 바로 수정하기 전에 다음을 명확히 하기 위한 분석 문서다.

1. 어떤 UI 차이는 기능 차이 때문에 필요한가.
2. 어떤 UI 차이는 우연히 생긴 불일치인가.
3. 진행 모달, 프로세스바, 자동 처리 단계, 결과 카드, 이미지 드롭존이 현재 어떤 규칙으로 구현되어 있는가.
4. 이후 수정한다면 어떤 순서와 기준으로 통일하는 것이 좋은가.

---

## 2. 판단 기준

디자인 일관성은 모든 화면을 똑같이 만드는 것이 아니다. 기능 차이가 있는 부분은 달라야 한다. 다만 다음 항목은 메뉴가 달라도 같은 규칙을 가져야 한다.

| 영역 | 통일되어야 하는 이유 |
|---|---|
| 페이지 기본 레이아웃 | 사용자가 메뉴를 이동해도 위치 감각이 유지되어야 함 |
| 입력 카드 empty/filled/drag 상태 | 이미지 업로드 경험이 메뉴마다 달라 보이면 혼란이 생김 |
| 결과 영역 헤더 | 현재 화면에서 무엇을 보고 있는지 즉시 알 수 있어야 함 |
| 결과 카드 shell | 이미지, 영상, 텍스트 결과가 같은 앱의 결과물처럼 보여야 함 |
| 진행 모달 | 실행 중 피드백은 메뉴별로 신뢰 수준이 같아야 함 |
| 진행률 표시 | 실제 progress인지, 추정 progress인지, 단순 busy인지 구분되어야 함 |
| CTA running 상태 | 사용자가 실행 중임을 같은 방식으로 인지해야 함 |
| Empty/Loading 상태 | 결과가 없는 상태와 처리 중 상태의 밀도와 높이가 비슷해야 함 |

---

## 3. 전체 요약

### 3.1 주요 발견

1. 진행 UI가 메뉴별로 4갈래로 나뉘어 있다.
   - `ProgressModal`
   - `AnalysisProgressModal`
   - `PipelineSteps`
   - 결과 카드 내부 loading/progress

2. `Image Edit`와 `Video Generate`는 진행 정보를 중복 표시한다.
   - 좌측 `PipelineSteps`
   - 실행 시 뜨는 `ProgressModal`
   - Video는 추가로 `VideoPlayerCard` 내부 progress bar까지 있음

3. `Vision Analyze`와 `Vision Compare`의 진행 모달 progress는 실제 백엔드 progress가 아니다.
   - running 중 `66%` 또는 `50%` 고정
   - 완료 시 `100%`
   - 실제 단계 진행과 연결되어 있지 않음

4. 이미지 드롭존은 empty 상태 색상은 어느 정도 통일됐지만, filled 상태가 다르다.
   - `SourceImageCard`는 업로드 후 이미지 배경이 검정 `#111`
   - `CompareImageSlot`은 업로드 후 배경이 warm neutral `var(--bg-2)`

5. 결과 영역은 메뉴별로 헤더 위치와 카드 구조가 다르다.
   - Generate/Edit: 결과 헤더 없음
   - Video/Vision: 우측 상단에 별도 결과 헤더 있음
   - Compare: 카드 내부 헤더 있음

6. Empty 상태의 높이, padding, radius가 메뉴마다 다르다.
   - Generate empty는 비교적 큰 점선 카드
   - Edit empty는 `minHeight: 56`으로 훨씬 낮음
   - Vision/Video empty는 각 컴포넌트 내부에서 별도 구현
   - Compare empty는 큰 패널 내부 중앙 안내

### 3.2 결론

기능 차이를 제외해도 디자인 일관성 개선 여지가 크다.

특히 우선순위가 높은 것은 다음 3개다.

1. 이미지 입력 카드 filled 상태의 검은 배경 제거 또는 정책화
2. 진행 UI 중복 정리
3. 결과 영역 공통 shell/header/empty/loading 규칙 도입

---

## 4. 진행 UI 상세 분석

### 4.1 현재 진행 UI 구성

| 메뉴 | 실행 상태 소스 | 모달 | 좌측 단계 표시 | 결과 카드 로딩 | 진행률 성격 |
|---|---|---|---|---|---|
| Image Generate | `useGenerateStore.generating/progress/stage` | `ProgressModal` | 없음 | 없음 | stream stage progress |
| Image Edit | `useEditStore.running/currentStep/stepDone/pipelineProgress` | `ProgressModal` | `PipelineSteps` | 없음 | step progress + backend pipeline progress 혼재 |
| Video Generate | `useVideoStore.running/currentStep/stepDone/pipelineProgress` | `ProgressModal` | `PipelineSteps` | `VideoPlayerCard` progress bar | backend pipeline progress |
| Vision Analyze | `useVisionStore.running` | `AnalysisProgressModal` | 없음 | `VisionResultCard` loading | fixed pseudo progress |
| Vision Compare | `useVisionCompareStore.running` | `AnalysisProgressModal` | 없음 | `AnalysisPanel` loading | fixed pseudo progress |

### 4.2 `ProgressModal`

사용처:
- `frontend/app/generate/page.tsx`
- `frontend/app/edit/page.tsx`
- `frontend/app/video/page.tsx`

파일:
- `frontend/components/studio/ProgressModal.tsx`

특징:
- 생성/수정/영상 모드를 하나의 컴포넌트에서 분기한다.
- header, status strip, timeline 구조가 있다.
- ComfyUI interrupt 취소 버튼이 있다.
- Edit/Video 모드 내부에는 실제 가로 progress bar가 있다.

문제:
- Generate 모드는 status strip에 `%`만 있고, 모달 본문 상단에는 가로 progress bar가 없다.
- Edit 모드 status strip의 `%`는 `stepDone / 4` 기반이다.
- Edit 모드 본문 progress bar는 `pipelineProgress` 기반이다.
- 즉, 같은 모달 안에서도 상단 숫자와 내부 bar가 서로 다른 기준을 가질 수 있다.

코드 근거:
- `frontend/components/studio/ProgressModal.tsx`
  - `StatusBar` progress 계산: `mode === "edit" ? Math.round((editStepDone / 4) * 100) : ...`
  - `EditTimeline` 내부 bar: `pipelineProgress`
  - `VideoTimeline` 내부 bar: `pipelineProgress`

권장 방향:
- 모든 모드에서 status strip의 `%`와 본문 progress bar 기준을 통일한다.
- Generate에도 모달 내부 progress bar를 넣거나, 반대로 모든 모드에서 progress bar를 status strip 바로 아래 공통 위치로 빼는 것이 좋다.
- `stepDone`은 단계 상태 표시에만 쓰고, 전체 진행률은 `pipelineProgress` 또는 stream progress 한 기준으로 통일하는 편이 낫다.

---

### 4.3 `AnalysisProgressModal`

사용처:
- `/vision`
- `/vision/compare`

파일:
- `frontend/components/studio/AnalysisProgressModal.tsx`

특징:
- Vision/Compare 전용 모달이다.
- `ProgressModal`과 유사한 header, elapsed, progress bar, step list 구조를 가진다.
- 취소 버튼은 없다.

문제:
- progress가 실제 진행률이 아니다.
- running 중 progress는 고정값이다.
  - Vision: `66%`
  - Compare: `50%`
- step state도 실제 단계와 연결되어 있지 않다.
  - 첫 단계는 항상 done
  - 두 번째 단계는 항상 active
  - 나머지는 pending
- 비교 분석은 실제 백엔드에서 A/B를 각각 별도 분석하지 않고 두 이미지를 한 번에 vision 모델에 전달한다. 현재 단계명은 그 사실과는 맞지만, UI 상태는 실제 단계 이벤트를 반영하지 않는다.

코드 근거:
- `frontend/components/studio/AnalysisProgressModal.tsx`
  - `const progress = running ? (mode === "compare" ? 50 : 66) : 100`
  - `const done = !running || i === 0`
  - `const active = running && i === 1`

권장 방향:
- 실제 진행 이벤트가 없다면 percent bar 대신 indeterminate/busy bar가 더 정직하다.
- 또는 progress 숫자를 제거하고 `분석 중`, `결과 정리 중` 같은 상태 중심으로 표현한다.
- 실제 단계 이벤트를 추가할 계획이 있다면 backend/API/store에 progress event를 설계한 뒤 연결해야 한다.

---

### 4.4 `PipelineSteps`

사용처:
- `/edit`
- `/video`

파일:
- `frontend/components/studio/PipelineSteps.tsx`

특징:
- 좌측 패널 안에서 자동 처리 단계를 보여준다.
- `stepDone`, `currentStep`, `running`에 따라 done/running/pending 표시를 한다.
- green-soft 배경으로 꽤 눈에 띈다.

문제:
- 실행 중 `ProgressModal`에도 같은 단계 목록이 나온다.
- 따라서 실행 시 좌측과 모달이 동시에 같은 정보를 보여준다.
- 특히 Edit는 사용자가 수정 지시를 입력하는 좌측 패널에 단계 카드가 항상 있어 입력 작업보다 진행 설명이 크게 보일 수 있다.
- Video도 같은 중복에 더해 결과 카드 내부 progress bar까지 생긴다.

코드 근거:
- `frontend/app/edit/page.tsx`에서 `PipelineSteps` 렌더
- `frontend/app/video/page.tsx`에서 `PipelineSteps` 렌더
- 실행 시 각각 `ProgressModal` 자동 오픈

권장 방향:
- 실행 전: `PipelineSteps`는 작고 조용한 “예정 단계 안내”로만 표시
- 실행 중: 상세 진행은 모달에서만 표시
- 완료 후: 좌측 단계 카드는 접거나 완료 요약만 표시
- 또는 `PipelineSteps` 자체를 “상세 보기” 접힘 섹션으로 바꾼다.

---

### 4.5 결과 카드 내부 loading

사용처:
- `VisionResultCard`
- `VideoPlayerCard`
- Vision Compare `AnalysisPanel`

문제:
- 모달이 떠 있는데 결과 카드 내부에서도 또 loading 상태를 보여준다.
- 이 자체는 나쁘지 않지만, 디자인 정책이 필요하다.

권장 정책:
- 모달: 전체 작업의 상세 진행
- 결과 카드 내부 loading: 모달을 닫았거나 배경 진행 중일 때의 간단한 placeholder
- 따라서 카드 내부 loading은 가볍고 낮은 밀도로 유지하고, progress bar는 한 곳에만 두는 편이 좋다.

---

## 5. 이미지 입력/드롭존 상세 분석

### 5.1 공통 드롭존 empty 상태

현재 empty 상태는 최근 수정으로 어느 정도 통일됐다.

공통 톤:
- 기본 배경: `var(--bg-2)`
- drag 배경: `#F1EEE8`
- 기본 dashed border: `#D4CEC0`
- drag border: `#BDB6AA`

사용처:
- `SourceImageCard`
- `CompareImageSlot`

이 방향은 warm neutral 디자인과 맞다.

---

### 5.2 업로드 후 filled 상태 차이

`SourceImageCard`:
- 이미지 카드 높이: `height: 256`
- 카드 배경: `var(--bg-2)`
- 이미지 태그 배경: `#111`
- 하단 검은 그라디언트 overlay
- 변경/해제/정보 버튼이 검은 반투명 overlay 위에 배치

`CompareImageSlot`:
- 카드 최소 높이: `minHeight: 140`
- 카드 배경: `var(--bg-2)`
- 이미지 태그에는 별도 검은 배경 없음
- 메타/버튼만 검은 반투명 pill 사용

문제:
- 일반 이미지 입력 카드에서 업로드 후 검은 레터박스가 생길 수 있다.
- 같은 이미지 업로드 경험인데 비교 메뉴는 warm neutral, 수정/비전/영상은 검은 배경으로 보여 톤이 다르다.
- 검은 overlay는 배지 가독성에는 좋지만, 현재 앱의 warm neutral 톤과는 강하다.

코드 근거:
- `frontend/components/studio/SourceImageCard.tsx`
  - `<img>` style에 `background: "#111"`
  - 하단 overlay `linear-gradient(to top, rgba(0,0,0,.55)...)`
- `frontend/components/studio/CompareImageSlot.tsx`
  - filled shell background `var(--bg-2)`
  - `<img>`에는 검은 배경 없음

권장 방향:
- 이미지 입력 카드의 레터박스 배경은 `var(--bg-2)`로 통일한다.
- 메타 배지는 검은 pill을 유지할 수 있지만 opacity를 낮추거나, surface pill로 바꾸는 것을 검토한다.
- 영상 플레이어의 검은 배경은 미디어 특성상 허용 가능하다.

---

## 6. 결과 영역 상세 분석

### 6.1 결과 헤더 불일치

| 메뉴 | 결과 헤더 | 위치 |
|---|---|---|
| Image Generate | 없음 | 결과 이미지가 바로 표시 |
| Image Edit | 없음 | Before/After가 바로 표시 |
| Video Generate | 있음: `영상 결과` | 우측 패널 상단 |
| Vision Analyze | 있음: `분석 결과` | 우측 패널 상단 |
| Vision Compare | 있음: `비교 뷰어`, `5축 비교 분석` | 각 카드 내부 |

문제:
- 메뉴 진입 헤더는 공통화됐지만, 우측 결과 영역의 정보 구조는 아직 통일되지 않았다.
- Generate/Edit는 결과가 무엇인지 헤더 없이 이미지 자체로만 판단한다.
- Video/Vision은 별도 헤더가 있어 더 명확하다.
- Compare는 카드 내부 헤더라 구조가 또 다르다.

권장 방향:
- 모든 메뉴 우측 상단에 `StudioResultHeader` 같은 공통 헤더를 둔다.
- 카드 내부 제목은 보조 제목으로만 사용한다.
- 예:
  - Generate: `Result Image`
  - Edit: `Edit Result`
  - Video: `Video Result`
  - Vision: `Analysis Result`
  - Compare: `Compare Result`

---

### 6.2 카드 shell 불일치

현재 결과 카드 shell은 각 컴포넌트가 직접 들고 있다.

| 컴포넌트 | radius | padding | 특징 |
|---|---:|---:|---|
| `GenerateResultViewer` | 14 | 없음 | 이미지 자체가 카드 |
| `BeforeAfterSlider` | 14 | 없음 | 슬라이더 자체가 카드 |
| `VideoPlayerCard` | 14 | loading/empty/filled 각각 다름 | filled는 footer 있음 |
| `VisionResultCard` | 14 | loading/empty/filled 각각 다름 | filled는 header tab 있음 |
| Compare `ViewerPanel` | 16 | 14 | 패널 안에 viewer |
| Compare `AnalysisPanel` | 16 | 16 | 패널 안에 분석 결과 |

문제:
- radius 14와 16이 섞여 있다.
- 어떤 것은 결과 media 자체가 카드이고, 어떤 것은 외부 패널 안에 media가 들어간다.
- 사용자가 느끼기에는 결과 영역의 무게감이 메뉴마다 달라진다.

권장 방향:
- `StudioResultCard` shell을 만든다.
- shell 토큰:
  - `background: var(--surface)`
  - `border: 1px solid var(--line)`
  - `borderRadius: 14` 또는 전역 토큰 하나
  - `boxShadow: var(--shadow-sm)`
  - `overflow: hidden`
- Compare처럼 내부 패널이 필요한 경우에도 shell 스타일을 같은 컴포넌트로 맞춘다.

---

### 6.3 Empty 상태 불일치

| 메뉴/컴포넌트 | Empty 방식 |
|---|---|
| Generate | 점선 카드, padding 28 |
| Edit | 점선 카드, `minHeight: 56`, padding 16 |
| VideoPlayerCard | 점선 카드, padding 28 |
| VisionResultCard | 점선 카드, padding 28 |
| Compare Viewer | 큰 패널 내부 중앙 안내 |
| Compare Analysis | 패널 내부 중앙 안내 |
| HistoryGallery | 별도 점선 카드 |

문제:
- Empty 상태가 같은 의미인데 시각 밀도가 다르다.
- Edit empty는 유독 낮아서 결과 영역이 갑자기 줄어든 것처럼 보일 수 있다.
- Compare empty는 별도 큰 패널이라 안정적이지만, 다른 메뉴와 높이 정책이 다르다.

권장 방향:
- `StudioEmptyState`를 공통화한다.
- props:
  - `icon`
  - `title`
  - `description`
  - `size`: `"compact" | "normal" | "panel"`
- Generate/Edit/Video/Vision은 `normal`, Compare viewer는 `panel`, 작은 보조 영역은 `compact`처럼 명시한다.

---

### 6.4 Loading 상태 불일치

| 메뉴/컴포넌트 | Loading 방식 |
|---|---|
| Generate | CTA 버튼 내부 progress, 모달 |
| Edit | CTA spinner, 좌측 단계, 모달 |
| Video | CTA spinner + %, 좌측 단계, 모달, 결과 카드 progress |
| Vision | 결과 카드 spinner, 모달 |
| Compare | 분석 패널 spinner-like icon, 모달 |

문제:
- loading 피드백 위치가 너무 다양하다.
- Video는 동일 진행률이 여러 곳에 보인다.
- Compare 분석 패널은 `Icon name="refresh" className="spin"`을 사용하고, 다른 곳은 `Spinner`를 쓴다.

권장 방향:
- `StudioLoadingState`를 만든다.
- spinner는 `Spinner`로 통일한다.
- 결과 카드 내부 loading은 간단 메시지 중심으로 유지한다.
- 실제 progress bar는 모달 또는 CTA 중 하나만 주 primary로 정한다.

---

### 6.5 액션 위치 불일치

| 결과 타입 | 액션 위치 |
|---|---|
| Generate image | hover action bar |
| Edit before/after | hover action bar |
| Video | 항상 보이는 footer buttons |
| Vision text | 상단 우측 copy button |
| Compare analysis | 별도 copy/action 없음 |

해석:
- 미디어 결과는 hover action bar가 자연스럽다.
- 텍스트 결과는 상단 copy가 자연스럽다.
- 영상은 native controls 때문에 hover action bar보다 footer가 자연스럽다.

따라서 이 차이는 기능 차이로 인정 가능하다.

다만 버튼 스타일, 위치, 라벨 정책은 통일할 수 있다.

권장 방향:
- `StudioResultActions` 슬롯을 정의한다.
- media overlay, footer, header-right 같은 위치만 variant로 둔다.
- 버튼 컴포넌트는 `ActionBarButton` 또는 `SmallBtn` 중 하나로 정리한다.

---

## 7. CTA 실행 상태 분석

### 7.1 현재 차이

| 메뉴 | 실행 중 CTA 표시 |
|---|---|
| Generate | 버튼 내부에 흰 progress overlay + stage + percent |
| Edit | spinner + `처리 중...` |
| Video | spinner + `처리 중... {percent}%` |
| Vision | spinner + `분석 중...` |
| Compare | spinner + `분석 중...` |

문제:
- Generate만 버튼 안에 progress bar가 있다.
- Video는 percent 텍스트가 있고 Edit는 없다.
- Vision/Compare는 분석 작업인데 모달 progress는 pseudo progress다.

권장 방향:
- CTA에는 상세 progress를 넣지 않고 `Spinner + 실행 중 라벨` 정도로 통일한다.
- 상세 progress는 모달에 집중한다.
- 단, Generate처럼 매우 빠른 작업이라 모달을 닫아도 진행감이 필요하면 버튼 내부 progress는 모든 stream 기반 작업에 같은 규칙으로 적용한다.

---

## 8. 색상/타이포그래피/라운딩 분석

### 8.1 색상

좋아진 점:
- 전역 palette는 warm neutral로 정리되어 있다.
- 드롭존 empty/drag 색상은 warm neutral로 맞춰졌다.

남은 문제:
- `SourceImageCard`의 filled 상태 검은 배경
- media overlay에서 `rgba(0,0,0,...)`가 여러 강도로 존재
- 일부 CTA disabled 색상이 `#B9CEE5`로 blue-gray에 가까워 warm neutral 톤과 살짝 다름

권장 방향:
- 일반 이미지/텍스트 카드에는 warm neutral 사용
- 영상 플레이어, 라이트박스, hover overlay처럼 어두운 배경이 기능적으로 필요한 곳만 dark 사용
- disabled CTA 색상도 token화

### 8.2 타이포그래피

좋아진 점:
- 메뉴 타이틀은 영어 display 폰트로 통일됐다.
- 설명은 한글 sans로 유지되어 이해가 쉽다.

남은 문제:
- 일부 컴포넌트에 negative letter spacing이 남아 있다.
- 개발 지침상 새 UI는 letter spacing 0이 안전하다.

영향:
- 큰 문제는 아니지만, 메뉴별 작은 텍스트 밀도가 다르게 느껴질 수 있다.

권장 방향:
- 새 공통 컴포넌트부터 `letterSpacing: 0` 원칙 적용
- 기존 negative spacing은 리팩터 시 자연스럽게 제거

### 8.3 라운딩

현재 radius:
- 10, 12, 14, 16이 섞여 있다.

해석:
- 버튼/작은 pill/카드/모달을 구분하려는 의도는 보인다.
- 다만 결과 카드 shell에는 14와 16이 섞여 있어 통일감이 떨어진다.

권장 토큰:
- small controls: 8
- input/dropzone/card: 12 또는 14 중 하나
- modal/shell: 16
- pill: 999

결과 카드만큼은 하나로 맞추는 것이 좋다.

---

## 9. 메뉴별 상세 평가

### 9.1 Image Generate

좋은 점:
- 결과 이미지 자체의 비율 유지가 좋다.
- hover action bar가 이미지 중심 작업에 잘 맞는다.
- CTA 내부 progress는 생성 작업의 진행감을 준다.

문제:
- 결과 영역 헤더가 없다.
- 모달 내부에는 Generate 전용 progress bar가 없다.
- empty 상태가 로컬 inline 카드로 구현되어 공통 컴포넌트가 아니다.

권장:
- `Result Image` 헤더 추가
- Generate도 모달 내부 progress 위치 통일
- Empty 상태 공통화

### 9.2 Image Edit

좋은 점:
- Before/After 결과 뷰어는 기능적으로 직관적이다.
- 비교 분석 카드가 결과 아래 붙어 있어 편집 결과 평가 흐름은 좋다.

문제:
- 좌측 `PipelineSteps`와 실행 모달이 중복된다.
- 결과 헤더가 없다.
- empty 상태 높이가 낮아 다른 메뉴보다 가벼워 보인다.
- `SourceImageCard` filled 상태 검은 배경 영향이 크다.

권장:
- 좌측 단계 카드를 실행 전 안내용으로 축소
- 실행 중 상세는 모달 중심
- `Edit Result` 헤더 추가
- input image filled 스타일 warm neutral로 통일

### 9.3 Vision Analyze

좋은 점:
- 결과 헤더가 있다.
- 텍스트 결과 카드의 header/tab/copy 구조가 명확하다.

문제:
- `AnalysisProgressModal` progress가 실제 progress가 아니다.
- `VisionResultCard` loading도 동시에 표시되어 정보가 중복될 수 있다.
- 긴 텍스트 결과의 max height/scroll 정책이 비교 분석 패널과 다르다.

권장:
- 분석 모달은 busy/indeterminate 표현으로 변경
- 텍스트 결과 본문에는 max-height + overflow 정책 도입
- `VisionResultCard`를 공통 result shell 기반으로 리팩터

### 9.4 Vision Compare

좋은 점:
- `ViewerPanel`과 `AnalysisPanel`이 명확히 나뉘어 있다.
- 결과 영역 높이가 안정적이다.
- 분석 패널 내부 scroll 정책이 있다.
- 이미지 슬롯 empty 색상은 warm neutral로 잘 맞는다.

문제:
- 진행 모달 progress가 실제 progress가 아니다.
- 비교 viewer/result 헤더가 카드 내부에 있어 다른 메뉴의 우측 결과 헤더 구조와 다르다.
- `CompareImageSlot`은 `SourceImageCard`와 별도 구현이라 중복이 있다.

권장:
- 우측 상단 공통 `Compare Result` 헤더 도입 검토
- 내부 카드는 `Viewer`, `Analysis` 보조 제목으로 유지
- `SourceImageCard`와 `CompareImageSlot`의 upload shell 공통화

### 9.5 Video Generate

좋은 점:
- 영상 결과 헤더가 있다.
- 영상 player footer action은 기능적으로 자연스럽다.
- 영상 결과는 `VideoPlayerCard`로 분리되어 있다.

문제:
- 진행 표시가 가장 중복된다.
  - 좌측 `PipelineSteps`
  - `ProgressModal`
  - `VideoPlayerCard` loading progress
  - CTA percent
- 영상 preview/player 배경 검정은 자연스럽지만, 다른 이미지 카드의 검정과 정책 구분이 필요하다.
- VRAM 주의 배너가 좌측에서 꽤 큰 시각 요소라 단계 카드와 함께 화면이 복잡해질 수 있다.

권장:
- 실행 중 progress primary 위치를 모달 하나로 정리
- 결과 카드 loading은 단순 메시지로 축소
- CTA는 spinner + label 정도로 통일
- VRAM 배너는 접힘 또는 더 조용한 warning style 검토

---

## 10. 권장 리팩터 방향

### 10.1 공통 컴포넌트 후보

#### `StudioResultHeader`

목적:
- 우측 결과 영역의 제목/메타/action slot 통일

예상 props:
- `title`
- `meta`
- `actions`

적용:
- Generate: `Result Image`
- Edit: `Edit Result`
- Vision: `Analysis Result`
- Compare: `Compare Result`
- Video: `Video Result`

#### `StudioResultCard`

목적:
- 결과 카드 shell 통일

예상 props:
- `children`
- `padding`
- `overflow`
- `minHeight`
- `variant`: `"media" | "text" | "panel"`

#### `StudioEmptyState`

목적:
- empty 안내 UI 통일

예상 props:
- `icon`
- `title`
- `description`
- `size`: `"compact" | "normal" | "panel"`

#### `StudioLoadingState`

목적:
- 결과 카드 내부 loading 통일

예상 props:
- `title`
- `description`
- `progress`
- `showProgress`

단, progress는 실제 progress가 있을 때만 표시한다.

#### `StudioUploadSlot`

목적:
- `SourceImageCard`와 `CompareImageSlot`의 empty/drag/filled shell 규칙 통일

주의:
- `SourceImageCard`는 상세 info popover가 있고, `CompareImageSlot`은 A/B badge가 있어 완전 동일 컴포넌트가 아닐 수 있다.
- 그래도 shell, dropzone 색상, filled background, badge/action 위치는 공유 가능하다.

---

### 10.2 진행 UI 정책

권장 정책:

1. 모달은 상세 진행의 primary UI다.
2. 좌측 단계 카드는 실행 전 안내 또는 collapsed summary로 제한한다.
3. 결과 카드 loading은 모달을 닫았을 때도 진행 중임을 알리는 lightweight fallback이다.
4. progress percent/bar는 실제 progress가 있을 때만 표시한다.
5. 실제 progress가 없으면 percent를 보여주지 않고 busy/indeterminate로 표현한다.

적용 예:

| 메뉴 | 권장 진행 표시 |
|---|---|
| Generate | 모달: 실제 stream progress, CTA: spinner + stage 간단 표시 |
| Edit | 모달: 실제 pipelineProgress, 좌측: 예정 단계 접힘 |
| Video | 모달: 실제 pipelineProgress, 결과 카드: 간단 loading |
| Vision | 모달: busy/indeterminate, 결과 카드: 간단 loading |
| Compare | 모달: busy/indeterminate, 분석 패널: 간단 loading |

---

## 11. 수정 우선순위 제안

### 검증 결과 (2026-04-24 추가)

본 문서의 §4.2, §4.3, §5.2, §6.1, §6.2, §6.3 주장을 실제 코드로 전부 대조 확인.
- 코드 line number 및 인용구 정확 일치율 95%+ 수준
- 핵심 발견: Video 모달은 StatusBar/본문 bar 모두 `pipelineProgress` 사용으로 이미 일관됨 → **Edit 만 `stepDone/4` 혼재**. 이쪽이 가장 싼 "일관성 win".

따라서 P1a 를 P0 와 같은 라운드로 승격.

### P0: 즉시 체감되는 불일치 (이번 라운드 구현)

1. **`SourceImageCard` 업로드 후 검은 배경 제거** — `background: "#111"` → `var(--bg-2)` (하단 gradient 는 배지 가독성 위해 유지)
2. **Generate/Edit 결과 영역 헤더 추가** — Vision/Video 와 동일한 `h3 + mono meta` 패턴
3. **Edit empty 상태 통일** — `minHeight: 56, padding "16px 20px"` → `padding "28px 20px"` (generate/video/vision 과 동일), minHeight 제거

### P1a: Edit 진행률 기준 통일 (이번 라운드 구현)

1. **`ProgressModal` Edit StatusBar 기준 교체** — `Math.round((editStepDone / 4) * 100)` → `editPipelineProgress` (내부 bar 와 동일 기준)
2. **`AnalysisProgressModal` 가짜 percent 제거** — `66/50/100` 하드코딩 → indeterminate bar + % 숫자 제거. step state 는 단순화 (running 중 1단계 done + 2단계 active 로 유지, 체크리스트는 busy 의 보조 표현 정도로만).

### P1b: 진행 UI 구조 개편 (구현 완료)

1. ✅ Edit/Video 좌측 `PipelineSteps` 가 `running=true` 일 때 compact 1줄 요약으로 자동 전환 (실행 전/후에는 기존 상세 안내 유지)
2. ✅ Video `VideoPlayerCard` loading 내부 progress bar + `{%}` 제거 → spinner + 평균 소요시간 안내로 축소
3. ✅ Video CTA 의 `{percent}%` 제거 → `처리 중…` 만 (Edit 과 통일)

### 라운드 1 (R1): 디자인 토큰 기반 확보 + 작은 개선 묶음 (구현 완료)

판매 퀄리티 목표에 맞춰 라운드 2 공통 shell 리팩터의 **기반**이 되는 토큰·색상·라운딩 체계를 먼저 확정.

**R1-1 Disabled CTA 색상 변수화**
- ✅ `#B9CEE5` 하드코딩 5곳 (generate/edit/video/vision/vision-compare) → `var(--accent-disabled)` 교체
- globals.css 에 `--accent-disabled: #C8D6E8` 신설 (warm neutral 과 조화되는 톤)

**R1-2 Toast radius 토큰화**
- ✅ `ToastHost.tsx` `borderRadius: 10` → `var(--radius)` (12)
- Toast 자체는 이미 warm neutral 적용 완료 상태. 마지막 하드코딩만 정리.

**R1-3 Lightbox 배경 토큰 봉인**
- ✅ `ImageLightbox.tsx` `#000` → `var(--bg-dark)`, `rgba(0,0,0,.45)` → `var(--overlay-dark)`
- 미디어 뷰어 기능성 유지 + 디자인 토큰 체계에 등록
- 남은 `rgba(0,0,0,…)` 4곳은 shadow/gradient 장식 요소로 토큰화 불필요

**R1-4 globals.css body letter-spacing 조정**
- ✅ 전역 `letter-spacing: -0.01em` → `0` 으로 변경
- Pretendard 기본 spacing 이 자연스럽다는 판단 (강한 스타일 필요한 곳만 인라인 명시)
- 기존 컴포넌트 인라인 `-0.005em/-0.01em` 는 체감 미미하여 이번 라운드엔 건드리지 않음

**R1-5 Radius 6단계 토큰 체계 확정**
- ✅ globals.css 에 `--radius-sm(8) / --radius(12) / --radius-card(14) / --radius-lg(16) / --radius-xl(20) / --radius-full(999)` 확정
- ✅ design-tokens.ts 에도 `card: '14px'` 동기화
- 전면 교체는 **라운드 2** 에서 공통 shell 리팩터와 함께 (156 occurrences 주요 항목 잡힘)

**R1-6 Result 이미지 cleanup 확장**
- ✅ `history_db.count_image_ref_usage` 신설 (edit-source 의 `count_source_ref_usage` 와 대칭)
- ✅ `router._result_path_from_url` / `_cleanup_result_file` helper 신설
- path traversal 4-layer 방어:
  1. URL prefix `/images/studio/` 검증
  2. edit-source sub 는 제외 (이중 삭제 방지)
  3. `/` `\` 포함 파일명 거부 (직속만)
  4. 화이트리스트 정규식 (`[0-9a-zA-Z_\-]{1,64}\.(png|jpg|jpeg|webp|mp4)`)
  5. `candidate.parent.resolve() == STUDIO_OUTPUT_DIR.resolve()` 최종 봉인
- image_ref + source_ref 양쪽 모두 0건일 때만 삭제 (Generate → Edit 체인 보호)
- DELETE API 응답: `source_cleaned`, `result_cleaned` (단일), `sources_cleaned`, `results_cleaned` (전체)

**검증**
- pytest 113 → 130 (result cleanup 17건 신규 추가, 전부 통과)
- 프론트 lint clean (수정 파일 기준)

### 별도: edit-source orphan 파일 정리 (구현 완료)

`project_pending_issues.md` 에 남아 있던 "edit-source/*.png cleanup 미구현 (DELETE history 시 파일 잔류)" 해결.

1. ✅ `history_db.delete_item_with_refs` / `clear_all_with_refs` / `count_source_ref_usage` 신설
2. ✅ `router._cleanup_edit_source_file` helper 에서 path traversal 3-layer 방어 (화이트리스트 정규식 + prefix 검증 + `Path.is_relative_to`)
3. ✅ 같은 `source_ref` 참조하는 다른 row 존재 시 파일 보존 (연속 수정 플로우 대응)
4. ✅ pytest 22건 추가 (정규식/경로 변환 방어 케이스) · 총 113/113 통과

### P2 라운드 2 (R2): 공통 shell 5개 신설 + 4개 페이지 교체 (구현 완료)

판매 퀄리티 목표의 핵심 작업. 디자인 시스템 중추가 완성됨.

**R2-1 ~ R2-5 공통 shell 5개 신설**
- ✅ `StudioResultHeader` — h3 + mono meta + optional actions 슬롯
- ✅ `StudioResultCard` — surface + line + radius-card + shadow-sm · media/text/panel variant
- ✅ `StudioEmptyState` — 점선 카드 · normal/compact/panel size
- ✅ `StudioLoadingState` — spinner + title + desc · normal/panel size (percent 는 의도적 제외 · 모달 단일 primary)
- ✅ `StudioUploadSlot` — dropzone shell + filled shell 공통 · badge/action 은 children slot
  (사용처 교체는 R3 에서 · 자산만 먼저 완성)

**R2-6 ~ R2-10 페이지 교체**
- ✅ Generate/Edit/Video/Vision 4개 페이지 헤더 → `StudioResultHeader`
- ✅ 4개 페이지 empty → `StudioEmptyState size=normal`
- ✅ VideoPlayerCard · VisionResultCard 의 empty/loading → 공통 shell
- ✅ Compare EmptyViewer · AnalysisLoading · AnalysisEmpty → 공통 shell panel size
- ✅ VideoPlayerCard · VisionResultCard filled shell radius 14 → `var(--radius-card)` 토큰화
- ✅ SourceImageCard · CompareImageSlot 주요 radius 하드코딩 → 토큰화
- ✅ Video `VideoPlayerCard progress` prop 의존성 제거 (audit P1b 에서 이미 미사용화)

**R2-11/12 (Upload slot 기반 재작성) 는 R3 로 연기**
- `StudioUploadSlot` 은 자산만 완성. `SourceImageCard` (256px + info popover + 4 action) 와
  `CompareImageSlot` (140px + A/B badge + 2 pill) 는 고유 UX 가 커서 독립 세션에서
  재설계해야 안전 (회귀 위험 관리).

### P2 라운드 3 (R3 · 구현 완료)

**디자인 시스템 중추 완성**. 판매 퀄리티 1차 목표 도달.

**R3-1 SourceImageCard 재작성**
- ✅ StudioUploadSlot 기반으로 재작성 (기존 props 인터페이스 완전 보존)
- ✅ 파일 업로드 로직 (FileReader + Image.onload) 은 SourceImageCard 가 유지
- ✅ empty/filled shell + drag&drop 로직은 StudioUploadSlot 이 담당 (filled 일 때도 drop 허용하는 `acceptDropWhenFilled` 옵션 추가)
- ✅ 256px 높이 + info popover + 사이즈 배지 + 4 action 버튼 고유 UX 유지

**R3-2 CompareImageSlot 재작성**
- ✅ StudioUploadSlot 기반으로 재작성 (기존 props 인터페이스 완전 보존)
- ✅ A/B badge + 2 pill 액션 유지
- ✅ 140px minHeight 유지

**R3-3 radius 하드코딩 토큰화 (76건 · 시각 무변경)**
- ✅ `borderRadius: 8` → `"var(--radius-sm)"` (25건)
- ✅ `borderRadius: 12` → `"var(--radius)"` (17건)
- ✅ `borderRadius: 14` → `"var(--radius-card)"` (5건)
- ✅ `borderRadius: 16` → `"var(--radius-lg)"` (8건)
- ✅ `borderRadius: 20` → `"var(--radius-xl)"` (1건)
- ✅ `borderRadius: 999` → `"var(--radius-full)"` (20건)
- 잔여 80건 (4/6/10/0/2/3) 은 어색한 값이거나 작은 장식 (유지)

**R3-4 negative letterSpacing 정리 (17건)**
- ✅ `-0.005em` / `-0.01em` → `0` (17건 치환)
- 유지 2건: 랜딩 타이틀 `-0.03em` (Fraunces 디자인 의도) + 로고 `-0.015em`

**검증**
- pytest 130/130 유지
- 프론트 lint clean (수정 파일 기준)

### R4 (향후 · 선택적)

1. 잔여 radius 80건 (4/6/10) 중 6/10 을 sm(8)/radius(12) 로 정식 승격할지 판단 (시각 변화 있음)
2. primitives.tsx / chrome / settings 레거시 영역 lint 에러 5건 해소 (수정 금지 영역이지만 언젠가는)
3. `--accent-disabled` 외에 다른 시맨틱 토큰 추가 (hover/focus/active 등)

### 2026-04-25 P (Paste 기능) · 구현 완료

스크린샷/캡쳐 후 **Ctrl+V 로 바로 업로드** 기능. Figma/Discord/Notion 과 동일 패턴.

**P-2 StudioUploadSlot 에 paste 로직 추가**
- document-level paste 리스너 + focus 가드 (TEXTAREA/INPUT/contentEditable 자동 skip)
- `pasteEnabled` prop (기본 false) 으로 opt-in
- `pasteRequireHover` prop (기본 false) 으로 멀티 slot 페이지 호버 우선 지원

**P-3 SourceImageCard paste 활성화**
- 단일 slot 페이지 (edit/video/vision) 에서 호버 무관 전역 paste 수용
- textarea 에 포커스 중이면 자동 skip — 프롬프트 텍스트 paste 와 충돌 없음

**P-4 CompareImageSlot paste 활성화 (호버 요구)**
- A/B 두 슬롯 모두 `pasteEnabled + pasteRequireHover` 활성
- 호버 중인 슬롯 1개만 응답 → 경쟁/모호성 0
- 둘 다 호버 없으면 Ctrl+V 무시 (의도적)

**P-5 호버 힌트 UI**
- empty 상태에 호버 중일 때만 "또는 Ctrl(+)V 로 붙여넣기" kbd 스타일 힌트
- 비호버 시 잡음 제거

**검증**
- pytest 130/130 유지 (백엔드 무변경)
- 프론트 lint clean (수정 파일 기준)
- contenteditable 전수 grep 결과 0건 (프로젝트에 없음 · 방어 코드는 미래 대비로 삽입)

**UX 체크리스트 (실제 사용 시나리오)**

| 상황 | 동작 |
|---|---|
| Win+Shift+S 스크린샷 → edit 페이지 빈 공간 클릭 후 Ctrl+V | 바로 업로드 ✅ |
| Prompt textarea 에서 텍스트 Ctrl+V | 텍스트 paste (이미지 무시) ✅ |
| Prompt textarea 타이핑 중 클립보드에 이미지 있는 상태 Ctrl+V | textarea 에만 작용, 이미지 업로드 skip ✅ |
| Compare 페이지 Slot A 호버 + Ctrl+V | A 에 업로드 ✅ |
| Compare 페이지 Slot B 호버 + Ctrl+V | B 에 업로드 ✅ |
| Compare 페이지 호버 없음 + Ctrl+V | 무반응 (의도적) |

### P3: 미세 정리

1. ✅ R1-4: globals.css body letter-spacing 제거 완료
2. 🟡 개별 컴포넌트 inline `-0.005em/-0.01em` (19 occurrences) 는 체감 미미 · 라운드 2 공통 shell 작성 시 자연스럽게 제거
3. ✅ R1-5: radius 6단계 토큰 확정. 전면 적용은 라운드 2
4. ✅ R1-1: disabled CTA 색상 token 화 완료
5. 🟢 overlay opacity/pill 스타일 — 라운드 2 공통 shell 에서 일괄 정리

---

## 12. 리스크와 주의점

1. `SourceImageCard` 검은 배경 제거는 대부분 긍정적이지만, 흰 이미지의 edge 구분이 약해질 수 있다.
   - 해결: warm neutral 배경 + 얇은 inner border 또는 checker/striped subtle background 검토

2. `PipelineSteps`를 숨기면 실행 전 자동 처리 흐름 이해가 떨어질 수 있다.
   - 해결: 기본은 compact summary, 필요 시 펼침

3. `AnalysisProgressModal`에서 percent를 없애면 사용자가 “덜 진행되는 느낌”을 받을 수 있다.
   - 해결: indeterminate bar와 elapsed time을 유지

4. 결과 카드 공통화는 파일 여러 개를 건드릴 가능성이 있다.
   - 해결: 먼저 공통 컴포넌트를 만들고, 한 메뉴씩 교체

---

## 13. 최종 판단

현재 상태는 기능별 UI가 모두 작동하지만, 디자인 시스템 관점에서는 결과/진행/입력 상태가 아직 충분히 공통화되지 않았다.

특히 다음 세 가지는 사용자 체감에 바로 영향을 준다.

1. 업로드 후 이미지 카드의 검은 레터박스
2. 진행 모달과 좌측 자동 처리 단계의 중복
3. 결과 영역 헤더와 empty/loading 상태의 메뉴별 차이

따라서 다음 작업은 “새 기능 추가”보다 “결과/진행/입력 상태 디자인 시스템 정리”로 잡는 것이 적절하다.

