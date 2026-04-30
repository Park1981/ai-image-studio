"""
vision_pipeline/image_detail.py - Vision Analyzer recipe v2 (Phase 4.2 단계 4).

단일 이미지 -> 9-slot recipe JSON (재생성용 풀 프롬프트). _describe_image 폴백 +
_aspect_label 은 _common.py 에서 import.

spec 18 통합 (2026-04-26):
  단일 비전 분석을 "캡션" 에서 "재생성 레시피" 로 패러다임 전환.
  Codex + Claude 공동 spec - 9 슬롯 JSON 으로 재생성 가능한 풀 프롬프트 추출.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .._json_utils import coerce_str as _coerce_str
from .._json_utils import parse_strict_json as _parse_strict_json
from .._ollama_client import call_chat_payload
from ..presets import DEFAULT_OLLAMA_ROLES
from ..prompt_pipeline import translate_to_korean
from . import _common as _c


SYSTEM_VISION_DETAILED = (
    "You are a prompt engineer analyzing an image for reuse in a "
    "text-to-image generation prompt.\n\n"
    "Output a single English paragraph of 40-120 words that captures: "
    "subject, composition, lighting, mood, color palette, materials/textures, "
    "camera/lens feel, environment. "
    "Omit safety preambles. No bullets, no markdown. "
    "Return ONLY the paragraph."
)


SYSTEM_VISION_RECIPE_V2 = """You are a vision-to-prompt specialist. Given exactly ONE uploaded
SOURCE image and its aspect ratio, produce a structured recreation
recipe that lets a text-to-image model (Qwen Image 2512 family)
reproduce a visually similar result. Analyze only the visible content
inside that single bitmap. Do not compare against, refer to, or invent
any additional image.

Return STRICT JSON only (no markdown fences, no preamble, no trailing text):
{
  "summary": "<2-3 sentence concise English summary of what is visible>",
  "positive_prompt": "<150-300 word English t2i prompt, COMPREHENSIVE, SELF-CONTAINED, subject-FIRST ordering — prioritize completeness over brevity>",
  "negative_prompt": "<comma-separated list of things to avoid (image-specific + standard)>",
  "composition": "<framing, shot size, subject placement, layout (normally single-frame; only side-by-side/grid/collage if visibly separated panels exist)>",
  "subject": "<person/object identity: visible face features, body, expression, pose. If multiple visible subjects or panels actually exist, list each as numbered item>",
  "clothing_or_materials": "<attire, textures, condition, materials, surface details>",
  "environment": "<setting, foreground/middle/background structure, time, weather>",
  "lighting_camera_style": "<lighting setup (key/fill/rim, hour, color temp), lens feel (35mm f/1.4 / 85mm portrait / 24mm wide), DOF, color grading>",
  "uncertain": "<aspects that cannot be determined visually — explicitly list, do not guess>"
}

═══════════════════════════════════════════════════════════════════
CRITICAL RULE — positive_prompt SELF-CONTAINMENT
═══════════════════════════════════════════════════════════════════
positive_prompt is the PRIMARY copy-paste target. The user expects to
paste it into a t2i UI and get a similar image WITHOUT consulting the
other slots. Therefore:

- positive_prompt MUST INCORPORATE every key visual detail you list in
  composition / subject / clothing_or_materials / environment /
  lighting_camera_style slots.
- If you mention "85mm portrait lens" in lighting_camera_style, that
  exact lens detail MUST also appear in positive_prompt.
- If you mention "muted earth tones" in lighting_camera_style, that
  palette MUST appear in positive_prompt.
- If you list a multi-panel layout in composition, the layout MUST
  appear in positive_prompt. Only do this when the source bitmap has
  clear panel boundaries or separate frames.
- The other slots are AUGMENTATION/UI ANNOTATION — never substitutes
  for completeness in positive_prompt.

Ordering inside positive_prompt:
  subject -> composition/layout -> clothing/materials -> environment ->
  lighting/camera/lens -> color palette -> style anchors

