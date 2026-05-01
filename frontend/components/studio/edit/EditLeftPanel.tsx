/**
 * EditLeftPanel — Edit 페이지 좌측 입력 패널.
 *
 * 포함:
 *  - StudioModeHeader (Image Edit)
 *  - 원본 이미지 카드 (HistoryPicker 토글 + SourceImageCard)
 *  - 수정 지시 textarea (PromptHistoryPeek + 비우기 버튼)
 *  - Lightning Toggle
 *  - Primary CTA (sticky · 처리 중 spinner)
 *
 * 2026-04-26: edit/page.tsx 646줄 → 분해 step 1.
 *  - Store 직접 구독 (useEditInputs) → page.tsx 의 prop drilling 차단
 *  - 인라인 style 다수 → globals.css `.ais-*` 토큰 클래스 (Generate 와 통일)
 *
 * Page 가 prop 으로 넘기는 것: promptTextareaRef + onGenerate 두 개.
 * (HistoryPicker open/close 상태는 컴포넌트 내부 — page 분리 보존)
 */

"use client";

import dynamic from "next/dynamic";
import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import HistoryPicker from "@/components/studio/HistoryPicker";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import PromptModeRadio from "@/components/studio/PromptModeRadio";
import PromptToolsButtons from "@/components/studio/prompt-tools/PromptToolsButtons";
import PromptToolsResults from "@/components/studio/prompt-tools/PromptToolsResults";
import { usePromptTools } from "@/hooks/usePromptTools";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import SourceImageCard from "@/components/studio/SourceImageCard";
import ReferenceLibraryDrawer from "./ReferenceLibraryDrawer";
import ReferenceRoleSelect from "./ReferenceRoleSelect";
import type { ReferenceRoleId } from "@/stores/useEditStore";

// ReferenceImageBox 는 react-easy-crop (window 의존) 을 사용하므로 ssr:false 로 격리.
// v9 (2026-04-29 · Phase B.1+B.3): 옛 EditReferenceCrop + SourceImageCard 통합 컴포넌트.
const ReferenceImageBox = dynamic(
  () => import("./ReferenceImageBox"),
  { ssr: false },
);
import {
  StudioLeftPanel,
  StudioModeHeader,
} from "@/components/studio/StudioLayout";
import Icon from "@/components/ui/Icon";
import { Spinner, Toggle } from "@/components/ui/primitives";
import { useEditInputs, useEditRunning } from "@/stores/useEditStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";

interface Props {
  /** prompt textarea ref — useAutoGrowTextarea 훅이 부모에서 관리 */
  promptTextareaRef: RefObject<HTMLTextAreaElement | null>;
  /** 수정 생성 트리거 (useEditPipeline.generate) */
  onGenerate: () => void;
}

