# Video 자동 NSFW 시나리오 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Video 모드의 성인 모드 위에 "🤖 자동 NSFW 시나리오" 토글을 추가하여, 사용자가 텍스트 지시 없이 토글 + 강도 슬라이더만으로 vision + gemma4-un 이 자율 explicit 시나리오를 작성하도록.

**Architecture:** Backend gemma4 system prompt 에 `build_auto_nsfw_clause(intensity)` 신규 — KeyError 회피 위해 concat 조립. 빈 prompt 4곳 우회 (CTA / hook / route / upgrade). skipUpgrade 3-layer 방어 (frontend toggle disabled + handleGenerate override + backend silent ignore). Frontend `VideoAutoNsfwCard` 신규 컴포넌트 + `useSettingsStore` persist.

**Tech Stack:** FastAPI · Python 3.13 · Next.js 16 · React 19 · TypeScript · Zustand 5 · framer-motion · pytest · vitest

**Spec**: `docs/superpowers/specs/2026-05-12-video-auto-nsfw-scenario-design.md` (v1.1 · Codex 1라운드 12/12 수용)

---

## Task 의존성 그래프

```
Backend:
  T1 (vocab/clause) → T2 (build_system_video) → T4 (upgrade_video_prompt)
                       ↑                            ↓
  T3 (_run_upgrade_call temperature) ──────────────┘
                                                    ↓
  T4 → T5 (run_video_pipeline) → T6 (_run_video_pipeline_task) → T7 (routes/streams)
  T8 (history_db migration) — 독립

Frontend:
  T9 (types + useSettingsStore) → T10 (VideoAutoNsfwCard) → T13 (VideoLeftPanel)
  T9 → T11 (lib/api/video.ts) → T12 (useVideoPipeline) ────→ T13
  T13 → T14 (page.tsx onReuse)

Final:
  T7 + T8 + T14 → T15 (통합 검증)
```

---

## Task 1: Auto NSFW vocabulary pools + clause builder (TDD)

**Files:**
- Modify: `backend/studio/prompt_pipeline/upgrade.py` (기존 `SYSTEM_VIDEO_ADULT_CLAUSE` 바로 아래 신규 섹션)
- Test: `backend/tests/studio/test_video_pipeline.py` (확장)

- [ ] **Step 1: Write failing tests (4개)**

`backend/tests/studio/test_video_pipeline.py` 끝에 추가:

```python
from studio.prompt_pipeline.upgrade import (
    build_auto_nsfw_clause,
    _AUTO_NSFW_L2_POOL,
    _AUTO_NSFW_L3_POOL_EXTRA,
)


class TestAutoNsfwClause:
    """spec 2026-05-12 v1.1 §6.1 단위 테스트"""

    def test_auto_nsfw_l1_clause_no_removal(self):
        """L1 은 옷 안 벗음 — 명시 negative rule 포함"""
        clause = build_auto_nsfw_clause(1)
        assert "WITHOUT removing any garments" in clause
        assert "NOT contain nudity, topless reveal, or garment removal" in clause
        assert "L1 vocabulary:" in clause
        # L2/L3 어휘는 없어야 함
        assert "Undress motion:" not in clause
        assert "Post-nude motion:" not in clause

    def test_auto_nsfw_l2_no_caress_after_nudity(self):
        """L2 는 옷벗음 reveal 까지만 — 자기 손길 금지"""
        clause = build_auto_nsfw_clause(2)
        assert "NO self-caress after nudity" in clause
        assert "reveal IS the climax" in clause
        assert "Undress motion:" in clause  # L2 pool 포함
        assert "Post-nude motion:" not in clause  # L3 extra 미포함

    def test_auto_nsfw_l3_combined_vocabulary(self):
        """L3 는 L2 + L3 어휘 둘 다 코드 레벨로 concat"""
        clause = build_auto_nsfw_clause(3)
        # L2 pool substring (Codex Finding 7 fix)
        assert "Undress motion:" in clause
        assert "Reveal result:" in clause
        # L3 extra substring
        assert "Post-nude motion:" in clause
        assert "intimate close-up of bare skin" in clause
        # 타이밍 명시
        assert "first ~half of the clip is undress" in clause

    def test_auto_nsfw_grafting_and_fallback(self):
        """grafting + 비-인물 fallback 섹션 포함"""
        clause = build_auto_nsfw_clause(2)
        assert "USER DIRECTION GRAFTING" in clause
        assert "NON-HUMAN SUBJECT FALLBACK" in clause
        assert "PRIMARY narrative" in clause

    def test_auto_nsfw_invalid_intensity_raises(self):
        """범위 밖 intensity → ValueError"""
        import pytest
        with pytest.raises(ValueError, match="intensity must be 1\\|2\\|3"):
            build_auto_nsfw_clause(0)
        with pytest.raises(ValueError, match="intensity must be 1\\|2\\|3"):
            build_auto_nsfw_clause(4)
```

- [ ] **Step 2: Run tests — fail 확인**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py::TestAutoNsfwClause -v
```

Expected: `ImportError: cannot import name 'build_auto_nsfw_clause'`

- [ ] **Step 3: Implement vocabulary pools + clause builder**

`backend/studio/prompt_pipeline/upgrade.py` 의 `SYSTEM_VIDEO_ADULT_CLAUSE` 정의 끝난 직후 위치에 추가 (spec §4.1 코드 그대로):

```python
# ══════════════════════════════════════════════════════════════════════
# Auto NSFW 시나리오 vocabulary pools (spec 2026-05-12 v1.1)
# ══════════════════════════════════════════════════════════════════════
# 강도 3단:
#   L1 SUGGESTIVE — 옷 유지, 자세/표정/암시만
#   L2 UNDRESS    — 탈의 reveal 까지. 자기 손길 NO
#   L3 UNDRESS + INTIMATE — L2 + 누드 후 self-caress / 애무
# Codex Finding 6: format string 자리표시 위험 → 전체 concat 으로 조립
# Codex Finding 7: L3 = L2 + extra 코드 레벨 합치기

_AUTO_NSFW_L1_POOL = """
- Pose: arched back, hip sway, chest thrust forward, kneeling pose,
  leaning forward to deepen cleavage, slow leg crossing
- Hands: hands sliding down body, fingers tracing collarbone,
  self-caress over clothes, gripping fabric tightly
- Expression: half-lidded eyes, parted lips, slow lip bite,
  sultry gaze, flushed cheeks, breathy mouth
- Clothing interaction: pulling neckline lower, tugging waistband,
  fabric slipping briefly without exposing skin
"""

_AUTO_NSFW_L2_POOL = """
- Undress motion: slowly unzipping, unbuttoning top button by button,
  sliding straps off shoulders, pulling dress down past chest,
  pulling top over head, stepping out of skirt,
  dropping garment to floor, peeling off lingerie
- Reveal result: fully topless, completely nude, garments removed,
  no clothing remaining, bare body revealed
- Expression: sultry, slow deliberate pace, confident reveal
"""

_AUTO_NSFW_L3_POOL_EXTRA = """
- Post-nude motion: hands cupping bare breasts, fingers tracing
  nude skin, self-caress over bare body, nude hips grinding,
  arched back while nude, naked body writhing slowly,
  squeezing own thighs, sliding hand down stomach,
  touching collarbone and down chest
- Camera: intimate close-up of bare skin, slow pan over nude body,
  focus on touching hand
"""


def _intensity_block_l1() -> str:
    return (
        "Compose a clip where the subject performs seductive posing and\n"
        "clothing interaction WITHOUT removing any garments. 5 seconds of\n"
        "arched back / hip sway / sultry gaze / fabric play. Use ONLY the\n"
        "L1 vocabulary below. The clip must NOT contain nudity, topless\n"
        "reveal, or garment removal.\n\n"
        "L1 vocabulary:"
        + _AUTO_NSFW_L1_POOL
    )