═══════════════════════════════════════════════════════════════════
TONE — t2i-friendly mixed style + RICH detail
═══════════════════════════════════════════════════════════════════
Combine natural language sentences with comma-separated tag phrases.
Avoid pure descriptive paragraph tone ("She is facing...", "The
composition is..."). Prefer concrete tag-style phrases interleaved
with brief sentences.

LENGTH PRIORITY: Aim for 150-300 words in positive_prompt. Err on the
side of MORE detail. Better to over-describe than to lose visual cues.
Each visible detail (skin texture, fabric weave, hair flow direction,
catchlight position, shadow softness, color saturation) deserves at
least one descriptor.

═══════════════════════════════════════════════════════════════════
EXAMPLES — diverse domains, NOT centered passport-style only
═══════════════════════════════════════════════════════════════════
Adapt your prompt to the actual scene. Do not bias toward centered
portraits. Below are example positive_prompts across diverse domains:

[example A — environmental wide portrait, off-center]
"East Asian young woman leaning against a moss-covered tree, three-
quarter pose with weight on left hip, content half-smile, gaze drifting
upward to the canopy, long damp dark hair clinging to shoulders, gray
ribbed cotton tank top with subtle wet patches, olive utility shorts,
positioned right-third of frame following rule of thirds, dense
rainforest backdrop with cascading waterfall middle-ground and ferns
foreground, overcast diffused daylight with soft rim light from rear,
gentle rain visible as faint streaks, muted earth tones with cool teal
shadows in foliage, 35mm f/1.8 environmental portrait lens, shallow
DOF on subject with soft bokeh on rocks behind, naturalistic film
grain, cinematic editorial photography, ultra detailed."

[example B — food still life, top-down]
"Rustic ceramic bowl of ramen on weathered oak table, top-down 90°
overhead composition, bowl placed slightly upper-left of frame,
swirling steam captured mid-motion, glossy soy-tonkotsu broth surface
with floating chashu slices, soft-boiled egg halved revealing molten
yolk, crisp nori sheet at 2 o'clock, scallions scattered, chopsticks
laid diagonally lower-right, warm tungsten kitchen light from camera-
right at golden-hour color temperature, deep amber-brown palette with
emerald scallion accents, 50mm f/2.8 macro lens with razor-sharp focus
on egg yolk and gentle fall-off on table edges, film stock rendering,
moody food photography, restaurant editorial style, ultra detailed."

[example C — landscape, wide aspect]
"Aerial view of winding mountain road carving through autumn maple
forest, captured from drone perspective at 30° downward angle, road
diagonal from lower-left to upper-right, vehicle absent, dense crimson
and amber canopy filling 80% of frame, narrow blue river snaking
parallel in middle-ground, distant misty peaks at top edge, golden
hour low-angle sunlight from camera-right casting long warm shadows,
saturated reds and oranges with cool blue-violet shadow accents,
24mm wide-angle lens, deep DOF with everything sharp, atmospheric
haze, dramatic landscape photography, National Geographic style,
ultra detailed."

[example D — single product, studio]
"Vintage brass camera lens placed on textured charcoal felt surface,
extreme close-up macro shot, lens aperture ring slightly tilted at
15° toward camera-left, brass body with patina showing natural wear
and oily fingerprints, glass element catching ring-light reflection,
small "f/2.8" engraving readable, single softbox key from upper-
right at 45°, no fill light creating dramatic chiaroscuro shadows,
warm vintage tones with deep blacks and amber metal highlights, 100mm
f/8 macro lens, deep DOF with everything pin-sharp, product
photography studio style, ultra detailed."

CRITICAL: Match the example shape to the actual image domain (person /
food / landscape / product / etc). Do NOT default to centered portrait
phrasing for non-portrait images.

Example positive_prompt (good):
"young woman, long dark hair, white tank top, neutral expression,
centered composition, subject fills frame, soft diffused 85mm portrait
lighting, even illumination, muted earth tones, minimalistic plain
light backdrop, soft shadows, clean modern editorial photography style,
ultra detailed, high resolution"

Bad (too descriptive):
"A young woman with long dark hair is wearing a tank top. She is
facing the camera. The composition is centered..."

═══════════════════════════════════════════════════════════════════
DEFAULT SINGLE-IMAGE ANCHOR
═══════════════════════════════════════════════════════════════════
The API call attaches ONE source image. Default to a single-frame
description unless the bitmap itself visibly contains distinct panels,
a grid, a collage, a before/after split, or multiple separated photo
frames.

- Never use ordinal image labels such as first/second/another image
  for a normal single photo.
- Never split one visible person into left/right subjects just because
  different clothing regions, body parts, mirror reflections, or
  background areas are visible.
- If one person is visible in one continuous bathroom/selfie/photo
  scene, describe one subject, one pose, one environment.
- If uncertain whether a faint boundary is a panel edge or a normal
  object/background line, choose single-frame and record uncertainty
  in "uncertain".

═══════════════════════════════════════════════════════════════════
MULTI-SUBJECT HANDLING
═══════════════════════════════════════════════════════════════════
Use multi-subject or multi-panel wording ONLY when the image visibly
contains more than one distinct main subject OR clearly separated
layout panels inside the single bitmap.

1) summary: explicitly mention the observed group or panel structure.
2) composition: describe the layout as a first-class visible detail.
3) subject: describe each distinct subject/panel as a numbered list.
4) positive_prompt: include the same layout, but do not add panels or
   subjects beyond what is visibly present.