export default function EditLeftPanel({
  promptTextareaRef,
  onGenerate,
}: Props) {
  const {
    sourceImage, sourceLabel, sourceWidth, sourceHeight, setSource,
    prompt, setPrompt,
    lightning, setLightning,
    useReferenceImage, setUseReferenceImage,
    referenceImage, referenceWidth, referenceHeight,
    setReferenceImage,
    referenceRole, setReferenceRole,
    referenceRoleCustom, setReferenceRoleCustom,
    setReferenceCropArea,
    // v9 라이브러리 plan (옛 saveAsTemplate / templateName 제거 · Phase B.2)
    pickedTemplateRef,
    setPickedTemplateId, setPickedTemplateRef,
    promptMode, setPromptMode,
  } = useEditInputs();
  const { running } = useEditRunning();
  const items = useHistoryStore((s) => s.items);
  // 수정 후 자동 비교 분석 토글 — 설정 → Edit 좌측 패널 이동 (오빠 피드백 2026-04-27).
  const autoCompareAnalysis = useSettingsStore((s) => s.autoCompareAnalysis);
  const setAutoCompareAnalysis = useSettingsStore(
    (s) => s.setAutoCompareAnalysis,
  );
  // Codex Phase 5 fix Medium — settings 의 ollamaModel override 를 도구로 전파.
  const ollamaModelForTools = useSettingsStore((s) => s.ollamaModel);

  // Phase 5 후속 (2026-05-01) — 프롬프트 도구 (번역/분리) state + 핸들러 통합 hook.
  const promptTools = usePromptTools({
    prompt,
    onPromptChange: setPrompt,
    ollamaModel: ollamaModelForTools,
    disabled: running,
  });

  // Phase 2 (2026-05-01) — settings 의 promptEnhanceMode 를 *마운트 시 1회만* store sync.
  // Codex Phase 4 리뷰 Medium #2 fix — session-only 정책 정합 (settings 변경은 다음 mount 부터 반영).
  const promptModeInitRef = useRef(false);
  useEffect(() => {
    if (promptModeInitRef.current) return;
    promptModeInitRef.current = true;
    setPromptMode(useSettingsStore.getState().promptEnhanceMode);
  }, [setPromptMode]);

  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);
  // v8 라이브러리 plan: 라이브러리 Drawer open 토글.
  const [libraryOpen, setLibraryOpen] = useState(false);

  const handleSourceChange = (
    image: string,
    label: string,
    w: number,
    h: number,
  ) => {
    setSource(image, label, w, h);
    toast.success("이미지 업로드 완료", label.split(" · ")[0]);
  };

  const handleClearSource = () => {
    setSource(null);
    toast.info("이미지 해제됨");
  };

  const ctaDisabled =
    running ||
    !sourceImage ||
    !prompt.trim() ||
    // Multi-ref ON 인데 reference 파일 없음 → 차단 (백엔드 400 미리 방지)
    (useReferenceImage && !referenceImage);

  return (
    <StudioLeftPanel>
      <StudioModeHeader
        title="Image Edit"
        description="원본 이미지와 수정 지시로 새로운 결과 이미지를 만듭니다."
        flowHref="/prompt-flow/edit"
        flowLabel="이미지 수정 프롬프트 흐름 보기"
      />

      {/* Primary CTA — sticky 상단 (Generate 와 통일 · 폼 길어져도 시야 안) */}
      <div className="ais-cta-sticky-top">
        <button
          type="button"
          onClick={onGenerate}
          disabled={ctaDisabled}
          className="ais-cta-primary"
        >
          {running ? (
            <>
              <Spinner /> 처리 중…
            </>
          ) : (
            <>
              <Icon name="wand" size={16} />
              수정 생성
            </>
          )}
        </button>
      </div>

      {/* ── 원본 이미지 ── */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            원본 이미지
          </label>
          <button
            type="button"
            onClick={() => setHistoryPickerOpen((v) => !v)}
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 11,
              color: historyPickerOpen ? "var(--accent-ink)" : "var(--ink-3)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name="grid" size={11} /> 히스토리에서 선택
          </button>
        </div>

        {/* History picker overlay — video 항목은 Edit 의 원본으로 부적절 → 제외 */}
        <HistoryPicker
          open={historyPickerOpen}
          items={items.filter((i) => i.mode !== "video")}
          onSelect={(it) => {
            setSource(
              it.imageRef,
              `${it.label} · ${it.width}×${it.height}`,
              it.width,
              it.height,
            );
            setHistoryPickerOpen(false);
            toast.info("원본으로 지정", it.label);
          }}
        />

        <SourceImageCard
          sourceImage={sourceImage}
          sourceLabel={sourceLabel}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          onChange={handleSourceChange}
          onClear={handleClearSource}
          onError={(msg) => toast.error(msg)}
          pasteRequireHover={useReferenceImage}
        />
      </div>

      {/* ── 수정 지시 prompt ── */}
      {/* 2026-05-01 (UX 통일): Generate/Compare/Video 와 동일한 auto-grow textarea
       *  + 우하단 X 아이콘 박스 패턴. */}
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            수정 지시
          </label>
        </div>
        <div className="ais-prompt-shell">
          <PromptHistoryPeek mode="edit" onSelect={(p) => setPrompt(p)} />
          <textarea
            ref={promptTextareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="어떻게 수정할까요? 예: 배경을 바다로 바꿔주세요"
            rows={3}
            className="ais-prompt-textarea"
          />
          {/* Phase 5 후속 (2026-05-01) — 도구 버튼 (번역/분리) textarea 안 우측. */}
          <PromptToolsButtons tools={promptTools} />
          {prompt.length > 0 && (
            <button
              type="button"
              onClick={() => setPrompt("")}
              aria-label="프롬프트 비우기"
              title="프롬프트 비우기"
              className="ais-prompt-clear-icon"
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        {/* 번역/분리 결과 카드 — textarea 외부 아래에 펼침. */}
        <PromptToolsResults tools={promptTools} />
      </div>

      {/* ── 퀄리티 모드 토글 (Generate 와 통일 · 우측 토글 · 의미 반전) ──
       *  OFF=Lightning 빠름 (기본) / ON=💎 퀄리티 모드 (강화 옵션)
       *  라벨 동적 분기 (2026-04-27 후속): 토글 상태가 곧 모드 명.
       *  store 의 lightning 의미는 그대로 (true=LoRA ON=빠름) — UI 만 반전 (`!lightning`).
       */}
      <Toggle
        checked={!lightning}
        onChange={(v) => setLightning(!v)}
        align="right"
        label={lightning ? "⚡ 빠른 모드" : "💎 퀄리티 모드"}
        desc={
          lightning
            ? "Lightning 4-step · 빠름 · 약간 낮은 디테일 (기본)"
            : "Lightning OFF · 풀 퀄리티 · 약 ~38s 예상"
        }
      />

      {/* AI 보정 카드 (Phase 2 후속 · 2026-05-01) — Generate/Video 와 통일 패턴.
       *  Edit 은 보정 우회 옵션 없음 (vision + clarify + upgrade 가 본질) →
       *  토글은 *disabled checked* 로 시각 일관성만 표현, 모드 segmented 는 항상 활성.
       *  clarify_edit_intent 와 upgrade_edit_prompt 양쪽에 promptMode 영향. */}
      <div className="ais-magic-prompt-card" data-active="true">
        <Toggle
          flat
          checked
          disabled
          onChange={() => undefined}
          align="right"
          label="🪄 AI 프롬프트 보정"
          desc="ON · 한국어/자연어 → 영문 정제 (Edit 필수)"
        />
        <PromptModeRadio value={promptMode} onChange={setPromptMode} />
      </div>

      {/* 수정 후 자동 비교 분석 — 옛 설정 토글에서 이 위치로 이동 (오빠 피드백 2026-04-27).
       *  결과 완료 시 백그라운드로 5축 평가. VRAM>13GB 면 자동 skip. */}
      <Toggle
        checked={autoCompareAnalysis}
        onChange={setAutoCompareAnalysis}
        align="right"
        label="🔍 수정 후 자동 비교 분석"
        desc="결과 완료 시 백그라운드로 5축 평가 (VRAM>13GB 시 자동 skip)"
      />

      {/* Multi-reference (2026-04-27): 두번째 이미지 토글 + 조건부 슬롯 */}
      <Toggle
        checked={useReferenceImage}
        onChange={setUseReferenceImage}
        align="right"
        label="🖼️ 참조 이미지 사용 (실험적)"
        desc={
          useReferenceImage
            ? "두번째 이미지를 참조로 사용 — 역할 명시 필요"
            : "OFF · 단일 이미지 수정 (기본)"
        }
      />

      {useReferenceImage && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="ais-field-header">
            <label
              className="ais-field-label"
              style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
            >
              <SectionAccentBar accent="violet" />
              참조 이미지
              {referenceWidth && referenceHeight && (
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "var(--ink-4)",
                    fontWeight: 400,
                  }}
                >
                  {referenceWidth}×{referenceHeight}
                </span>
              )}
            </label>
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              style={{
                all: "unset",
                cursor: "pointer",
                fontSize: 11,
                color: "var(--ink-3)",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon name="grid" size={11} /> 라이브러리에서 선택
            </button>
          </div>
          {/* v9 (2026-04-29 · Phase B.1+B.3): 옛 SourceImageCard + EditReferenceCrop +
           *  saveAsTemplate Toggle/Input 영역을 ReferenceImageBox 1개로 통합.
           *  사후 저장 (📚 라이브러리 저장) 은 결과 ActionBar 로 이전됨 (Phase C).
           *
           *  key={referenceImage} — 새 이미지 업로드 시 컴포넌트 local state
           *  (crop/zoom/aspectMode) 강제 reset (옛 EditReferenceCrop 의 Codex Phase 1 리뷰 결함 #1).
           */}
          <ReferenceImageBox
            key={referenceImage ?? "empty"}
            image={referenceImage}
            onImage={(image, label, w, h) => {
              if (image === null) {
                setReferenceImage(null);
                toast.info("참조 이미지 해제됨");
              } else {
                setReferenceImage(image, label, w, h);
                toast.success(
                  "참조 이미지 업로드",
                  (label ?? "").split(" · ")[0],
                );
              }
            }}
            onCropArea={setReferenceCropArea}
            // 라이브러리 픽 (영구 URL) 일 때만 crop UI 비활성
            bypassCrop={!!pickedTemplateRef}
            pasteRequireHover
            onError={(msg) => toast.error(msg)}
          />
          <ReferenceRoleSelect
            selected={referenceRole}
            onSelect={setReferenceRole}
            customText={referenceRoleCustom}
            onCustomTextChange={setReferenceRoleCustom}
          />
        </div>
      )}

      {/* v8 라이브러리 plan: ReferenceLibraryDrawer (참조 이미지 사용 OFF 여도 미리 보기 가능) */}
      <ReferenceLibraryDrawer
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onPick={(t) => {
          // 라이브러리에서 픽 — 두번째 카드 자동 채움 + 재저장 OFF.
          // setReferenceImage 가 pickedTemplateId/Ref 둘 다 null 로 초기화하므로
          // 그 *직후* picked 두 값을 다시 설정 (순서 중요).
          setReferenceImage(
            t.imageRef,
            `${t.name} · 라이브러리`,
            0,
            0,
          );
          if (
            t.roleDefault &&
            ["face", "outfit", "style", "background", "custom"].includes(
              t.roleDefault,
            )
          ) {
            setReferenceRole(t.roleDefault as ReferenceRoleId);
          }
          setPickedTemplateId(t.id);
          setPickedTemplateRef(t.imageRef);
          // v9 (Phase B.2): saveAsTemplate 제거 — 사후 저장 ActionBar 로 이전됨.
          toast.success("템플릿 적용", t.name);
        }}
      />
    </StudioLeftPanel>
  );
}