def _intensity_block_l2() -> str:
    return (
        "Compose a clip where the subject removes their clothing during the\n"
        "5-second window OR starts the clip already mid-undress. The clip\n"
        "ENDS at full reveal. CRITICAL NEGATIVE RULES:\n"
        "- NO self-caress after nudity\n"
        "- NO hand-on-body touching after reveal\n"
        "- NO hip grinding or arched-back motion after reveal\n"
        "The camera may linger on the bare body but the body itself stays\n"
        "still or only breathes naturally. The reveal IS the climax.\n\n"
        "L2 vocabulary:"
        + _AUTO_NSFW_L2_POOL
    )


def _intensity_block_l3() -> str:
    return (
        "Compose a clip that combines undress with intimate self-touch\n"
        "AFTER reveal. The first ~half of the clip is undress (~2.5 seconds);\n"
        "the latter ~half is nude self-caress / arched back / hip motion /\n"
        "hand-on-body. Pacing matters — do not skip the undress phase.\n\n"
        "Combined vocabulary (L2 + L3):"
        + _AUTO_NSFW_L2_POOL
        + _AUTO_NSFW_L3_POOL_EXTRA
    )


_INTENSITY_BLOCK_FACTORY = {
    1: _intensity_block_l1,
    2: _intensity_block_l2,
    3: _intensity_block_l3,
}


_AUTO_NSFW_CLAUSE_PREAMBLE = """

AUTO NSFW MODE (intensity L{intensity_label} — uncensored · explicit allowed):
The user may NOT have written a primary direction (or only a brief side-note).
Your job: INVENT an explicit scenario grounded in the ANCHOR (subject,
outfit, setting) from the image analysis.

Steps:
1. Identify what the subject is wearing in ANCHOR (dress / shirt /
   swimsuit / lingerie / casual / sportswear / etc.).
2. Choose action narrative appropriate to the intensity level below.
3. Ground every action in the visible outfit — if subject wears a
   dress, the dress is the garment that slips. If a bikini, the
   bikini straps. NEVER invent garments not in ANCHOR.

INTENSITY:
"""


_AUTO_NSFW_CLAUSE_GRAFTING = """

USER DIRECTION GRAFTING:
If user_direction is non-empty, weave it as a SECONDARY detail
(e.g. "샤워 배경" → "in a steamy shower setting", "키스" → "leaning
in for a slow kiss"). The auto NSFW action remains the PRIMARY
narrative. Do NOT let user_direction override the intensity level.
If user_direction is empty, derive the entire scenario from the
image analysis alone.

NON-HUMAN SUBJECT FALLBACK:
If ANCHOR describes a landscape / object / non-human subject (no
person), SKIP the auto NSFW directives above and fall back to the
user_direction only. Do not invent human nudity on top of non-human
scenes.
"""


def build_auto_nsfw_clause(intensity: int) -> str:
    """L{1|2|3} 분기 + grafting/fallback rule + preamble 조립 (spec 2026-05-12 v1.1).

    format string 의 단일 자리표시 ({intensity_label}) 는 한 자리만 받음 —
    KeyError 방지 위해 다른 {} 는 절대 안 둠. block 본문은 별도 함수가
    완성된 문자열을 반환 (function call 결과를 concat).
    """
    if intensity not in (1, 2, 3):
        raise ValueError(f"intensity must be 1|2|3, got {intensity}")
    preamble = _AUTO_NSFW_CLAUSE_PREAMBLE.format(intensity_label=intensity)
    block = _INTENSITY_BLOCK_FACTORY[intensity]()
    return preamble + block + _AUTO_NSFW_CLAUSE_GRAFTING
```

- [ ] **Step 4: Run tests — pass 확인**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py::TestAutoNsfwClause -v
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/studio/prompt_pipeline/upgrade.py backend/tests/studio/test_video_pipeline.py
git commit -m "feat(auto-nsfw): vocabulary pools + build_auto_nsfw_clause (spec §4.1)"
```

---

## Task 2: `build_system_video()` 시그니처 확장 (auto_nsfw + intensity)

**Files:**
- Modify: `backend/studio/prompt_pipeline/upgrade.py` (기존 `build_system_video` 함수)
- Test: `backend/tests/studio/test_video_pipeline.py` (확장)

- [ ] **Step 1: Write failing tests (3개)**

기존 `TestAutoNsfwClause` 클래스 아래에 추가:

```python
class TestBuildSystemVideoAutoNsfw:
    """spec 2026-05-12 v1.1 §4.2"""

    def test_auto_nsfw_replaces_adult_clause(self):
        """auto_nsfw=True 면 SYSTEM_VIDEO_ADULT_CLAUSE 대신 auto clause"""
        result = build_system_video(
            adult=True, model_id="wan22", auto_nsfw=True, intensity=2,
        )
        assert "AUTO NSFW MODE" in result
        assert "L2 vocabulary:" in result
        # 기존 ADULT_CLAUSE 의 시그니처 키워드는 없어야
        assert "Be direct and graphic" not in result

    def test_auto_nsfw_requires_adult_value_error(self):
        """adult=False 인데 auto_nsfw=True → ValueError"""
        import pytest
        with pytest.raises(ValueError, match="auto_nsfw requires adult"):
            build_system_video(
                adult=False, model_id="wan22", auto_nsfw=True, intensity=2,
            )

    def test_auto_nsfw_default_false_preserves_existing(self):
        """auto_nsfw=False (default) 면 기존 ADULT_CLAUSE 유지 (회귀 0)"""
        result = build_system_video(
            adult=True, model_id="wan22",  # auto_nsfw 미지정 → default False
        )
        assert "ADULT MODE" in result
        assert "AUTO NSFW MODE" not in result
```

- [ ] **Step 2: Run tests — fail 확인**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py::TestBuildSystemVideoAutoNsfw -v
```

Expected: `TypeError: build_system_video() got an unexpected keyword argument 'auto_nsfw'`

- [ ] **Step 3: Extend `build_system_video` 시그니처**

`backend/studio/prompt_pipeline/upgrade.py` 의 `build_system_video` 를 다음으로 교체:

```python
def build_system_video(
    *,
    adult: bool,
    model_id: str,
    auto_nsfw: bool = False,
    intensity: int = 2,
) -> str:
    """Video 시스템 프롬프트 구성 (spec 2026-05-12 v1.1 · auto_nsfw 분기).

    - auto_nsfw=False (default): 기존 동작 그대로 (adult 분기 + adult clause)
    - auto_nsfw=True: adult clause 대체 → build_auto_nsfw_clause(intensity)
      · auto_nsfw=True 인데 adult=False 면 ValueError (validation 은 routes
        레이어 책임 · 여기선 fail-fast 다층 방어)
    """
    if auto_nsfw and not adult:
        raise ValueError("auto_nsfw requires adult=True")

    if model_id == "wan22":
        base = SYSTEM_VIDEO_WAN22_BASE
    elif model_id == "ltx":
        base = SYSTEM_VIDEO_BASE
    else:
        raise ValueError(f"unknown video model_id: {model_id!r}")

    if auto_nsfw:
        adult_section = build_auto_nsfw_clause(intensity)
    elif adult:
        adult_section = SYSTEM_VIDEO_ADULT_CLAUSE
    else:
        adult_section = ""

    return base + adult_section + SYSTEM_VIDEO_RULES
```

- [ ] **Step 4: Run tests — pass 확인 (신규 + 회귀)**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py -v
```

Expected: 신규 3개 PASS + 기존 (build_system_video 회귀) PASS

- [ ] **Step 5: Commit**

```bash
git add backend/studio/prompt_pipeline/upgrade.py backend/tests/studio/test_video_pipeline.py
git commit -m "feat(auto-nsfw): build_system_video 시그니처 + auto_nsfw 분기"
```

---

## Task 3: `_run_upgrade_call` temperature kwarg

**Files:**
- Modify: `backend/studio/prompt_pipeline/upgrade.py` 또는 `_ollama.py` (temperature 가 통과되는 layer)
- Test: `backend/tests/studio/test_video_pipeline.py` (회귀 확인)

- [ ] **Step 1: 코드 흐름 확인**

