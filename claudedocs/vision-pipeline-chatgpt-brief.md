# Vision-to-Prompt Pipeline — Diagnosis Brief for ChatGPT

> 목적: 코드 없이도 architecture 정공법을 받기 위한 self-contained 진단 패키지.
> 작성일: 2026-05-03 / 4 iterations 의 system prompt 튜닝 후 한계 도달.

---

## 1. Environment

- **OS**: Windows 11
- **GPU**: RTX 4070 Ti SUPER, **16GB VRAM**
- **Stack**: Local AI image studio (Next.js 16 + FastAPI + ComfyUI + Ollama)
- **Goal**: 사용자가 이미지 1장을 올리면, t2i (Qwen Image 2512 family) 로 재생성 가능한 풀 프롬프트 추출
- **Use case**: 사용자가 결과 프롬프트를 카피해서 그대로 t2i UI 에 붙여넣어 비슷한 이미지 재생성

## 2. Current Architecture

- **Vision model**: `qwen2.5vl:7b` (Ollama 로컬, 약 6GB)
- **Output format**: STRICT JSON 9 슬롯
  - `summary` (2-3 sentence)
  - `positive_prompt` (target 150-300 word t2i 프롬프트 — 메인 카피 타겟)
  - `negative_prompt` (회피 리스트)
  - `composition`, `subject`, `clothing_or_materials`, `environment`, `lighting_camera_style` (구조화 슬롯)
  - `uncertain` (시각적으로 불확실한 항목)
- **Sampling**: temperature 0.4, num_ctx 8192, format=json, keep_alive 0
- **Frontend**: 9 슬롯을 카드별로 표시, positive_prompt 가 카피 메인

## 3. System Prompt (Current — 4 iterations 후)

핵심 섹션:
- CRITICAL RULE 1 — Identity (broad race REQUIRED, adult lock)
- CRITICAL RULE 2 — positive_prompt SELF-CONTAINMENT
- TONE — tag-style + brief sentences mixed
- COMPLETENESS CHECKLIST — 12 items (race, age, expression, hair, pose, garments, background layers, lighting, color, lens, DOF, style anchor)
- SPECIFICITY GUARDS — anti-pattern 명시 ("muted earth tones" / "golden hour" 등 보일러플레이트 phrase 복사 금지)
- DEFAULT SINGLE-IMAGE ANCHOR
- MULTI-SUBJECT HANDLING
- GENERAL RULES (negative prompt + concrete vocab)

총 약 225 줄. EXAMPLES 섹션은 제거됨 (4차 시도에서).

## 4. Test Image (4번 모두 동일)

**East Asian young woman at outdoor music festival**:
- Wet long dark hair (비 맞은 상태)
- **Winking expression** (한쪽 눈 감음, 입에 컵 가져감)
- Asymmetric cross-strap cutout gray/dark-blue cropped tank top (시그니처 디테일)
- Beige low-rise cargo/utility pants
- Hand holding clear plastic cup with yellow drink
- Background: **plastic raincoats on crowd**, neon "MUSIC FESTIVAL" signage, **saturated red + blue stage lights**, rain visible
- Vertical portrait orientation
- Camera slightly below subject's chest level, slight upward tilt

## 5. 4 Iterations of System Prompt Tuning — Test Results

### Iteration 1 (baseline · temp 0.4 · 4 EXAMPLES · soft "aim for 150 words")

**Output**:
> "A young woman with wet hair drinking from a plastic cup at a music festival. She is wearing a cropped tank top and light-colored pants. The background is filled with a crowd wearing plastic raincoats, with bright stage lights and neon signs illuminating the scene. The festival is taking place in the rain, with water droplets visible on her hair and clothes. The lighting is vibrant with red and blue hues, and the atmosphere is lively and energetic..."

**Negative**: "smiling, blurry, lowres, watermark, text artifacts, oversaturated, plastic skin"

- Word count: ~105 (target 150-300)
- ✅ music festival / rain / raincoats / red+blue 정확
- ❌ Race 0
- ❌ Wink expression 누락
- ❌ Cross-strap cutout 누락 ("cropped tank top" 만)
- ❌ Lens / DOF / style anchor 0
- ❌ 톤이 descriptive paragraph (system prompt 가 명시한 BAD 패턴)