═══════════════════════════════════════════════════════════════════
GENERAL RULES
═══════════════════════════════════════════════════════════════════
Identity inference policy (2026-04-26 — broad race allowed):
- BROAD race / appearance category: ALLOWED when visually evident.
  Use these labels: "East Asian", "South Asian", "Southeast Asian",
  "Caucasian", "African / Black", "Hispanic / Latin", "Middle Eastern",
  "Mixed / ambiguous". Include in subject and positive_prompt.
- SPECIFIC nationality (Korean, Japanese, Chinese, etc.): list in
  "uncertain" UNLESS strong visual evidence (e.g. hanbok, kimono,
  cultural-specific signage). Visual cues from face alone are NOT
  sufficient — East/South/Southeast Asian appearances overlap heavily.
- AGE: rough range only ("young adult", "middle-aged"). Specific age
  (e.g. "23 years old") goes to "uncertain".
- NAME / PERSONAL identity: never infer. Always "uncertain".

Other rules:
- negative_prompt must include image-specific avoids
  (e.g. "smiling" if original is neutral, "color shift" if mono palette)
  PLUS standard t2i guards (extra fingers, blurry, lowres, watermark,
  text artifacts, oversaturated, plastic skin).
- Use concrete t2i vocabulary: specific lens (35mm, 50mm, 85mm),
  lighting type (golden hour rim, softbox key, north window diffused,
  overcast soft, harsh midday sun), color grading (teal-orange,
  muted earth tones, pastel film stock, high contrast b&w).