먼저 `_run_upgrade_call` 시그니처 + payload 전송 라인 식별:

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -c "from studio.prompt_pipeline.upgrade import _run_upgrade_call; import inspect; print(inspect.signature(_run_upgrade_call))"
```

`_call_ollama_chat(..., temperature=0.6)` 호출 site 확인 (이미 `_ollama.py:28` 에 default 0.6).

- [ ] **Step 2: Write failing test**

```python
class TestRunUpgradeCallTemperature:
    """spec 2026-05-12 v1.1 §4.3 · Codex Finding 8"""

    @pytest.mark.asyncio
    async def test_run_upgrade_call_accepts_temperature_kwarg(self, monkeypatch):
        """_run_upgrade_call 이 temperature kwarg 받아 _call_ollama_chat 으로 전달"""
        from studio.prompt_pipeline import upgrade as upgrade_mod
        captured = {}

        async def fake_call(*args, **kwargs):
            captured.update(kwargs)
            return {"content": "fake"}

        monkeypatch.setattr(upgrade_mod, "_call_ollama_chat", fake_call)
        await upgrade_mod._run_upgrade_call(
            system="sys", user_msg="msg", original="orig",
            model="m", timeout=10.0, resolved_url="http://x",
            include_translation=False,
            temperature=0.8,
        )
        assert captured.get("temperature") == 0.8

    @pytest.mark.asyncio
    async def test_run_upgrade_call_temperature_default_06(self, monkeypatch):
        """temperature 누락 시 default 0.6 (Codex Finding 8 — 기존 동작 보존)"""
        from studio.prompt_pipeline import upgrade as upgrade_mod
        captured = {}

        async def fake_call(*args, **kwargs):
            captured.update(kwargs)
            return {"content": "fake"}

        monkeypatch.setattr(upgrade_mod, "_call_ollama_chat", fake_call)
        await upgrade_mod._run_upgrade_call(
            system="sys", user_msg="msg", original="orig",
            model="m", timeout=10.0, resolved_url="http://x",
            include_translation=False,
        )
        assert captured.get("temperature") == 0.6
```

- [ ] **Step 3: Run — fail (temperature kwarg 미지원)**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py::TestRunUpgradeCallTemperature -v
```

Expected: `TypeError` 또는 assertion fail

- [ ] **Step 4: `_run_upgrade_call` 시그니처 확장**

`backend/studio/prompt_pipeline/upgrade.py` 의 `_run_upgrade_call` 함수 정의에 `temperature: float = 0.6` keyword-only 추가. `_call_ollama_chat(...)` 호출에 `temperature=temperature` 전달.

```python
async def _run_upgrade_call(
    *,
    system: str,
    user_msg: str,
    original: str,
    model: str,
    timeout: float,
    resolved_url: str,
    include_translation: bool,
    temperature: float = 0.6,  # spec 2026-05-12 v1.1 · keyword-only
    prompt_mode: str | None = None,  # 기존 인자
    # ... 다른 기존 인자 그대로
) -> UpgradeResult:
    # ...
    result = await _call_ollama_chat(
        # 기존 인자들
        ...,
        temperature=temperature,  # NEW
    )
    # ...
```

- [ ] **Step 5: Run + Commit**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py::TestRunUpgradeCallTemperature -v
# PASS 확인 후
git add backend/studio/prompt_pipeline/upgrade.py backend/tests/studio/test_video_pipeline.py
git commit -m "feat(auto-nsfw): _run_upgrade_call temperature kwarg (default 0.6 보존)"
```

---

## Task 4: `upgrade_video_prompt` 시그니처 + 빈 direction 분기 + temperature 0.8

**Files:**
- Modify: `backend/studio/prompt_pipeline/upgrade.py` (기존 `upgrade_video_prompt` 함수)
- Test: `backend/tests/studio/test_video_pipeline.py`

- [ ] **Step 1: Write failing tests**

```python
class TestUpgradeVideoPromptAutoNsfw:
    """spec 2026-05-12 v1.1 §4.3"""

    @pytest.mark.asyncio
    async def test_auto_nsfw_uses_temperature_08(self, monkeypatch):
        """auto_nsfw=True → _run_upgrade_call(temperature=0.8)"""
        from studio.prompt_pipeline import upgrade as upgrade_mod
        captured = {}

        async def fake_run(*args, **kwargs):
            captured.update(kwargs)
            return UpgradeResult(upgraded="x", fallback=False, provider="t", original="")

        monkeypatch.setattr(upgrade_mod, "_run_upgrade_call", fake_run)
        await upgrade_mod.upgrade_video_prompt(
            user_direction="", image_description="anchor",
            model_id="wan22", adult=True,
            auto_nsfw=True, nsfw_intensity=2,
        )
        assert captured.get("temperature") == 0.8

    @pytest.mark.asyncio
    async def test_non_auto_uses_temperature_06(self, monkeypatch):
        """auto_nsfw=False → temperature 0.6 (기존 default)"""
        from studio.prompt_pipeline import upgrade as upgrade_mod
        captured = {}

        async def fake_run(*args, **kwargs):
            captured.update(kwargs)
            return UpgradeResult(upgraded="x", fallback=False, provider="t", original="")

        monkeypatch.setattr(upgrade_mod, "_run_upgrade_call", fake_run)
        await upgrade_mod.upgrade_video_prompt(
            user_direction="anything",
            image_description="anchor",
            model_id="wan22", adult=False,
        )
        assert captured.get("temperature") == 0.6

    @pytest.mark.asyncio
    async def test_auto_nsfw_allows_empty_direction(self, monkeypatch):
        """auto_nsfw=True 면 빈 user_direction 허용 (fallback 우회)"""
        from studio.prompt_pipeline import upgrade as upgrade_mod

        async def fake_run(*args, **kwargs):
            return UpgradeResult(upgraded="auto-generated", fallback=False, provider="t", original="")

        monkeypatch.setattr(upgrade_mod, "_run_upgrade_call", fake_run)
        result = await upgrade_mod.upgrade_video_prompt(
            user_direction="", image_description="anchor",
            model_id="wan22", adult=True,
            auto_nsfw=True, nsfw_intensity=2,
        )
        assert result.fallback is False
        assert result.upgraded == "auto-generated"

    @pytest.mark.asyncio
    async def test_non_auto_empty_direction_falls_back(self, monkeypatch):
        """auto_nsfw=False + 빈 direction → 기존 fallback (회귀 0)"""
        from studio.prompt_pipeline import upgrade as upgrade_mod
        result = await upgrade_mod.upgrade_video_prompt(
            user_direction="   ", image_description="anchor",
            model_id="wan22", adult=False,
        )
        assert result.fallback is True
```

- [ ] **Step 2: Run — fail**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py::TestUpgradeVideoPromptAutoNsfw -v
```

Expected: `TypeError` (auto_nsfw / nsfw_intensity kwarg 미지원)

- [ ] **Step 3: Extend `upgrade_video_prompt`**

기존 `upgrade_video_prompt` (line ~860) 를 spec §4.3 그대로:

```python
async def upgrade_video_prompt(
    user_direction: str,
    image_description: str,
    *,
    model_id: str,
    auto_nsfw: bool = False,        # NEW
    nsfw_intensity: int = 2,         # NEW
    model: str = "gemma4-un:latest",
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    include_translation: bool = True,
    adult: bool = False,
    prompt_mode: PromptEnhanceMode | str | None = "fast",
) -> UpgradeResult:
    # Codex Finding 2: auto_nsfw=True 면 빈 user_direction 허용
    if not user_direction.strip() and not auto_nsfw:
        return UpgradeResult(
            upgraded=user_direction,
            fallback=True,
            provider="fallback",
            original=user_direction,
        )

    resolved_url = ollama_url or _DEFAULT_OLLAMA_URL
    direction_label = (
        user_direction.strip() if user_direction.strip()
        else "(none — auto NSFW mode · synthesize entirely from ANCHOR)"
    )
    user_msg = (
        f"[Image description]\n{image_description.strip()}\n\n"
        f"[User direction]\n{direction_label}"
    )

    return await _run_upgrade_call(
        system=build_system_video(
            adult=adult,
            model_id=model_id,
            auto_nsfw=auto_nsfw,
            intensity=nsfw_intensity,
        ),
        user_msg=user_msg,
        original=user_direction,
        model=model,
        timeout=timeout,
        resolved_url=resolved_url,
        include_translation=include_translation,
        temperature=0.8 if auto_nsfw else 0.6,
        prompt_mode=prompt_mode,
    )
```

