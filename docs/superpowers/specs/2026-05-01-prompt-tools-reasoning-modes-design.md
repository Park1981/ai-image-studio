# Prompt Tools Reasoning Modes — 프롬프트 도구/사고모드 정책 설계 (Spec)

**작성일**: 2026-05-01
**상태**: 기획 완료 · 구현 예정
**작성자**: Codex (사용자 공동 기획)
**세션 참고**: AI 보강 / intent 정제 / 번역 / 프롬프트 분리의 Ollama `think` 모드 재검토

## 1. 배경 & 목적

AI Image Studio 는 현재 Generate · Edit · Video 흐름에서 `gemma4-un:latest`
기반 프롬프트 업그레이드와 번역을 사용한다. 기존 구현은 `gemma4-un` 의
reasoning 모델 특성 때문에 모든 텍스트 호출에 `think: false` 를 강제한다.

최근 검토에서 다음 요구가 추가되었다.

- AI 보강을 "빠른 보강" 과 "정밀 보강" 으로 나누고 싶다.
- Edit intent 정제는 사고모드가 더 적합할 수 있다.
- 번역은 사고모드 없이 빠르고 안정적으로 유지한다.
- 인터넷에서 가져온 긴 프롬프트를 face / outfit / background / style 등 카드로 분리하고 싶다.
- 분리 결과는 원본 프롬프트를 자동 덮어쓰기보다 별도 카드로 노출하고, 사용자가 적용하게 한다.

목적은 기존 안정성을 유지하면서 프롬프트 도구를 공통 설계로 확장하는 것이다.

## 2. 현재 구조 요약

### 2.1 백엔드 호출 경로

현재 AI 보강/번역/intent 정제는 공통 Ollama 호출부를 경유한다.

```text
upgrade_generate_prompt
upgrade_edit_prompt
upgrade_video_prompt
clarify_edit_intent
translate_to_korean
  -> prompt_pipeline._ollama._call_ollama_chat
  -> _ollama_client.call_chat_payload
```

현재 `prompt_pipeline._ollama._call_ollama_chat` 는 아래 정책을 고정한다.

```python
"think": False
"keep_alive": "0"
"options": {
  "num_ctx": 8192,
  "temperature": 0.6,
  "top_p": 0.92,
  "repeat_penalty": 1.18,
  "num_predict": 800,
}
```

### 2.2 현재 제약

- `think` 옵션이 호출자별로 바뀌지 않는다.
- `num_predict`, `timeout`, `temperature` 도 모드별 조정이 어렵다.
- `_ollama_client.extract_chat_content()` 는 `content` 가 비면 `thinking` 필드를 fallback 으로 반환한다.
- `think:true` 를 도입하면 내부 사고문이 사용자 프롬프트 결과로 섞일 위험이 있다.

## 3. 결정 사항 요약

| 기능 | 기본 정책 | 도입 판단 | 비고 |
|------|-----------|-----------|------|
| 빠른 AI 보강 | `think:false` | 유지 | 현재 기본값. 속도/안정성 우선 |
| 정밀 AI 보강 | `think:true` | 추가 | 사용자가 명시 선택. 느림 |
| intent 정제 | `think:true` 우선 검토 | 추가 후보 | Edit 품질 영향 큼. A/B 테스트 필요 |
| 번역 | `think:false` | 유지 | 사고모드 이득 낮음 |
| 프롬프트 분리 | `think:false` | 신규 추가 | JSON 카드 결과. 원본 보존 |
| 정밀 분리 | `think:true` | 후순위 옵션 | 기본 기능 안정화 후 검토 |

## 4. 모드 정의

### 4.1 빠른 AI 보강

반복 사용되는 기본 보강 모드다.

```text
think: false
num_predict: 800~1024
timeout: 기존 DEFAULT_TIMEOUT
목표: 5~15초 안쪽 응답
```

적용 대상:

- Generate 기본 보강
- Edit 기본 보강
- Video 기본 보강
- 기존 사용자 흐름

### 4.2 정밀 AI 보강

