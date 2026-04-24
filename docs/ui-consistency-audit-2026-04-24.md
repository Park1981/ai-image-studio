# AI Image Studio UI Consistency Audit

**작성일**: 2026-04-24  
**상태**: 검증 완료, P0+P1a 구현 진행 중 (2026-04-24 업데이트)  
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

### P1b: 진행 UI 구조 개편 (다음 라운드)

1. Edit/Video 좌측 `PipelineSteps` 를 안내용/접힘형으로 조정
2. Video `VideoPlayerCard` 내부 progress bar 와 CTA percent 중복 축소
3. Video CTA 의 `{percent}%` 제거 (모달에 집중)

### P2: 구조 리팩터

1. `StudioResultHeader`
2. `StudioResultCard`
3. `StudioEmptyState`
4. `StudioLoadingState`
5. upload slot shell 공통화

### P3: 미세 정리

1. negative letter spacing 제거
2. radius token 적용
3. disabled CTA 색상 token화
4. overlay opacity/pill 스타일 정리

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