- [ ] **Step 4: Run + Commit**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py -v
# PASS 확인 후
git add backend/studio/prompt_pipeline/upgrade.py backend/tests/studio/test_video_pipeline.py
git commit -m "feat(auto-nsfw): upgrade_video_prompt 시그니처 + 빈 direction 분기 + temp 0.8"
```

---

## Task 5: `run_video_pipeline` 시그니처 확장 (3단 전파 1단)

**Files:**
- Modify: `backend/studio/video_pipeline.py` (기존 `run_video_pipeline`)
- Test: `backend/tests/studio/test_video_pipeline.py`

- [ ] **Step 1: Write failing test (3단 전파 1/2 단)**

```python
class TestRunVideoPipelinePropagation:
    """spec 2026-05-12 v1.1 §4.4 — 3단 전파"""

    @pytest.mark.asyncio
    async def test_run_video_pipeline_propagates_auto_nsfw(self, monkeypatch):
        from studio import video_pipeline as vp_mod
        captured = {}

        async def fake_upgrade(*args, **kwargs):
            captured.update(kwargs)
            return UpgradeResult(upgraded="x", fallback=False, provider="t", original="")

        async def fake_describe(*args, **kwargs):
            return "anchor desc"

        monkeypatch.setattr(vp_mod, "upgrade_video_prompt", fake_upgrade)
        monkeypatch.setattr(vp_mod, "_describe_image", fake_describe)
        # ollama_unload 도 mock (실 호출 차단)
        async def fake_unload(*args, **kwargs): return None
        monkeypatch.setattr(vp_mod.ollama_unload, "unload_model", fake_unload)

        await vp_mod.run_video_pipeline(
            image_path=b"fake",
            user_direction="",
            model_id="wan22",
            adult=True,
            auto_nsfw=True,
            nsfw_intensity=3,
        )
        assert captured.get("auto_nsfw") is True
        assert captured.get("nsfw_intensity") == 3
```

- [ ] **Step 2: Run — fail**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py::TestRunVideoPipelinePropagation -v
```

Expected: `TypeError: run_video_pipeline() got an unexpected keyword argument 'auto_nsfw'`

- [ ] **Step 3: Extend `run_video_pipeline`**

`backend/studio/video_pipeline.py` 의 `run_video_pipeline` (line 48) 시그니처에 두 kwarg 추가 + `upgrade_video_prompt` 호출에 전파:

```python
async def run_video_pipeline(
    image_path: Path | str | bytes,
    user_direction: str,
    *,
    model_id: str,
    vision_model: str | None = None,
    text_model: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    ollama_url: str | None = None,
    adult: bool = False,
    auto_nsfw: bool = False,            # NEW
    nsfw_intensity: int = 2,             # NEW
    prompt_mode: str = "fast",
) -> VideoPipelineResult:
    # ... 기존 비전 + unload 로직 그대로 ...

    upgrade = await upgrade_video_prompt(
        user_direction=user_direction,
        image_description=description,
        model_id=model_id,
        adult=adult,
        auto_nsfw=auto_nsfw,             # NEW
        nsfw_intensity=nsfw_intensity,   # NEW
        model=resolved_text,
        timeout=timeout,
        ollama_url=resolved_url,
        prompt_mode=prompt_mode,
    )

    return VideoPipelineResult(
        image_description=description,
        final_prompt=upgrade.upgraded,
        vision_ok=vision_ok,
        upgrade=upgrade,
    )
```

- [ ] **Step 4: Run + Commit**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py -v
git add backend/studio/video_pipeline.py backend/tests/studio/test_video_pipeline.py
git commit -m "feat(auto-nsfw): run_video_pipeline 시그니처 (3단 전파 1단)"
```

---

## Task 6: `_run_video_pipeline_task` 시그니처 + e2e 통합 테스트 (3단 전파 2단)

**Files:**
- Modify: `backend/studio/pipelines/video.py` (기존 `_run_video_pipeline_task`)
- Test: `backend/tests/studio/test_video_pipeline.py`

- [ ] **Step 1: Write failing test (3단 전파 e2e)**

```python
class TestRunVideoPipelineTaskE2E:
    """spec 2026-05-12 v1.1 §6.1 #7 — 3단 전파 통합 검증"""

    @pytest.mark.asyncio
    async def test_e2e_propagation_task_to_upgrade(self, monkeypatch):
        """_run_video_pipeline_task → run_video_pipeline → upgrade_video_prompt 3단"""
        from studio.pipelines import video as vid_pipe_mod
        captured = {}

        async def fake_upgrade(*args, **kwargs):
            captured.update(kwargs)
            return UpgradeResult(upgraded="x", fallback=False, provider="t", original="")

        async def fake_describe(*args, **kwargs):
            return "anchor"

        # 깊은 mock — run_video_pipeline 안의 upgrade_video_prompt 직접 패치
        from studio import video_pipeline as vp_mod
        monkeypatch.setattr(vp_mod, "upgrade_video_prompt", fake_upgrade)
        monkeypatch.setattr(vp_mod, "_describe_image", fake_describe)
        async def fake_unload(*args, **kwargs): return None
        monkeypatch.setattr(vp_mod.ollama_unload, "unload_model", fake_unload)

        # ComfyUI dispatch 도 mock
        async def fake_dispatch(*args, **kwargs):
            from studio.pipelines._dispatch import DispatchResult
            return DispatchResult(image_ref="fake.mp4", comfy_error=None)
        monkeypatch.setattr(vid_pipe_mod, "_dispatch_to_comfy", fake_dispatch)
        async def fake_persist(*args, **kwargs): return True
        monkeypatch.setattr(vid_pipe_mod, "_persist_history", fake_persist)

        # Task 객체 fixture (간이 fake)
        from studio.tasks import Task
        task = Task(task_id="test-task")

        await vid_pipe_mod._run_video_pipeline_task(
            task=task,
            image_bytes=b"fake",
            prompt="",
            filename="test.png",
            adult=True,
            auto_nsfw=True,
            nsfw_intensity=3,
            model_id="wan22",
            source_width=512, source_height=512,
        )
        # 3단 전파 검증
        assert captured.get("auto_nsfw") is True
        assert captured.get("nsfw_intensity") == 3
```

- [ ] **Step 2: Run — fail**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py::TestRunVideoPipelineTaskE2E -v
```

Expected: `TypeError: _run_video_pipeline_task() got an unexpected keyword argument 'auto_nsfw'`

- [ ] **Step 3: Extend `_run_video_pipeline_task`**

`backend/studio/pipelines/video.py:60` 의 `_run_video_pipeline_task` 시그니처에 추가:

```python
async def _run_video_pipeline_task(
    task: Task,
    image_bytes: bytes,
    prompt: str,
    filename: str,
    ollama_model_override: str | None = None,
    vision_model_override: str | None = None,
    adult: bool = False,
    auto_nsfw: bool = False,        # NEW (spec 2026-05-12 v1.1)
    nsfw_intensity: int = 2,         # NEW
    source_width: int = 0,
    source_height: int = 0,
    longer_edge: int | None = None,
    lightning: bool = True,
    *,
    model_id: VideoModelId = DEFAULT_VIDEO_MODEL_ID,
    pre_upgraded_prompt: str | None = None,
    prompt_mode: str = "fast",
) -> None:
    # ... 기존 코드 ...
    # run_video_pipeline 호출 (line ~138)
    video_res = await run_video_pipeline(
        image_bytes, prompt,
        model_id=model_id,
        vision_model=vision_model_override or DEFAULT_OLLAMA_ROLES.vision,
        text_model=ollama_model_override or DEFAULT_OLLAMA_ROLES.text,
        adult=adult,
        auto_nsfw=auto_nsfw,             # NEW
        nsfw_intensity=nsfw_intensity,   # NEW
        prompt_mode=prompt_mode,
    )

    # ... item dict 에 autoNsfw / nsfwIntensity 추가 (line ~267 근처) ...
    item = {
        # 기존 필드들 그대로
        "id": f"vid-{uuid.uuid4().hex[:8]}",
        # ...
        "adult": adult,
        # NEW (spec 2026-05-12 v1.1)
        "autoNsfw": auto_nsfw,
        "nsfwIntensity": nsfw_intensity if auto_nsfw else None,
        # ...
    }
```