복잡한 의도, 보존/변경 구분, 영상 motion/camera 해석에 사용하는 고품질 모드다.

```text
think: true
num_predict: 2048~4096
timeout: 90~180초
목표: 품질 우선. 30~60초 이상 가능
```

적용 대상:

- 사용자가 "정밀 보강" 선택
- 복잡한 Edit 지시
- Video prompt 개선
- 보존 범위가 중요한 요청

정밀 모드는 기본값으로 켜지 않는다.

### 4.3 Intent 정제

`clarify_edit_intent()` 는 사용자의 자연어 수정 지시를 영어 1-2문장으로 정제한다.

예:

```text
입력: 얼굴은 그대로 두고 옷만 빨간 드레스로 바꿔줘
출력: Change only the outfit to a red dress while preserving the face and all other details.
```

이 단계는 Edit 품질에 직접 영향을 주기 때문에 사고모드 후보로 적합하다.

권장 정책:

```text
빠른 보강 모드: think:false
정밀 보강 모드: think:true
```

단, 실제 적용 전 A/B 테스트가 필요하다.

### 4.4 번역

번역은 의미 보존과 속도가 중요하다. 사고모드는 기본적으로 사용하지 않는다.

```text
think: false
num_predict: 입력 길이에 비례 또는 기존 800
timeout: 45~60초
```

번역은 실패해도 원문 영문 프롬프트를 살린다.

### 4.5 프롬프트 분리

긴 프롬프트를 의미 카드로 분리한다.

기본 정책:

```text
think: false
format: json
temperature: 0
num_predict: 512~1024
timeout: 15~30초
```

기본 카테고리:

```text
subject
composition
face
eyes
nose
lips
skin
makeup
expression
hair
outfit
background
lighting
style
quality
negative
etc
```

출력 구조:

```json
{
  "sections": [
    { "key": "subject", "text": "20-year-old Korean K-pop female idol" },
    { "key": "face", "text": "flawless symmetrical face, sharp jawline" }
  ]
}
```

UI 에서는 JSON 을 카드로 렌더링한다. 원본 프롬프트는 자동으로 덮어쓰지 않는다.

## 5. 백엔드 설계

### 5.1 공통 호출 옵션화

`prompt_pipeline._ollama._call_ollama_chat()` 에 호출 옵션을 추가한다.

```python
async def _call_ollama_chat(
    *,
    ollama_url: str,
    model: str,
    system: str,
    user: str,
    timeout: float,
    think: bool = False,
    num_predict: int = 800,
    temperature: float = 0.6,
    top_p: float = 0.92,
    repeat_penalty: float = 1.18,
    format: str | dict | None = None,
    allow_thinking_fallback: bool = False,
) -> str:
    ...
```

기본값은 기존 동작과 동일하게 유지한다.

### 5.2 Thinking fallback 분리

현재 `extract_chat_content()` 는 `content` 가 비면 `thinking` 을 반환한다.

정밀 모드 도입 전 아래처럼 분리해야 한다.

```text
think:false 호출:
  content 있으면 content 사용
  content 없고 allow_thinking_fallback=True 이면 thinking 사용 가능

think:true 호출:
  content만 결과로 인정
  thinking은 로그/디버그에도 저장하지 않음
  content 비면 실패 처리
```

권장 변경:

```python
def extract_chat_content(
    data: dict[str, Any],
    *,
    allow_thinking_fallback: bool = False,
) -> str:
    ...
```

`call_chat_payload()` 도 같은 옵션을 받는다.

### 5.3 보강 모드 enum

백엔드 공통 타입 후보:

```python
PromptEnhanceMode = Literal["fast", "precise"]
```

또는 Pydantic 문자열 필드:

```python
prompt_mode: str | None = Field(default="fast", alias="promptMode")
```

초기에는 `"fast"` / `"precise"` 두 값만 허용한다.

### 5.4 Upgrade 함수 확장

대상 함수:

- `upgrade_generate_prompt`
- `upgrade_edit_prompt`
- `upgrade_video_prompt`
- `clarify_edit_intent`

