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
import { useState } from "react";
import ImageHistoryPickerDrawer from "@/components/studio/ImageHistoryPickerDrawer";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import PromptModeRadio from "@/components/studio/PromptModeRadio";
import PromptToolsButtons from "@/components/studio/prompt-tools/PromptToolsButtons";
import PromptToolsResults from "@/components/studio/prompt-tools/PromptToolsResults";
import { usePromptModeInit } from "@/hooks/usePromptModeInit";
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
import V5MotionCard from "@/components/studio/V5MotionCard";
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

  // Phase 2 (2026-05-01 · 2026-05-06 hook 추출) — session-only 정책 sync.
  // 자세한 배경은 `hooks/usePromptModeInit.ts` 주석.
  usePromptModeInit(setPromptMode);

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
        titleKo="수정"
        titleEn="Edit"
        eyebrow="MODE · EDIT"
        description="원본 이미지와 수정 지시로 새로운 결과 이미지를 만듭니다."
        flowHref="/prompt-flow/edit"
        flowLabel="이미지 수정 프롬프트 흐름 보기"
      />

      {/* Primary CTA — sticky 상단 (Generate 와 통일 · 폼 길어져도 시야 안).
       *  Phase 1.5.3 (결정 K) — shortcut 표시 X (Edit 은 이미 표시 X 였음). 텍스트 영문 통일 (Edit). */}
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
              Edit
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
            <Icon name="grid" size={11} /> 이미지 히스토리
          </button>
        </div>

        {/* Image history drawer — Generate/Edit 결과만 원본으로 재사용. Video 항목은 제외. */}
        <ImageHistoryPickerDrawer
          open={historyPickerOpen}
          items={items}
          selectedImageRef={sourceImage}
          onClose={() => setHistoryPickerOpen(false)}
          onPick={(it) => {
            setSource(
              it.imageRef,
              `${it.label} · ${it.width}×${it.height}`,
              it.width,
              it.height,
            );
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

      {/* ── 카드 순서 (Phase 1.5.3 · 결정 A · 2026-05-02) ──
       *  옛: 퀄리티 → AI보정 → 자동평가 → multi-ref
       *  신: AI → 자동평가 → 퀄리티 → multi-ref (Edit 은 성인 X · Codex 2차 정정)
       *  의도: 분석 도구 그룹 (AI/자동평가) 위 + 결과 옵션 (퀄리티) 아래. */}

      {/* AI 보정 카드 — V5 시그니처 (.ais-sig-ai · violet/blue).
       *  Edit 은 보정 우회 옵션 없음 (vision + clarify + upgrade 가 본질) →
       *  Toggle 은 *disabled checked* 로 시각 일관성만 표현, 모드 segmented 는 항상 활성.
       *  data-active="true" 고정 — 항상 active 톤. */}
      <V5MotionCard
        className="ais-toggle-card ais-sig-ai"
        data-active="true"
        tooltip="ON · 한국어/자연어 → 영문 정제 (Edit 필수)"
      >
        {/* 시안 매칭 (2026-05-02): desc 제거 + icon-box 추가 — Generate 와 동일 패턴. */}
        <Toggle
          flat
          icon="stars"
          checked
          disabled
          onChange={() => undefined}
          align="right"
          label="🪄 AI 프롬프트 보정"
        />
        <PromptModeRadio value={promptMode} onChange={setPromptMode} />
      </V5MotionCard>

      {/* 수정 후 자동 비교 분석 — V5 .ais-auto-compare-card (amber 시그니처 · 결정 C).
       *  옛 설정 토글 → Edit 좌측 패널로 이동 (오빠 피드백 2026-04-27).
       *  결과 완료 시 백그라운드로 5축 평가. VRAM>13GB 면 자동 skip. */}
      <V5MotionCard
        className="ais-toggle-card ais-sig-claude"
        data-active={autoCompareAnalysis}
        onClick={() => setAutoCompareAnalysis(!autoCompareAnalysis)}
        tooltip="결과 완료 시 백그라운드로 5축 평가 (VRAM>13GB 시 자동 skip)"
      >
        {/* 2026-05-02: 라벨 단순화 + desc 제거 + icon-box (search · 시그니처 amber). */}
        <Toggle
          flat
          icon="search"
          checked={autoCompareAnalysis}
          onChange={setAutoCompareAnalysis}
          align="right"
          label="🔍 결과 자동 분석"
        />
      </V5MotionCard>

      {/* 퀄리티 모드 토글 — V5 시그니처 (.ais-sig-fast · lime/cyan).
       *  OFF=Lightning 빠름 (기본) / ON=💎 퀄리티 모드 (강화 옵션)
       *  store 의 lightning 의미는 그대로 (true=LoRA ON=빠름) — UI 만 반전 (`!lightning`).
       *  data-active 는 "강화" (lightning=false) 시 ON. */}
      <V5MotionCard
        className="ais-toggle-card ais-sig-fast"
        data-active={!lightning}
        onClick={() => setLightning(!lightning)}
        tooltip="ON 시 Lightning 4-step 끄고 풀 디테일 · 약 4배 느림"
      >
        {/* 시안 매칭 (2026-05-02): 라벨 "💎 퀄리티 모드" 고정 + desc 제거 + icon-box (Generate 와 동일).
         *  카드 OFF = Lightning 빠른 모드 사용 중 (기본) / ON = 퀄리티 모드 활성. */}
        <Toggle
          flat
          icon="bolt"
          checked={!lightning}
          onChange={(v) => setLightning(!v)}
          align="right"
          label="💎 퀄리티 모드"
        />
      </V5MotionCard>

      {/* Multi-reference (2026-04-27 + Phase 1.5.3 V5):
       *  V5 .ais-multi-ref-card (fuchsia 시그니처 · 결정 J — rose-pink 트리오에서 추가 참조만 분리).
       *  토글 ON 일 때 참조 이미지 슬롯 + 역할 select sub-section 노출 (카드 *외부*).
       *  data-active 는 토글 ON 일 때. */}
      <V5MotionCard
        className="ais-toggle-card ais-multi-ref-card"
        data-active={useReferenceImage}
        onClick={() => setUseReferenceImage(!useReferenceImage)}
        tooltip="두번째 이미지를 참조로 사용 — 역할 명시 필요"
      >
        {/* 2026-05-02: "(실험적)" 제거 + desc 제거 + icon-box (image). */}
        <Toggle
          flat
          icon="image"
          checked={useReferenceImage}
          onChange={setUseReferenceImage}
          align="right"
          label="🖼️ 참조 이미지 사용"
        />
      </V5MotionCard>

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