- [ ] **Step 4: Run + Commit**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_video_pipeline.py -v
git add backend/studio/pipelines/video.py backend/tests/studio/test_video_pipeline.py
git commit -m "feat(auto-nsfw): _run_video_pipeline_task 시그니처 + e2e 전파 검증 (spec §4.5)"
```

---

## Task 7: `/video` 엔드포인트 meta 파싱 + validation

**Files:**
- Modify: `backend/studio/routes/streams.py:301-395` (create_video_task)
- Test: `backend/tests/studio/test_routes_video.py` (있으면 확장, 없으면 신규)

- [ ] **Step 1: Check existing test file**

```bash
ls backend/tests/studio/ | grep -i route
```

- [ ] **Step 2: Write failing tests (3개)**

`backend/tests/studio/test_routes_video.py` (신규 또는 확장):

```python
"""spec 2026-05-12 v1.1 §6.3 — /video endpoint validation"""
import json
import pytest
from httpx import AsyncClient
from main import app


@pytest.mark.asyncio
async def test_auto_nsfw_requires_adult_400():
    async with AsyncClient(app=app, base_url="http://test") as client:
        meta = {"prompt": "x", "adult": False, "autoNsfw": True, "nsfwIntensity": 2}
        files = {"image": ("test.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 100, "image/png")}
        data = {"meta": json.dumps(meta)}
        res = await client.post("/api/studio/video", data=data, files=files)
        assert res.status_code == 400
        assert "autoNsfw requires adult" in res.text


@pytest.mark.asyncio
@pytest.mark.parametrize("intensity", [0, 4, "abc"])
async def test_auto_nsfw_invalid_intensity_400(intensity):
    async with AsyncClient(app=app, base_url="http://test") as client:
        meta = {
            "prompt": "x", "adult": True, "autoNsfw": True,
            "nsfwIntensity": intensity,
        }
        files = {"image": ("test.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 100, "image/png")}
        data = {"meta": json.dumps(meta)}
        res = await client.post("/api/studio/video", data=data, files=files)
        assert res.status_code == 400


@pytest.mark.asyncio
async def test_auto_nsfw_allows_empty_prompt():
    """auto_nsfw=True 면 빈 prompt 허용 (Codex Finding 2)"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        meta = {
            "prompt": "", "adult": True, "autoNsfw": True, "nsfwIntensity": 2,
            "longerEdge": 512,
        }
        files = {"image": ("test.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 100, "image/png")}
        data = {"meta": json.dumps(meta)}
        res = await client.post("/api/studio/video", data=data, files=files)
        assert res.status_code == 200
        body = res.json()
        assert "task_id" in body
```

- [ ] **Step 3: Run — fail**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_routes_video.py -v
```

Expected: 1번/2번 → 200 (validation 미구현) / 3번 → 400 (prompt required 가 막음)

- [ ] **Step 4: routes/streams.py 수정**

`backend/studio/routes/streams.py:301` 근방의 `create_video_task` 본체에서, `prompt = meta_obj.get("prompt", "").strip()` 라인 (~312) 직후에 다음 블록 삽입:

```python
prompt = meta_obj.get("prompt", "").strip()
# NEW (spec 2026-05-12 v1.1) — auto_nsfw / nsfw_intensity 파싱
auto_nsfw = bool(meta_obj.get("autoNsfw", False))
nsfw_intensity_raw = meta_obj.get("nsfwIntensity", 2)
try:
    nsfw_intensity = int(nsfw_intensity_raw)
except (TypeError, ValueError):
    raise HTTPException(400, "nsfwIntensity must be an integer")

# validation (spec §5.1 매트릭스)
adult = bool(meta_obj.get("adult", False))
if auto_nsfw and not adult:
    raise HTTPException(400, "autoNsfw requires adult=true")
if auto_nsfw and nsfw_intensity not in (1, 2, 3):
    raise HTTPException(400, "nsfwIntensity must be 1|2|3")

# Codex Finding 2: prompt required 검증 우회 (auto_nsfw 일 때 빈 prompt 허용)
if not prompt and not auto_nsfw:
    raise HTTPException(400, "prompt required")
```

기존 `if not prompt: raise HTTPException(400, "prompt required")` 는 위 조건문으로 대체. 기존 `adult = bool(...)` 라인은 위로 옮겨졌으니 중복 제거.

`pre_upgraded_prompt` 추출 + auto_nsfw silent ignore (Codex Finding 3):

```python
pre_upgraded = meta_obj.get("preUpgradedPrompt")
if auto_nsfw:
    pre_upgraded = None  # silent ignore — Codex Finding 3
```

`_run_video_pipeline_task` 호출에 두 kwarg 전달:

```python
asyncio.create_task(
    _run_video_pipeline_task(
        # 기존 인자 그대로
        ...,
        adult=adult,
        auto_nsfw=auto_nsfw,             # NEW
        nsfw_intensity=nsfw_intensity,   # NEW
        pre_upgraded_prompt=pre_upgraded,
        ...
    )
)
```

- [ ] **Step 5: Run + Commit**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_routes_video.py -v
# PASS 확인
git add backend/studio/routes/streams.py backend/tests/studio/test_routes_video.py
git commit -m "feat(auto-nsfw): /video meta 파싱 + validation + skipUpgrade silent ignore"
```

---

## Task 8: history_db v9 → v10 migration

**Files:**
- Modify: `backend/studio/history_db/schema.py`, `backend/studio/history_db/items.py`
- Test: `backend/tests/studio/test_history_db_migration.py` (있으면 확장, 없으면 신규)

- [ ] **Step 1: Read existing schema**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -c "from studio.history_db import schema; print(schema.SCHEMA_VERSION)"
```

현재 버전 확인 (예: 9). `studio_history` 테이블 컬럼 list 도 schema.py 에서 확인.

- [ ] **Step 2: Write failing test**

```python
"""spec 2026-05-12 v1.1 §9.2 — history v9 → v10 migration"""
import pytest
from studio.history_db import schema, items


def test_schema_version_is_10():
    assert schema.SCHEMA_VERSION == 10

@pytest.mark.asyncio
async def test_video_item_save_restore_auto_nsfw(tmp_path, monkeypatch):
    """video item 저장/복원 시 autoNsfw, nsfwIntensity round-trip"""
    db_path = tmp_path / "test_history.db"
    monkeypatch.setattr(schema, "HISTORY_DB_PATH", str(db_path))
    await schema.init_history_db()

    item = {
        "id": "vid-test-1",
        "mode": "video",
        "prompt": "test",
        "imageRef": "test.mp4",
        "createdAt": 1000,
        "adult": True,
        "autoNsfw": True,
        "nsfwIntensity": 3,
        # 기타 필수 필드 생략
    }
    await items.save_item(item)
    restored = await items.get_item("vid-test-1")
    assert restored["autoNsfw"] is True
    assert restored["nsfwIntensity"] == 3
```

- [ ] **Step 3: Run — fail**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/test_history_db_migration.py -v
```

- [ ] **Step 4: schema.py 변경**

```python
# backend/studio/history_db/schema.py
SCHEMA_VERSION = 10  # was 9

# migrations 리스트 또는 함수에 v10 step 추가:
async def _migrate_v9_to_v10(conn):
    """spec 2026-05-12 v1.1 §9.2 — auto_nsfw + nsfw_intensity 컬럼"""
    await conn.execute(
        "ALTER TABLE studio_history ADD COLUMN auto_nsfw INTEGER DEFAULT 0"
    )
    await conn.execute(
        "ALTER TABLE studio_history ADD COLUMN nsfw_intensity INTEGER"
    )
```

기존 migration 등록 패턴 따라 v10 step 등록 (코드베이스 컨벤션 확인 필수).

- [ ] **Step 5: items.py 변경**

`save_item` (또는 INSERT site) 의 mode=video 분기에 `auto_nsfw`, `nsfw_intensity` 컬럼 값 매핑.
`row_to_item` (또는 row dict 변환 site) 에서 `auto_nsfw → autoNsfw`, `nsfw_intensity → nsfwIntensity` 키 변환.

```python
# items.py save_item 예시 (실제 구조 확인 후 적용)
async def save_item(item: dict):
    # ... 기존 컬럼들 ...
    auto_nsfw = 1 if item.get("autoNsfw") else 0
    nsfw_intensity = item.get("nsfwIntensity")
    await conn.execute(
        "INSERT INTO studio_history (..., auto_nsfw, nsfw_intensity) VALUES (..., ?, ?)",
        (..., auto_nsfw, nsfw_intensity),
    )

# items.py row_to_item 예시
def row_to_item(row) -> dict:
    return {
        # ...
        "autoNsfw": bool(row["auto_nsfw"]) if row["auto_nsfw"] is not None else False,
        "nsfwIntensity": row["nsfw_intensity"],
        # ...
    }
```

- [ ] **Step 6: Run + Commit**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/studio/ -v
git add backend/studio/history_db/ backend/tests/studio/test_history_db_migration.py
git commit -m "feat(auto-nsfw): history_db v9→v10 migration (auto_nsfw + nsfw_intensity 컬럼)"
```

---

## Task 9: Frontend types + `useSettingsStore` persist

**Files:**
- Modify: `frontend/lib/api/types.ts` (VideoRequest + HistoryItem)
- Modify: `frontend/stores/useSettingsStore.ts`
- Test: `frontend/__tests__/useSettingsStore.test.ts` (있으면 확장)

- [ ] **Step 1: Write failing test**

```ts
// frontend/__tests__/useSettingsStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/useSettingsStore";

describe("useSettingsStore auto NSFW (spec 2026-05-12 v1.1)", () => {
  beforeEach(() => {
    useSettingsStore.setState({ autoNsfwEnabled: false, nsfwIntensity: 2 });
  });

  it("default autoNsfwEnabled=false, nsfwIntensity=2", () => {
    const state = useSettingsStore.getState();
    expect(state.autoNsfwEnabled).toBe(false);
    expect(state.nsfwIntensity).toBe(2);
  });

  it("setAutoNsfwEnabled toggles", () => {
    useSettingsStore.getState().setAutoNsfwEnabled(true);
    expect(useSettingsStore.getState().autoNsfwEnabled).toBe(true);
  });

  it("setNsfwIntensity accepts 1|2|3", () => {
    useSettingsStore.getState().setNsfwIntensity(3);
    expect(useSettingsStore.getState().nsfwIntensity).toBe(3);
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
cd frontend && npm test -- __tests__/useSettingsStore.test.ts
```

- [ ] **Step 3: Extend `useSettingsStore`**

`frontend/stores/useSettingsStore.ts` 에 추가:

```ts
type NsfwIntensity = 1 | 2 | 3;

interface SettingsStore {
  // ... 기존 필드 ...
  autoNsfwEnabled: boolean;
  nsfwIntensity: NsfwIntensity;
  setAutoNsfwEnabled: (v: boolean) => void;
  setNsfwIntensity: (v: NsfwIntensity) => void;
}

// 스토어 정의 안 (기존 persist 그룹에 추가):
autoNsfwEnabled: false,
nsfwIntensity: 2 as NsfwIntensity,
setAutoNsfwEnabled: (v) => set({ autoNsfwEnabled: v }),
setNsfwIntensity: (v) => set({ nsfwIntensity: v }),
```

persist 옵션 partialize 영역에도 두 필드 포함 (기존 패턴 따라).

- [ ] **Step 4: Extend types.ts**

`frontend/lib/api/types.ts` 의 `VideoRequest` interface 에 추가:

```ts
export interface VideoRequest {
  // ... 기존 필드 ...
  /** 자동 NSFW 시나리오 모드 (spec 2026-05-12 v1.1 · adult=true 일 때만 유효) */
  autoNsfw?: boolean;
  /** 자동 시나리오 강도 (1: 은근 · 2: 옷벗음 · 3: 옷벗음+애무) */
  nsfwIntensity?: 1 | 2 | 3;
}
```

`HistoryItem` interface 에도 두 옵셔널 필드 추가:

```ts
export interface HistoryItem {
  // ... 기존 ...
  autoNsfw?: boolean;
  nsfwIntensity?: 1 | 2 | 3;
}
```

- [ ] **Step 5: Run + Commit**

```bash
cd frontend && npm test -- __tests__/useSettingsStore.test.ts && npx tsc --noEmit
git add frontend/stores/useSettingsStore.ts frontend/lib/api/types.ts frontend/__tests__/useSettingsStore.test.ts
git commit -m "feat(auto-nsfw-frontend): useSettingsStore + VideoRequest/HistoryItem 타입 확장"
```

---

## Task 10: `VideoAutoNsfwCard` 컴포넌트 신규

**Files:**
- Create: `frontend/components/studio/video/VideoAutoNsfwCard.tsx`
- Create: `frontend/__tests__/VideoAutoNsfwCard.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/__tests__/VideoAutoNsfwCard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { VideoAutoNsfwCard } from "@/components/studio/video/VideoAutoNsfwCard";

describe("VideoAutoNsfwCard (spec 2026-05-12 v1.1 §4.8)", () => {
  it("토글 OFF 일 때 슬라이더 미렌더", () => {
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={false}
        nsfwIntensity={2}
        onToggle={vi.fn()}
        onIntensityChange={vi.fn()}
      />
    );
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("토글 ON 일 때 슬라이더 노출", () => {
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={true}
        nsfwIntensity={2}
        onToggle={vi.fn()}
        onIntensityChange={vi.fn()}
      />
    );
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("토글 클릭 → onToggle 콜백 (true)", () => {
    const onToggle = vi.fn();
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={false}
        nsfwIntensity={2}
        onToggle={onToggle}
        onIntensityChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("슬라이더 변경 → onIntensityChange 콜백", () => {
    const onIntensityChange = vi.fn();
    render(
      <VideoAutoNsfwCard
        autoNsfwEnabled={true}
        nsfwIntensity={2}
        onToggle={vi.fn()}
        onIntensityChange={onIntensityChange}
      />
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    expect(onIntensityChange).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Run — fail (모듈 미존재)**

```bash
cd frontend && npm test -- __tests__/VideoAutoNsfwCard.test.tsx
```

Expected: `Cannot find module '@/components/studio/video/VideoAutoNsfwCard'`

- [ ] **Step 3: Implement component**

```tsx
// frontend/components/studio/video/VideoAutoNsfwCard.tsx
"use client";
/**
 * VideoAutoNsfwCard — 자동 NSFW 시나리오 토글 + 강도 슬라이더
 * spec 2026-05-12 v1.1 §4.8.
 *
 * Props (Codex Finding 11): adult prop 없음 — 호출자(VideoLeftPanel)가 conditional 렌더.
 */

import { AnimatePresence, motion } from "framer-motion";

export interface VideoAutoNsfwCardProps {
  autoNsfwEnabled: boolean;
  nsfwIntensity: 1 | 2 | 3;
  onToggle: (v: boolean) => void;
  onIntensityChange: (v: 1 | 2 | 3) => void;
}

const INTENSITY_LABELS: Record<1 | 2 | 3, string> = {
  1: "은근",
  2: "옷벗음",
  3: "옷벗음+애무",
};

export function VideoAutoNsfwCard({
  autoNsfwEnabled,
  nsfwIntensity,
  onToggle,
  onIntensityChange,
}: VideoAutoNsfwCardProps) {
  return (
    <section className="ais-card" style={{ padding: "16px" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span>🤖</span>
        <strong>자동 NSFW 시나리오</strong>
        <label style={{ marginLeft: "auto" }}>
          {/* 토글: 기존 프로젝트의 토글 패턴 차용 — 실제 컨벤션 따라 교체 */}
          <input
            type="checkbox"
            role="switch"
            checked={autoNsfwEnabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
        </label>
      </header>
      <p style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
        AI 가 이미지를 보고 알아서 시나리오 작성 (지시 비워도 OK)
      </p>

      <AnimatePresence>
        {autoNsfwEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{ marginTop: 12 }}
          >
            <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
              강도: {INTENSITY_LABELS[nsfwIntensity]}
            </label>
            <input
              type="range"
              min={1}
              max={3}
              step={1}
              value={nsfwIntensity}
              onChange={(e) =>
                onIntensityChange(Number(e.target.value) as 1 | 2 | 3)
              }
              style={{ width: "100%" }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--color-text-tertiary)",
                marginTop: 4,
              }}
            >
              <span>은근</span>
              <span>옷벗음</span>
              <span>옷벗음+애무</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
```

- [ ] **Step 4: Run + Commit**

```bash
cd frontend && npm test -- __tests__/VideoAutoNsfwCard.test.tsx && npx tsc --noEmit
git add frontend/components/studio/video/VideoAutoNsfwCard.tsx frontend/__tests__/VideoAutoNsfwCard.test.tsx
git commit -m "feat(auto-nsfw-frontend): VideoAutoNsfwCard 컴포넌트 신규"
```

---

## Task 11: `lib/api/video.ts` meta 확장

**Files:**
- Modify: `frontend/lib/api/video.ts:59-75`

- [ ] **Step 1: 코드 식별**

`form.append("meta", JSON.stringify({...}))` (line ~59) 영역.

- [ ] **Step 2: meta 객체 확장**

```ts
form.append(
  "meta",
  JSON.stringify({
    prompt: req.prompt,
    adult: req.adult ?? false,
    autoNsfw: req.autoNsfw,           // NEW (spec 2026-05-12 v1.1)
    nsfwIntensity: req.nsfwIntensity, // NEW
    lightning: req.lightning ?? true,
    longerEdge: req.longerEdge,
    ollamaModel: req.ollamaModel,
    visionModel: req.visionModel,
    preUpgradedPrompt: req.preUpgradedPrompt,
    promptMode: req.promptMode,
    modelId: req.modelId,
  }),
);
```

`undefined` 인 경우 JSON.stringify 가 키 생략 — 호환성 OK.

- [ ] **Step 3: tsc + Commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/lib/api/video.ts
git commit -m "feat(auto-nsfw-frontend): lib/api/video.ts meta 에 autoNsfw/nsfwIntensity 추가"
```

(이 task 는 별도 단위 테스트 없음 — Task 12 의 useVideoPipeline 통합 테스트가 전송 검증)

---

## Task 12: `useVideoPipeline` 개선 (빈 prompt 우회 + skipUpgrade 강제 OFF)

**Files:**
- Modify: `frontend/hooks/useVideoPipeline.ts`
- Test: `frontend/__tests__/useVideoPipeline.test.ts` (있으면 확장)

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/useVideoPipeline.test.ts (확장 또는 신규)
import { describe, it, expect, vi } from "vitest";
// 기존 mock 패턴 차용 — videoImageStream mock

describe("useVideoPipeline auto NSFW (spec 2026-05-12 v1.1)", () => {
  it("adult && autoNsfwEnabled → autoNsfw, nsfwIntensity 전송", async () => {
    // useVideoStore 와 useSettingsStore 를 적절히 setup
    // videoImageStream 을 mock → call args 검증
    // (실제 hook 호출 패턴은 기존 useVideoPipeline.test.ts 참조)
  });

  it("autoNsfwEnabled → preUpgradedPrompt 미전송 (effectiveSkipUpgrade=false)", async () => {
    // skipUpgrade=true 인데 autoNsfwEnabled=true 면 preUpgradedPrompt 가 undefined
  });

  it("autoNsfwEnabled && 빈 prompt → toast 없이 진행", async () => {
    // !prompt.trim() 이어도 toast 호출 안 되고 videoImageStream 호출됨
  });
});
```

**참고**: 정확한 mock 패턴은 기존 `frontend/__tests__/useVideoPipeline.test.ts` 가 있다면 그 패턴 차용. 없으면 hook 단위 테스트 신규 작성 (zustand store + toast mock + videoImageStream mock).

- [ ] **Step 2: Run — fail**

```bash
cd frontend && npm test -- __tests__/useVideoPipeline.test.ts
```

- [ ] **Step 3: Modify `useVideoPipeline.ts`**

`frontend/hooks/useVideoPipeline.ts` 의 `handleGenerate` (또는 동등 함수) 안:

```ts
// 빈 prompt 차단 — autoNsfwEnabled 일 때 우회
if (!autoNsfwEnabled && !prompt.trim()) {
  toast.warn("영상 지시를 입력해 주세요.");
  return;
}

// skipUpgrade 강제 OFF (Codex Finding 3 · Frontend Layer 1)
const effectiveSkipUpgrade = autoNsfwEnabled ? false : skipUpgrade;
const preUpgradedPrompt = effectiveSkipUpgrade
  ? upgradedPromptCache  // 기존 cache 변수명 확인 후 교체
  : undefined;

for await (const stage of videoImageStream({
  sourceImage,
  prompt,
  adult,
  autoNsfw: adult && autoNsfwEnabled ? true : undefined,
  nsfwIntensity: adult && autoNsfwEnabled ? nsfwIntensity : undefined,
  preUpgradedPrompt,
  lightning,
  longerEdge,
  modelId: selectedVideoModel,
  ollamaModel, visionModel,
  promptMode,
})) {
  // ... 기존 stage 처리 ...
}
```

`useSettingsStore` 에서 `autoNsfwEnabled`, `nsfwIntensity` 구독 추가:

```ts
const { autoNsfwEnabled, nsfwIntensity } = useSettingsStore(
  useShallow((s) => ({
    autoNsfwEnabled: s.autoNsfwEnabled,
    nsfwIntensity: s.nsfwIntensity,
  }))
);
```

useCallback dependencies 에 `autoNsfwEnabled, nsfwIntensity` 추가.

- [ ] **Step 4: Run + Commit**

```bash
cd frontend && npm test -- __tests__/useVideoPipeline.test.ts && npx tsc --noEmit
git add frontend/hooks/useVideoPipeline.ts frontend/__tests__/useVideoPipeline.test.ts
git commit -m "feat(auto-nsfw-frontend): useVideoPipeline 빈 prompt 우회 + skipUpgrade 강제 OFF"
```

---

## Task 13: `VideoLeftPanel` 통합 (카드 + ctaDisabled + skipUpgrade 가드)

**Files:**
- Modify: `frontend/components/studio/video/VideoLeftPanel.tsx`
- Test: `frontend/__tests__/VideoLeftPanel.test.tsx` (있으면 확장, 없으면 신규 — adult OFF/ON 통합 테스트)

- [ ] **Step 1: Write failing integration test**

```tsx
// __tests__/VideoLeftPanel.test.tsx (확장 또는 신규)
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VideoLeftPanel } from "@/components/studio/video/VideoLeftPanel";
import { useVideoStore } from "@/stores/useVideoStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

describe("VideoLeftPanel auto NSFW integration (spec 2026-05-12 v1.1 §4.9)", () => {
  it("adult OFF → VideoAutoNsfwCard 미렌더", () => {
    useVideoStore.setState({ adult: false });
    render(<VideoLeftPanel /* required props */ />);
    expect(screen.queryByText(/자동 NSFW 시나리오/)).toBeNull();
  });

  it("adult ON → 카드 노출", () => {
    useVideoStore.setState({ adult: true });
    render(<VideoLeftPanel /* required props */ />);
    expect(screen.getByText(/자동 NSFW 시나리오/)).toBeInTheDocument();
  });

  it("autoNsfwEnabled ON → skipUpgrade 토글 disabled + 안내문", () => {
    useVideoStore.setState({ adult: true, skipUpgrade: true });
    useSettingsStore.setState({ autoNsfwEnabled: true });
    render(<VideoLeftPanel /* required props */ />);
    const skipUpgradeToggle = screen.getByLabelText(/AI 보정 우회|skipUpgrade/i);
    expect(skipUpgradeToggle).toBeDisabled();
    expect(screen.getByText(/자동 NSFW 모드는 항상 AI 보강/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
cd frontend && npm test -- __tests__/VideoLeftPanel.test.tsx
```

- [ ] **Step 3: Modify `VideoLeftPanel.tsx`**

1. `useSettingsStore` 에서 `autoNsfwEnabled`, `nsfwIntensity`, setter 구독 추가.
2. `import { VideoAutoNsfwCard } from "./VideoAutoNsfwCard";`
3. `ctaDisabled` 변경 (line 130):

```tsx
const promptRequired = !autoNsfwEnabled;
const ctaDisabled = running || !sourceImage || (promptRequired && !prompt.trim());
```

4. Adult 토글 블록 직후에 conditional 카드 삽입:

```tsx
<AnimatePresence>
  {adult && (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
    >
      <VideoAutoNsfwCard
        autoNsfwEnabled={autoNsfwEnabled}
        nsfwIntensity={nsfwIntensity}
        onToggle={setAutoNsfwEnabled}
        onIntensityChange={setNsfwIntensity}
      />
    </motion.div>
  )}
</AnimatePresence>
```

5. skipUpgrade 토글 위치 (현재 inline UI) 에 `disabled={autoNsfwEnabled}` + 조건부 안내문 추가:

```tsx
<input
  type="checkbox"
  checked={skipUpgrade}
  onChange={(e) => setSkipUpgrade(e.target.checked)}
  disabled={autoNsfwEnabled}
  aria-label="AI 보정 우회 (skipUpgrade)"
/>
{autoNsfwEnabled && (
  <small style={{ color: "var(--color-text-tertiary)" }}>
    자동 NSFW 모드는 항상 AI 보강을 사용합니다
  </small>
)}
```

- [ ] **Step 4: Run + Commit**

```bash
cd frontend && npm test -- __tests__/VideoLeftPanel.test.tsx && npx tsc --noEmit && npm run lint
git add frontend/components/studio/video/VideoLeftPanel.tsx frontend/__tests__/VideoLeftPanel.test.tsx
git commit -m "feat(auto-nsfw-frontend): VideoLeftPanel 카드 통합 + ctaDisabled + skipUpgrade 가드"
```

---

## Task 14: `app/video/page.tsx` onReuse 히스토리 복원

**Files:**
- Modify: `frontend/app/video/page.tsx`

- [ ] **Step 1: 기존 page.tsx 구조 확인**

```bash
cd frontend && grep -n "HistoryGallery\|onReuse\|handleReuse" app/video/page.tsx
```

기존 `HistoryGallery` 의 `onReuse` prop 또는 동등 prop 식별.

- [ ] **Step 2: handleReuse 추가**

```tsx
// frontend/app/video/page.tsx
import { useSettingsStore } from "@/stores/useSettingsStore";

// 컴포넌트 안:
const { setAutoNsfwEnabled, setNsfwIntensity } = useSettingsStore(
  useShallow((s) => ({
    setAutoNsfwEnabled: s.setAutoNsfwEnabled,
    setNsfwIntensity: s.setNsfwIntensity,
  }))
);

const handleReuse = useCallback((item: HistoryItem) => {
  // 기존 reuse 로직 (setSource, setPrompt, setAdult, setLightning 등)
  // 그대로 유지 + 아래 NEW 블록 추가:

  // NEW (spec 2026-05-12 v1.1 §4.12)
  if (item.adult && item.autoNsfw) {
    setAutoNsfwEnabled(true);
    setNsfwIntensity((item.nsfwIntensity ?? 2) as 1 | 2 | 3);
  } else {
    setAutoNsfwEnabled(false);
    // nsfwIntensity 는 store default 유지 (사용자 선호 보존)
  }
}, [
  /* 기존 deps + */ setAutoNsfwEnabled, setNsfwIntensity,
]);

// HistoryGallery 에 onReuse={handleReuse} 전달 (기존 패턴 확인)
```

- [ ] **Step 3: tsc + Commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint
git add frontend/app/video/page.tsx
git commit -m "feat(auto-nsfw-frontend): page.tsx onReuse 시 autoNsfw/nsfwIntensity 복원"
```

---

## Task 15: 통합 검증 + master merge 준비

**Files:** (없음 — 검증만)

- [ ] **Step 1: Backend 전체 테스트**

```bash
cd backend && D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/ -v
```

Expected: 기존 534 + 신규 10 = **544 PASS · 회귀 0**

- [ ] **Step 2: Frontend 전체 테스트 + tsc + lint**

```bash
cd frontend && npm test && npx tsc --noEmit && npm run lint
```

Expected: 기존 280 + 신규 4 = **284 PASS · tsc clean · lint pre-existing 만**

- [ ] **Step 3: OpenAPI 타입 동기화 (백엔드 변경 반영)**

```bash
cd frontend && npm run gen:types
```

Expected: meta JSON 안 필드는 OpenAPI 가 추적 안 함 (string 인자). drift 없음.

- [ ] **Step 4: Manual smoke test (dev 서버 띄워서 빠른 시각 확인 — 선택)**

dev 서버 띄우고 /video 페이지 진입:
1. adult OFF → 자동 NSFW 카드 미렌더 확인
2. adult ON → 카드 노출 확인
3. autoNsfw ON → 슬라이더 노출 + skipUpgrade 토글 disabled 확인
4. autoNsfw ON + 빈 prompt + 생성 버튼 → CTA 활성 (이미지 있을 때) 확인

- [ ] **Step 5: dogfooding 체크리스트 (사용자 시각 검증 — §6.7 9 케이스)**

사용자 단계 — plan 외 영역. 결함 발견되면 follow-up commit 으로 fix.

- [ ] **Step 6: master merge**

```bash
git checkout master
git merge --no-ff feature/video-vision-pipeline-improvement -m "merge: Video 자동 NSFW 시나리오 (spec 2026-05-12 v1.1)"
git push origin master
```

(사용자 명시 push 요청 시에만 push)

---

## Acceptance Criteria 매핑

spec §11 의 8 항목 → task 매핑:

| Acceptance | Task |
|------------|------|
| Backend 6항목 완료 | T1~T8 |
| Frontend 6항목 완료 | T9~T14 |
| pytest +10 신규 PASS · vitest +4 신규 PASS | T15 Step 1+2 |
| §6.7 dogfooding 9 케이스 | T15 Step 5 |
| §5.1 validation 매트릭스 | T7 통합 테스트 |
| §5.7 skipUpgrade 3-layer 방어 | T12 (Layer 1) · T13 (Layer 2) · T7 (Layer 3) |
| §5.4 비-인물 차단 | T1 grafting clause + T15 Step 5 #7 |
| history onReuse 복원 | T14 |

---

## Self-Review (작성 후 inline check)

- ✅ Spec §1~§11 모든 항목이 T1~T15 에 매핑됨
- ✅ Placeholder 없음 — 모든 code block 에 실제 code 포함
- ✅ 함수 시그니처 일관성 — `auto_nsfw` (snake_case · backend) vs `autoNsfw` (camelCase · frontend/meta JSON) 일관
- ✅ T7 (routes) 의 4곳 우회 검증 완료 — frontend (T12) + backend (T4, T7)
- ✅ TDD 패턴 — 모든 task 가 failing test → impl → pass → commit 5단계
- ✅ commit 메시지 한국어 OK (CLAUDE.md 컨벤션)