권장 인자:

```python
prompt_mode: str = "fast"
```

내부 매핑:

```python
if prompt_mode == "precise":
    think = True
    num_predict = 4096
    timeout = max(timeout, 120.0)
else:
    think = False
    num_predict = 800
```

번역 함수 `translate_to_korean()` 은 `prompt_mode` 를 받더라도 항상 `think:false` 로 유지한다.

### 5.5 Prompt split 신규 모듈

신규 모듈 후보:

```text
backend/studio/prompt_tools.py
```

또는 prompt_pipeline 하위:

```text
backend/studio/prompt_pipeline/tools.py
```

권장 함수:

```python
async def split_prompt_cards(
    prompt: str,
    *,
    model: str = "gemma4-un:latest",
    timeout: float = 30.0,
    ollama_url: str | None = None,
) -> PromptSplitResult:
    ...
```

실패 정책:

- JSON 파싱 성공: `provider="ollama"`, `fallback=False`
- Ollama 실패 또는 JSON 실패: `sections=[]`, `fallback=True`, 원본 유지

### 5.6 API 엔드포인트

신규 후보:

```text
POST /api/studio/prompt-tools/split
POST /api/studio/prompt-tools/translate
```

또는 기존 `routes/prompt.py` 에 추가:

```text
POST /api/studio/prompt/split
POST /api/studio/prompt/translate
```

권장 요청:

```json
{
  "prompt": "raw prompt text",
  "ollamaModel": "gemma4-un:latest",
  "mode": "fast"
}
```

권장 응답:

```json
{
  "sections": [
    { "key": "face", "text": "..." }
  ],
  "provider": "ollama",
  "fallback": false,
  "raw": "{...}"
}
```

## 6. 프론트 UX 설계

### 6.1 설정값

`useSettingsStore` 에 보강 모드를 추가한다.

```ts
export type PromptEnhanceMode = "fast" | "precise";

promptEnhanceMode: PromptEnhanceMode;
setPromptEnhanceMode: (v: PromptEnhanceMode) => void;
```

기본값:

```text
fast
```

### 6.2 Generate

Generate 는 현재 `hideGeneratePrompts=false` 일 때 사전 업그레이드 모달을 띄운다.
이 모달/호출에 `promptMode` 를 전달한다.

UI 후보:

```text
AI 보강: [빠른] [정밀]
```

정밀 선택 시 안내:

```text
정밀 보강은 오래 걸릴 수 있음
```

### 6.3 Edit

Edit 은 보강 모드 영향이 가장 크다.

정밀 모드 적용 범위:

- `clarify_edit_intent`
- `upgrade_edit_prompt`

비전 분석 `qwen2.5vl` 은 `think` 옵션 대상이 아니다.

### 6.4 Video

Video 는 motion / camera / preservation 해석이 있어 정밀 보강 후보에 해당한다.

정밀 모드 적용 범위:

- `upgrade_video_prompt`

Vision description 은 기존 정책 유지.

### 6.5 Prompt tools 카드

프롬프트 입력 영역 근처에 도구 버튼을 추가한다.

```text
[번역] [분리] [AI 보강 ▼]
```

또는 메뉴:

```text
[프롬프트 도구 ▼]
  빠른 보강
  정밀 보강
  한글로 번역
  영어로 번역
  프롬프트 분리
```

분리 결과 카드는 원본 아래에 표시한다.

카드 액션 (구현 채택 — Codex Phase 5 리뷰 fix · 2026-05-01):

- **복사** — 카드 텍스트를 clipboard 로
- **선택 추가** (= "선택 카드만 적용") — 체크된 카드들의 text 를 textarea 끝에 `, ` join 으로 *append*. 기존 prompt 보존.
- **원본 교체** (= "원본에 적용") — 체크된 카드들의 text 로 textarea 통째로 *replace*. destructive 동작 (원본 손실).
- **카드 삭제** — 해당 카드만 visible 리스트에서 제거 (sections state 자체는 유지).
- **닫기** (= "원본 유지") — 카드 영역 unmount, prompt 영향 0.

