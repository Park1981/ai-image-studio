# Vision 2-Stage Pipeline — 정밀 복원 (Precision Recall) Brief for ChatGPT

> 목적: 2-stage 분업 architecture 가 catastrophic failure 는 모두 해결했지만, "정밀 복원" 기준에서는 시각 시그니처 디테일이 손실됨. **줄별 system prompt 수정 포인트** 받기 위한 brief.
> 작성일: 2026-05-03 / Vision 2-stage 1차 구현 후

---

## 1. 결정 사항 (이미 적용됨)

이전 brief (`vision-pipeline-chatgpt-brief.md`) + 답변 (`답변.md`) 의 정공법 그대로 채택, 14 commits 로 master merge 완료:

- **Vision (qwen3-vl:8b)** — raw observation JSON ONLY (positive_prompt 작성 금지 + boilerplate 금지)
- **Text (gemma4-un 26B)** — observation JSON 받아 positive_prompt 합성
- **Banned-terms 후처리** — 관찰 근거 없는 boilerplate 강제 제거 (`muted earth tones`, `golden hour`, `85mm portrait` 등)
- **Observation mapping** — 5 슬롯 직접 평탄화 (composition / subject / clothing / environment / lighting_camera)
- env vars: `STUDIO_VISION_MODEL` / `STUDIO_TEXT_MODEL` / `STUDIO_OLLAMA_KEEP_ALIVE` (default `5m`) / `STUDIO_VISION_DEBUG`

검증: pytest 446 PASS / vitest 178 PASS / tsc clean / regression 0.

---

## 2. 카리나 이미지 5차 결과 (2-stage 적용 후)

### Positive prompt (165 단어 · 적절)

> A full-body, frontal portrait of a young adult standing centered in an outdoor night setting. The subject has visibly wet hair and a neutral expression, looking directly forward with a closed mouth. They are wearing a simple tank top and shorts, holding a drink cup in their hands. The environment is a lively party atmosphere with a shallow depth of field that keeps the focus sharply on the subject while blurring the midground and background. In the foreground, glowing neon lights and the silhouettes of other people create a sense of depth. The background features a distant stage, suggesting a concert or festival setting. The color palette is dominated by high-contrast red, black, and blue tones, illuminated by ambient light and vibrant neon sources. The scene is clear and sharp, capturing the textures of the wet hair and the casual summer clothing amidst the energetic, colorful nocturnal crowd.

### Negative prompt

> dry hair, smiling, laughing, open mouth, looking away, monochrome, sepia, blurry subject, low contrast, indoor, studio background, sunlight, daytime, empty crowd, monochromatic, distorted limbs, extra fingers, messy composition

---

## 3. 진전 (catastrophic failure 모두 해결)

| 항목 | 1~4차 (1-shot) | 5차 (2-stage) | 변화 |
|---|---|---|---|
| Boilerplate copy ("muted earth tones" / "golden hour" / "85mm" 자동 출력) | 4번 모두 발생 | **0건** | ✅ 해결 |
| Repetition collapse | 4차 발생 | **0건** | ✅ 해결 |
| 사실 오류 (조명/색) | "softbox", "warm tones", "golden hour" 거짓 | **"red/blue neon" 정확** | ✅ 해결 |
| Word count | 50~105 (목표 150~) 미달 | **165** | ✅ 해결 |
| Tone | 산문체 (BAD) 또는 짧은 list | **mixed style 적절** | ✅ 해결 |
| Negative prompt | "smiling" 만 image-specific | **정교 (dry hair / studio bg / sunlight 등)** | ✅ 큰 개선 |

---

## 4. 남은 약점 — 정밀 복원 기준 누락 매트릭스

원본 카리나 이미지의 시그니처 (재현 핵심 앵커):
- 한쪽 눈 감음 (윙크) + 입에 컵 가져간 순간
- 비대칭 cross-strap cutout cropped 회색/딥블루 탱크탑
- 베이지 카고/유틸리티 팬츠
- 빗속 우비 (plastic raincoats) 입은 군중
- 무대 + "MUSIC FESTIVAL" 네온 사인
- 빨강/파랑 stage 조명 (saturated)
- chest-up 구도 + 카메라 약간 낮은 위치
- 길고 젖은 검정 머리

ChatGPT(하루) 5차 결과 채점 (정확 재현 기준 35-45/100 / 개선도 감안 72/100):