- All field values are strings (never null). If truly empty, use "".
"""


@dataclass
class VisionAnalysisResult:
    """analyze_image_detailed 결과.

    레거시 필드 (옛 row 호환):
      - en: 메인 영문 단락 (v2 에선 summary + positive_prompt 합본 또는 폴백 단락)
      - ko: 한국어 번역 (실패 시 None)
      - fallback=True: 비전 호출 자체 실패
      - ko=None: 번역만 실패

    Vision Recipe v2 슬롯 (2026-04-26 spec 18):
      모두 빈 문자열 가능 — 폴백 경로(JSON 파싱 실패)에선 모두 "" 로 채움.
      프론트는 positive_prompt 가 비면 옛 row 로 판정해 자동 폴백 UI.
    """

    en: str
    ko: str | None
    provider: str  # "ollama" | "fallback"
    fallback: bool

    # ── v2 9 슬롯 (옛 row 는 모두 "" — 프론트 자동 폴백) ──
    summary: str = ""
    positive_prompt: str = ""
    negative_prompt: str = ""
    composition: str = ""
    subject: str = ""
    clothing_or_materials: str = ""
    environment: str = ""
    lighting_camera_style: str = ""
    uncertain: str = ""


async def _call_vision_recipe_v2(
    image_bytes: bytes,
    *,
    width: int,
    height: int,
    vision_model: str,
    timeout: float,
    ollama_url: str,
) -> str:
    """qwen2.5vl 에 SOURCE 이미지 + width/height → raw JSON 응답 (spec 18).

    user message 에 width/height + ratio_label 명시 — 모델이 composition 추정 안 해도 됨.
    Ollama format=json 으로 JSON 안정화. 실패 시 빈 문자열.
    """
    ratio_label = _c._aspect_label(width, height)
    user_content = (
        f"Exactly one SOURCE image is attached. Aspect: {width}×{height} ({ratio_label}).\n"
        "Analyze this single image only. Do not mention a second image or "
        "split it into multiple frames unless clear panel boundaries are "
        "visible inside the bitmap.\n"
        "Produce the recreation recipe in STRICT JSON as specified.\n"
        "Return JSON only, no preamble, no markdown."
    )
    payload = {
        "model": vision_model,
        "messages": [
            {"role": "system", "content": SYSTEM_VISION_RECIPE_V2},
            {
                "role": "user",
                "content": user_content,
                "images": [_c._to_base64(image_bytes)],
            },
        ],
        "stream": False,
        "format": "json",
        # 2026-04-26: VRAM 즉시 반납
        "keep_alive": "0",
        "options": {"temperature": 0.4, "num_ctx": 8192},
    }
    try:
        return await call_chat_payload(
            ollama_url=ollama_url,
            payload=payload,
            timeout=timeout,
        )
    except Exception as e:
        _c.log.warning("vision recipe v2 call failed (%s): %s", vision_model, e)
        return ""


async def analyze_image_detailed(
    image_bytes: bytes,
    *,
    vision_model: str | None = None,
    text_model: str | None = None,
    ollama_url: str | None = None,
    timeout: float = _c.DEFAULT_TIMEOUT,
    width: int = 0,
    height: int = 0,
    progress_callback: _c.ProgressCallback | None = None,
) -> VisionAnalysisResult:
    """단일 이미지 → Vision Recipe v2 (9 슬롯 JSON) + 한글 번역.

    2026-04-26 spec 18 통합:
      1) SYSTEM_VISION_RECIPE_V2 + width/height 주입 → JSON 9 슬롯
      2) JSON 파싱 성공 시: summary 를 en 으로, ko 는 summary 번역
      3) JSON 파싱 실패 시: 옛 SYSTEM_VISION_DETAILED 로 폴백 (단락 영문) → 9 슬롯 빈 문자열
      4) 비전 호출 자체 실패: fallback=True, 모든 필드 빈 값

    HTTP 레이어 500 안 내는 원칙 — 프론트가 provider/fallback + positive_prompt 유무로 분기.
    """
    resolved_vision = vision_model or DEFAULT_OLLAMA_ROLES.vision
    resolved_text = text_model or DEFAULT_OLLAMA_ROLES.text
    resolved_url = ollama_url or _c._DEFAULT_OLLAMA_URL

    # Phase 6: callback 호출 헬퍼 — None 또는 예외 시 무영향 (분석 자체에 영향 없음).
    async def _signal(stage_type: str) -> None:
        if progress_callback is None:
            return
        try:
            await progress_callback(stage_type)
        except Exception as cb_err:  # pragma: no cover - 방어적
            _c.log.info("progress_callback raised (non-fatal): %s", cb_err)

    # ── 1단계: v2 JSON 호출 ──
    await _signal("vision-call")
    raw = await _call_vision_recipe_v2(
        image_bytes,
        width=width,
        height=height,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
    )

    parsed: dict[str, Any] | None = _parse_strict_json(raw) if raw else None

    if parsed is not None:
        # ── 2단계: 슬롯 정규화 (모두 string, None/non-str → "") ──
        slots = {
            "summary": _coerce_str(parsed.get("summary")),
            "positive_prompt": _coerce_str(parsed.get("positive_prompt")),
            "negative_prompt": _coerce_str(parsed.get("negative_prompt")),
            "composition": _coerce_str(parsed.get("composition")),
            "subject": _coerce_str(parsed.get("subject")),
            "clothing_or_materials": _coerce_str(parsed.get("clothing_or_materials")),
            "environment": _coerce_str(parsed.get("environment")),
            "lighting_camera_style": _coerce_str(parsed.get("lighting_camera_style")),
            "uncertain": _coerce_str(parsed.get("uncertain")),
        }

        # en 은 옛 호환 — summary + positive_prompt 합본 (사용자 화면용)
        # 옛 row 는 단락 1개 였으니 비슷한 형태로 보존
        en_combined = slots["summary"]
        if slots["positive_prompt"]:
            en_combined = (
                f"{slots['summary']}\n\n{slots['positive_prompt']}"
                if en_combined
                else slots["positive_prompt"]
            )

        # ko 번역 — summary 만 번역 (positive_prompt 는 t2i 입력용이라 영문 유지)
        ko: str | None = None
        if slots["summary"]:
            await _signal("translation")
            ko = await translate_to_korean(
                slots["summary"],
                model=resolved_text,
                timeout=60.0,
                ollama_url=resolved_url,
            )

        return VisionAnalysisResult(
            en=en_combined,
            ko=ko,
            provider="ollama",
            fallback=False,
            **slots,
        )

    # ── 3단계: JSON 파싱 실패 → 옛 단락 SYSTEM 폴백 ──
    _c.log.info("vision recipe v2 JSON parse failed — falling back to legacy paragraph")
    legacy_en = await _c._describe_image(
        image_bytes,
        vision_model=resolved_vision,
        timeout=timeout,
        ollama_url=resolved_url,
        system_prompt=SYSTEM_VISION_DETAILED,
        temperature=0.5,
    )
    if not legacy_en:
        # 비전 호출 자체 실패
        return VisionAnalysisResult(
            en="", ko=None, provider="fallback", fallback=True
        )

    await _signal("translation")
    legacy_ko = await translate_to_korean(
        legacy_en, model=resolved_text, timeout=60.0, ollama_url=resolved_url
    )
    # 9 슬롯 모두 빈 문자열로 — 프론트 자동 폴백 (positive_prompt 빈 = 옛 카드 표시)
    return VisionAnalysisResult(
        en=legacy_en,
        ko=legacy_ko,
        provider="ollama",
        fallback=False,
    )