**기본 미선택**: 카드가 도착해도 기본 체크박스 unchecked. 사용자가 명시 체크 후에야 [선택 추가] / [원본 교체] 활성. 이전 안 (기본 전체 선택 + append) 은 원문과 거의 같은 phrase 가 중복되는 안티패턴이라 회피.

**spec §11 비목표 정합**: 자동 mount-effect 등 prompt 만지는 path 없음. 사용자 명시 클릭만 textarea 변경.

## 7. 실패/폴백 정책

| 실패 지점 | 처리 |
|-----------|------|
| 빠른 보강 실패 | 원본 프롬프트 사용, `provider=fallback` |
| 정밀 보강 실패 | 빠른 보강 자동 재시도 또는 원본 사용 |
| intent 정제 실패 | 원문 instruction 사용 |
| 번역 실패 | 영문 유지, 한글 번역 `null` |
| 프롬프트 분리 실패 | 원본 유지, 카드 비움 |
| JSON 파싱 실패 | 원본 유지, raw 로그만 서버 로그 |
| 사고모드 content 빈값 | 실패 처리. `thinking` 을 결과로 사용 금지 |

정밀 보강 fallback 은 두 가지 중 하나로 결정한다.

1. 자동 빠른 보강 재시도
2. 원본으로 폴백 (provider=`fallback-precise-failed` 명시 라벨)

**구현 채택: 2번 (원본 폴백 + 명시 라벨)** — v2 plan §3.3 결정 (2026-05-01).

사유:
- 자동 재시도는 사용자 인지를 흐림 — "정밀 눌렀는데 빠른 결과 도착" 이 silent.
- `fallback-precise-failed` 별도 provider 로 표기하면 UI 가 *모달 경고 + DetailBox warn + toast* 3-layer 안내 가능.
- 사용자가 원하면 `[재업그레이드]` 버튼 (Generate 모달) 또는 [빠른] 모드 전환 후 재시도 — 명시 클릭만 받음.

## 8. 성능 기준

실측 참고:

- `gemma4:26b`, `think:false`, prompt split: 약 7.7~8초, JSON 성공
- `gemma4:26b`, `think:true`, `num_predict=4096`, prompt split: 약 50초, JSON 성공

정책:

| 모드 | 목표 시간 | 타임아웃 |
|------|-----------|----------|
| 빠른 보강 | 5~15초 | 60~120초 |
| 정밀 보강 | 30~60초 | 120~180초 |
| intent 정제 fast | 3~10초 | 60초 |
| intent 정제 precise | 20~60초 | 120초 |
| 번역 | 3~15초 | 45~60초 |
| 프롬프트 분리 | 5~15초 | 30초 |

VRAM 정책은 기존과 동일하게 `keep_alive:"0"` 을 우선 유지한다.

단, 정밀 보강은 모델 reload 비용이 커질 수 있으므로 추후 `keep_alive:"30s"` 같은 짧은 유지 전략을 별도 실험할 수 있다.

## 9. 구현 단계

### Phase 1 — 호출 옵션화

- `_ollama_client.extract_chat_content()` 에 `allow_thinking_fallback` 추가
- `call_chat_payload()` 에 옵션 전달
- `_call_ollama_chat()` 에 `think`, `num_predict`, `temperature`, `format`, `allow_thinking_fallback` 추가
- 기본값은 기존 동작과 동일하게 유지
- 기존 테스트 통과 확인

### Phase 2 — 보강 모드 추가

- Backend schema 에 `promptMode` 추가
- Frontend `PromptEnhanceMode` 타입 추가
- Settings store 에 `promptEnhanceMode` 추가
- Generate/Edit/Video 요청에 `promptMode` 전달
- `upgrade_*_prompt()` 에 모드 전달

### Phase 3 — intent 정제 모드 적용

- `clarify_edit_intent()` 에 `prompt_mode` 추가
- Edit pipeline 에서 전달
- 정밀 모드일 때 `think:true` 적용
- A/B 테스트 케이스로 품질 확인