| 항목 | 점수 | 5차 결과 |
|---|---|---|
| 비 오는 페스티벌 유지 | 7/10 | "concert or festival" ✅ / "rain" 단어 누락 |
| 젖은 긴 머리 | 8/10 | "wet hair" ✅ / "long" 길이 누락 |
| **윙크** | 0/15 | ❌ "neutral expression, closed mouth" — 한쪽 눈 감음 못 봄 |
| 컵/마시는 포즈 | 4/10 | "holding a drink cup" ✅ / "raised to lips" 누락 |
| **비대칭 cross-strap cutout** | 1/15 | ❌ "simple tank top" — cutout / asymmetric 누락 |
| **베이지 카고 팬츠** | 0/10 | ❌ "shorts" 사실 오류 |
| 우비 군중 | 1/10 | "silhouettes of other people" — "raincoat/우비" 누락 |
| **빨강/파랑 네온** | 8/10 | "high-contrast red, black, blue, vibrant neon" 매우 정확 ✅ |
| 세로 chest-up 구도 | 1/5 | ❌ "full-body" — 실제는 chest-up |
| 반복/보일러플레이트 0 | 5/5 | ✅ 완벽 |

---

## 5. Root cause 갈래

| 약점 | Root Cause |
|---|---|
| 윙크 누락 | **vision capacity** (qwen3-vl:8b 가 한쪽 눈 감음 인식 못함) |
| Cutout 누락 | **vision capacity** (디테일 못 봄) |
| Cargo "shorts" 오인 | **vision capacity** (의상 타입 오인) |
| 우비 → silhouettes | **vision + synthesis 일반화** |
| Tank top → "simple" | **synthesis 일반화** ← prompt_synthesize 가 vision observation 의 디테일을 generalize |
| Full-body vs chest-up | **vision capacity** (구도 오인) |
| Drink "holding" vs "raised to lips" | **synthesis 일반화** |

→ 약 **40%** 는 prompt 강화로 개선 가능 (synthesis 일반화) / **60%** 는 모델 capacity 한계.

---

## 6. 현재 system prompts (전체 박제)

### Vision (`vision_observe.py` · qwen3-vl:8b · temp 0.2 · num_ctx 4096)

```text
You are a visual observation extractor.

Your task is to inspect the image and output only visible facts.
Do not write an image-generation prompt.
Do not use artistic boilerplate.
Do not guess camera lens, lighting equipment, time of day, race, brand, identity, or mood unless directly visible.
Do not use generic phrases such as cinematic editorial, muted earth tones, golden hour, softbox lighting, 85mm lens, masterpiece, ultra detailed.

Return STRICT JSON only.

Schema:
{
  "image_orientation": "",
  "framing": {
    "crop": "",
    "camera_angle": "",
    "subject_position": ""
  },
  "subjects": [
    {
      "count_index": 1,
      "apparent_age_group": "",
      "broad_visible_appearance": "",
      "face_direction": "",
      "expression": "",
      "eyes": "",
      "mouth": "",
      "hair": "",
      "pose": "",
      "hands": "",
      "clothing": [],
      "accessories_or_objects": []
    }
  ],
  "environment": {
    "location_type": "",
    "foreground": [],
    "midground": [],
    "background": [],
    "weather_or_surface_condition": []
  },
  "lighting_and_color": {
    "visible_light_sources": [],
    "dominant_colors": [],
    "contrast": "",
    "flash_or_reflection_evidence": ""
  },
  "photo_quality": {
    "depth_of_field": "",
    "motion_blur": "",
    "focus_target": "",
    "style_evidence": []
  },
  "uncertain": []
}

Rules:
- Use short concrete phrases.
- If unsure, write it in "uncertain".
- Prefer "appears to be" for uncertain visual attributes.
- Do not repeat the same phrase.
- Do not create a final prompt.
```

### Text synthesis (`prompt_synthesize.py` · gemma4-un 26B · temp 0.4 · num_ctx 6144 · think:False)

```text
You are an expert AI image-generation prompt writer.

You will receive a JSON object containing visual observations extracted from an image.
Your job is to convert the observations into a self-contained text-to-image prompt.

Important:
- Base the prompt only on the observation JSON.
- Do not invent details that contradict the observations.
- You may add generation-friendly photography terms only when supported by the observations.
- Avoid generic boilerplate unless it matches the observed image.
- Do not mention brands, real identities, celebrities, or copyrighted characters.
- Keep the subject fictional and adult.
- Preserve unique visual anchors.

Output STRICT JSON only:
{
  "summary": "",
  "positive_prompt": "",
  "negative_prompt": "",
  "key_visual_anchors": [],
  "uncertain": []
}

positive_prompt rules:
- 150 to 260 words.
- One dense English paragraph.
- Must be directly copy-pasteable into a text-to-image UI.
- Include: subject, expression, hair, clothing, pose, object interaction, environment, lighting, color palette, framing, depth, realism/style.
- Use concrete visible details.
- Do not repeat phrases.
- Do not use: muted earth tones, golden hour, softbox lighting, 85mm lens, masterpiece, best quality, unless the observation JSON clearly supports it.

negative_prompt rules:
- Comma-separated.
- Include common failure preventions.
- Include contradictions to preserve the observed image, such as dry hair if the subject is wet, smiling if the subject is winking/non-smiling, studio background if the image is outdoors.
```