### Iteration 2 (temp 0.4 → 0.7 + "MUST be ≥ 150 words" hard constraint + race policy 위로)

**Output**:
> "young woman with wet hair, holding a drink, semi-transparent outfit with cutouts, lively party setting with bright neon lights in the background, dynamic expression, slightly tilted head, vibrant party atmosphere, soft diffused lighting, warm tones, cinematic editorial style, ultra detailed, high resolution"

- Word count: ~50 (더 짧아짐!)
- ✅ Tag-style 톤
- ❌ "music festival" → "lively party" 다운그레이드
- ❌ "rain" / "raincoats" 사라짐
- ❌ "warm tones" / "soft diffused" — **사실 오류** (실제 saturated neon)
- ❌ Race 0, wink 누락
- → temp 0.7 가 visual fidelity 깨뜨리고 길이도 못 늘림

### Iteration 3 (temp 0.4 원복 · 12-item COMPLETENESS CHECKLIST · "count items not words")

**Output**:
> "young woman, long dark hair, wet appearance, holding a drink, neutral expression, facing slightly to the left, wearing a black top with cutouts and beige pants, standing in a crowd, neon lights and stage in the background, **golden hour lighting with soft rim light**, **muted earth tones with cool teal shadows**, **85mm portrait lens**, **shallow DOF with soft bokeh**, cinematic editorial photography style, ultra detailed."

- ❌❌ **EXAMPLES copy catastrophic**: "muted earth tones with cool teal shadows" / "85mm portrait" / "shallow DOF with soft bokeh" 가 system prompt 의 [example A] 에서 통째 복사됨 (실제와 무관)
- ❌❌ "golden hour" — 사실 오류 (실제 neon stage)
- ❌ "neutral" — 사실 오류 (실제 wink)
- ❌ Race 0
- 🟡 cutout 잡음 (개선)

### Iteration 4 (EXAMPLES 4개 통째 제거 + adult lock + anti-pattern 명시 — "muted earth tones 금지" 등 명시)

**Output**:
> "young adult woman with wet hair, smiling, holding a drink, wearing a revealing top and jeans, standing in a lively nighttime outdoor setting with neon lights and a crowd in the background, 85mm portrait lens, **softbox key lighting**, **muted earth tones**, cinematic editorial style, shallow with soft bokeh, **young adult female, wet hair, revealing top, jeans, drink, crowd, neon lights, nighttime, lively, smiling, 85mm portrait lens, softbox key lighting, muted earth tones, cinematic editorial style, shallow with soft bokeh, young adult female, wet hair, revealing top, jeans, drink, crowd, neon lights, nighttime, lively, smiling**"

- ❌❌❌ **Repetition collapse** — 같은 토큰 묶음을 2번 반복
- ❌❌ "softbox key" / "muted earth tones" — system prompt 에서 **명시적으로 금지** 한 boilerplate 인데 그대로 출력
- ❌❌ "jeans" — 사실 오류 (실제 베이지 카고)
- ❌❌ "smiling" — 사실 오류 (실제 wink)
- ❌ Race 0
- → **anti-pattern 명시도 무시** — 7B 모델이 negative instruction 못 따라옴

## 6. Identified Failure Modes (4 데이터 포인트 종합)

1. **Boilerplate copy (catastrophic)**: system prompt 안 EXAMPLES phrase 를 통째 복사. 실제 이미지와 무관하게 "muted earth tones" / "85mm portrait" / "golden hour" 같은 phrase 가 자동 출력.
2. **Anti-pattern ignorance**: "X 하지 마" 라는 negative instruction 못 따라옴. EXAMPLES 제거 후에도 "muted earth tones" 자동 출력 (학습된 boilerplate).
3. **Visual observation error**: 옷 (jeans vs cargo), 조명 (softbox vs neon), 색 (earth tones vs saturated red/blue), 표정 (smiling vs wink) — **시각 자체를 틀림**.
4. **Repetition collapse**: 12 items 를 채우려다 token-loop 빠짐 (4차에서 발견).
5. **Instruction following weak**: "race REQUIRED" 강조해도 4회 모두 race 0. CRITICAL RULE 으로 격상해도 무시.
6. **Length compliance failure**: "MUST be ≥ 150 words" hard constraint 도 무시 (50~105 word 범위만).