### Phase 4 — 프롬프트 분리 도구

- prompt split backend 함수 추가
- JSON schema/파서 추가
- API 엔드포인트 추가
- 프론트 카드 UI 추가
- 원본 보존 + 적용 버튼 정책 구현

### Phase 5 — 번역 도구 확장

- 한글 -> 영어 / 영어 -> 한글 도구 API 추가
- LoRA, weight, negative prompt, 특수 토큰 보존 규칙 추가
- 프론트에서 번역 결과 카드 노출

## 10. 테스트 계획

### 10.1 단위 테스트

- `_call_ollama_chat()` 기본 payload 가 기존과 동일한지
- `promptMode="precise"` 일 때 `think:true`, `num_predict` 상향되는지
- `think:true` 에서 `thinking` fallback 이 금지되는지
- `translate_to_korean()` 은 항상 `think:false` 인지
- `clarify_edit_intent()` 실패 시 원문 폴백 유지
- `upgrade_generate_prompt()` 기존 테스트 회귀 없음
- `upgrade_edit_prompt()` reference role 후처리 유지
- `upgrade_video_prompt()` adult clause 유지
- prompt split JSON parse 성공/실패

### 10.2 통합 테스트

- Generate 빠른 보강
- Generate 정밀 보강
- Edit 정밀 intent + 정밀 보강
- Video 정밀 보강
- Ollama 종료 시 fallback
- 정밀 보강 timeout 시 빠른 보강 재시도
- prompt split 카드 렌더링
- split 결과 적용 후 원본 textarea 갱신

### 10.3 수동 테스트 케이스

Intent 정제:

```text
얼굴은 그대로 두고 옷만 빨간 드레스로 바꿔줘
배경 유지하고 머리색만 금발로
포즈는 그대로, 카메라만 더 가까이
```

프롬프트 분리:

```text
A highly detailed, photorealistic close-up portrait of a 20-year-old beautiful Korean K-pop female idol...
```

번역:

```text
<lora:cinematic:0.8>, (beautiful face:1.2), negative prompt: blurry, watermark
```

## 11. 비목표

- 사고모드를 모든 Ollama 호출에 일괄 적용하지 않는다.
- 번역에 사고모드를 기본 적용하지 않는다.
- 프롬프트 분리 결과로 원본을 자동 덮어쓰지 않는다.
- 비전 모델 `qwen2.5vl` 호출 정책을 이번 작업에서 변경하지 않는다.
- ComfyUI workflow 구조를 변경하지 않는다.

## 12. 최종 권장안

초기 구현은 다음 정책으로 고정한다.

```text
빠른 AI보강: think:false
정밀 AI보강: think:true
intent 정제: 보강 모드에 따라 fast=false / precise=true
번역: think:false
프롬프트 분리: think:false
```

가장 먼저 해야 할 작업은 기능 UI 가 아니라 Ollama 호출부의 `think` 옵션화와
`thinking fallback` 분리다. 이 안전장치를 먼저 넣어야 정밀 보강과 prompt split 을
안정적으로 확장할 수 있다.

## 13. 구현 결과 + 알려진 이슈 (2026-05-01)

### 13.1 구현 완료 항목

3 commit 으로 master 박제:

- **`ac364ca`** — Phase 1~4 + Codex Phase 4 리뷰 4 finding fix
  · 호출 옵션화 (회귀 0 안전망)
  · 모드 enum + upgrade/clarify 함수 확장 (`fallback-precise-failed` 신규 provider)
  · Frontend 토글 + 전파 (settings + 페이지 session)
  · UI 경고 + 4 stage 라벨 모드 분기 (`gemmaSubLabel` 콜백)

- **`4e96f85`** — Phase 5 (프롬프트 분리 + 양방향 번역)
  · `prompt_pipeline/tools.py` 신규 (`split_prompt_cards` + `translate_prompt`)
  · `POST /prompt/split` + `POST /prompt/translate` 엔드포인트
  · `PromptToolsBar` + `PromptCardList` 컴포넌트 (3 LeftPanel 통합)