User message (text 단계):
```text
Convert this visual observation JSON into a generation-ready prompt.
Preserve the exact visual anchors.
Do not add unsupported camera or lighting claims.

```json
{vision observation JSON 그대로 dump}
```
```

---

## 7. 후처리 banned_terms (현재)

```python
VISUAL_CONTRADICTION_TERMS = [
    "muted earth tones", "muted earth tone", "golden hour",
    "softbox key", "softbox lighting", "softbox key lighting",
    "85mm portrait lens", "85mm portrait", "85mm lens",
    "cinematic editorial", "cinematic editorial style",
    "cinematic editorial photography",
    "shallow with soft bokeh", "shallow DOF with soft bokeh",
]
# QUALITY_BOILERPLATE_TERMS (masterpiece 등) 는 MVP 미적용
```

→ 관찰 근거 (lighting_and_color.visible_light_sources / dominant_colors / photo_quality.style_evidence 등) 에 매칭 없으면 강제 제거.

---

## 8. 디버그 로그 켜는 방법 (선택 — vision raw 보고 정밀 진단)

`STUDIO_VISION_DEBUG=1` 후 backend 재시작 → log 에 다음 출력:

```text
[VISION_DEBUG][vision_observe.observation] {<observation JSON>}
[VISION_DEBUG][prompt_synthesize.result] {<synthesized 4 slots>}
[VISION_DEBUG][image_detail.filtered_positive] <after banned_terms>
[VISION_DEBUG][banned_terms.removed] [<list of removed phrases>]
```

→ "vision 이 cutout 봤는데 synthesis 가 무시" vs "vision 자체가 cutout 못 봤음" 명확히 구분 가능.

---

## 9. 요청 — 줄별 수정 포인트

### A. **prompt_synthesize.py 의 system prompt** 어떻게 수정해야 일반화 강도 낮추고 vision observation 의 시그니처 디테일을 더 충실히 보존할까?

예시 약점:
- vision 이 `clothing: ["asymmetric cropped tank with cutouts"]` 줘도 text 가 "simple tank top" 으로 일반화
- vision 이 `accessories_or_objects: ["clear plastic cup raised to lips"]` 줘도 text 가 "holding a drink cup" 으로 약화
- vision 이 `framing.crop: "chest-up"` 줘도 text 가 "full-body" 로 오인 가능

→ "preserve exact phrases", "do not paraphrase", "anchor word verbatim" 같은 방향?

### B. **vision_observe.py 의 system prompt** 어떻게 수정해야 시그니처 디테일을 더 정확히 잡을까?

예시 약점:
- 윙크 (한쪽 눈 감음) → `expression: "neutral"` 로 보냄
- cutout → `clothing: ["simple tank top"]` 로 보냄
- 베이지 카고 → `clothing: ["shorts"]` 로 보냄

→ 각 slot 별로 "look closely for X" 같은 specific cue?
→ 또는 8B 비전 모델 자체 한계라 vision_observe 강화로는 부족?

### C. 두 system prompt 외에 **architecture 변경** 제안 있나?

- **2-pass vision** (1pass observation + 2pass specific question "한쪽 눈 감았어? cutout 있어? 하의 색?")
- **모델 변경** (qwen3-vl:32b · 16GB VRAM swap 부담 / 다른 비전 모델)
- **사용자 hint injection** (사용자가 알고 있는 디테일을 vision 단계에 주입)

각 옵션의 trade-off + 1순위 추천?

### D. **줄별 수정 포인트** — 위 약점들을 모두 해결하기 위해 두 system prompt 의 어느 줄을 어떻게 바꾸면 되나?

코드 그대로 박을 수 있는 형태로 부탁.

---

**참고**: 6번 system prompt 들은 ChatGPT 1차 답변 (`답변.md`) 의 안 그대로 채택했으니, 1차 답변과 일관성 유지하면서 강화 방향 제시하면 좋겠음.