## 7. Architecture Candidates We Identified

| Option | 코스트 | 우려 |
|---|---|---|
| **A. Same vision model 2-pass** (1차 JSON 빠르게 → 2차 positive_prompt 만 free-form 재호출) | 코드 +30줄, 시간 2배 | 비전 모델이 관찰 자체를 틀리니 재호출도 같은 wrong observation 반복 가능 |
| **B. 2-stage 분업**: qwen2.5vl 은 raw observation enumeration 만 (관찰), gemma4-un (Ollama 26B text 모델) 이 합성 (positive_prompt 작성) | 코드 +60줄, pipeline 변경 | 비전 = 관찰 강점, 텍스트 = 합성 강점 활용 |
| **C. 모델 변경**: qwen2.5vl:7b → qwen2.5vl:32b (Q4_K_M ~19GB) | VRAM 16GB 부담 (swap 발생) | 1-shot 가능성 ↑, 응답 시간 ↑↑ |
| **D. 다른 비전 모델**: InternVL2.5 / MiniCPM-V 2.6 / LLaVA-OneVision | 모델 다운 + 통합 | 미지수 |

## 8. Questions for ChatGPT

1. **Root cause 진단**: 위 6 failure modes 의 근본 원인은 무엇인가? (model capacity / prompt design / sampling / 셋의 조합 비중)

2. **Architecture 추천**: A/B/C/D 중 어느 것이 정공법인가? 각 후보의 trade-off 정밀 분석 (VRAM / 응답 시간 / 품질 / 구현 복잡도) 후 1순위 추천.

3. **16GB VRAM Ollama 환경에서 best vision model**: qwen2.5vl:32b 가 정공법인가? 아니면 InternVL2.5 / MiniCPM-V / LLaVA-OneVision 같은 다른 모델이 더 좋은 trade-off 인가? (응답 시간 / 정확도 / VRAM 균형)

4. **System prompt redesign 후속 가치**: 4 iterations 했는데도 catastrophic failure 가 사라지지 않음. 추가 system prompt 튜닝의 marginal value 가 있나, 아니면 architecture 변경이 정공법인가?

5. **2-stage 분업 (옵션 B) 추천 시 구체 instruction**: 
   - Vision 모델 (qwen2.5vl:7b) 한테 줄 instruction 예시 — raw enumeration 만 시키려면 어떤 prompt 가 best?
   - Text 모델 (gemma4-un 26B) 한테 줄 instruction 예시 — vision 의 raw enumeration 받아서 positive_prompt 합성하는 prompt 가 어떤 형태가 best?

6. **qwen2.5vl 의 알려진 한계** — 이 모델의 long-form structured generation / instruction following / negative instruction handling 한계가 일반적으로 알려진 패턴인가? Ollama 커뮤니티의 best practice 가 있나?

7. **빠른 검증 가능한 1순위 액션** — 우리가 다음 세션에 시도할 단일 best 변경은 무엇? (예: "B 2-stage 만 시도" / "C 32b 모델 받아 비교" / "다른 비전 모델 X 받아라" 등)

## 9. 참고 — 우리가 시도하지 않은 것

- 2-pass / 2-stage / 모델 변경 모두 아직 안 함
- "thinking" / "reasoning" 모드 옵션 안 켬 (qwen2.5vl 이 지원하는지 모름)
- few-shot in-context examples 를 system prompt 가 아닌 user message 에 박는 방식 안 시도
- structured output (Outlines / Guidance / vLLM 의 grammar-constrained generation) 시도 안 함

---

**참고**: 위 결과들은 모두 **같은 이미지** (East Asian young woman at music festival) 4번 분석한 출력입니다. system prompt 만 변경했고, 이미지/모델/sampling/format=json 은 동일.