- **`ebd99c8`** — Codex Phase 5 리뷰 4 finding fix
  · 번역 결과를 카드 (`PromptTranslationCard`) 로 노출
  · 분리 카드 sections 변경 시 state reset (React derive-state-from-props 패턴)
  · settings ollamaModel 3 LeftPanel → PromptToolsBar 전파
  · 카드 액션 분리 (`[선택 추가]` append + `[원본 교체]` replace) + 기본 미선택

검증: pytest 371 → 405 (+34) / vitest 125 → 150 (+25) / tsc clean / ESLint clean.

### 13.2 알려진 이슈 (후속 작업 후보)

#### 🟡 M1 — `keep_alive=0` 정책 후속 실험 (성능)

본 spec §8 의 권장사항 그대로 — 정밀 보강은 모델 reload 비용 큼. 사용자가
`[정밀]` + `[분리]` + `[번역]` 빈번 사용 시 매번 cold reload ~5초 추가.

후속 plan 후보: `gemma4-un` 호출 직후 `keep_alive: "30s"` 짧은 유지 실험.
ComfyUI sampling 시 강제 unload (`force_unload_all_loaded_models`) 는 그대로
유지해야 16GB VRAM swap 회피. 따라서 *Ollama 단독 사용 구간* (사용자가
입력 다듬는 동안) 만 30s 유지하고 ComfyUI dispatch 직전 강제 unload —
이 경계가 코드 레벨에서 어떻게 구현될지가 plan 핵심.

#### ✅ M2 — Edit Compare 자동 트리거 + 정밀 모드 UX 정책 (2026-05-01 결정 + 구현)

사용자가 Edit `[정밀]` 켠 상태에서 결과가 나오면 `useEditPipeline.ts` 가
*Edit 모드 그대로* 자동 Compare 호출. cache miss 시 `clarify_edit_intent` 도
`think:true` → 60s+ 추가. 자동이라 사용자 인지 X 였음.

**채택 결정 (2026-05-01)**: **옵션 A + 부분 옵션 C 하이브리드**.
- 모드 일관성 유지 (자동 Compare 도 Edit 정밀 모드 따라감)
- *정밀 모드 + 자동 트리거 케이스만* `toast.info("정밀 비교 분석 진행 중", "백그라운드에서 ~60초 소요")` 노출
- 빠른 모드 자동은 silent 그대로 (자동의 가치 = 무의식 진행 · toast spam 회피)

검토했다 기각된 옵션:
- (B) 자동 트리거는 *항상 fast* 강제 — "정밀" 의미가 자동에선 안 살아남
- (C 전체) 모든 자동 트리거 토스트 — 빠른 모드도 매번 알림 → spam

#### 🟢 L1 — Mount-time flicker (Settings precise 사용자만)

**원인**: `useGenerateStore` 등 페이지 store 의 `promptMode` 초기값이 `"fast"` 고정.
mount effect (`useRef + getState()` Codex Phase 4 fix Medium #2) 가 settings 의
`promptEnhanceMode` 로 sync 하는 구조라, settings 가 `"precise"` 인 사용자는
첫 paint 와 effect 실행 사이 한 frame `[빠른]` 표시 가능.

**persist 흔적은 아님** — `useGenerateStore` 의 `partialize` 가 `promptMode` 명시적
제외 (`stores/useGenerateStore.ts:244-253`). 새로고침 후 store 는 항상 default
`"fast"` 로 init.

**대응 옵션**:
- (A) 현재 구조 유지 — 1 frame flicker 미세, UX 영향 무시 가능 수준
- (B) `useState` lazy init 으로 settings 값 가져와 store default 동적 결정
- (C) `PromptModeRadio` 가 settings 값 직접 구독 — store sync 제거 (페이지 session
  토글 의미 약화)

본 commit 범위 X — 후속 plan 후보. 옵션 A 가 가장 단순 + 영향 미세.
