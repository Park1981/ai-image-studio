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
import HistoryPicker from "@/components/studio/HistoryPicker";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import SourceImageCard from "@/components/studio/SourceImageCard";
import ReferenceLibraryDrawer from "./ReferenceLibraryDrawer";
import ReferenceRoleSelect from "./ReferenceRoleSelect";
import type { ReferenceRoleId } from "@/stores/useEditStore";

// EditReferenceCrop 은 react-easy-crop (window 의존) 을 사용하므로 ssr:false 로 격리.
// 2026-04-28 (Phase 1).
const EditReferenceCrop = dynamic(
  () => import("@/components/studio/EditReferenceCrop"),
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
    referenceImage, referenceLabel, referenceWidth, referenceHeight,
    setReferenceImage,
    referenceRole, setReferenceRole,
    referenceRoleCustom, setReferenceRoleCustom,
    setReferenceCropArea,
    // v8 라이브러리 plan
    saveAsTemplate, templateName, pickedTemplateId,
    setSaveAsTemplate, setTemplateName,
    setPickedTemplateId, setPickedTemplateRef,
  } = useEditInputs();
  const { running } = useEditRunning();
  const items = useHistoryStore((s) => s.items);
  // 수정 후 자동 비교 분석 토글 — 설정 → Edit 좌측 패널 이동 (오빠 피드백 2026-04-27).
  const autoCompareAnalysis = useSettingsStore((s) => s.autoCompareAnalysis);
  const setAutoCompareAnalysis = useSettingsStore(
    (s) => s.setAutoCompareAnalysis,
  );

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
      <div>
        <div className="ais-field-header">
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="blue" />
            수정 지시
          </label>
          <span className="mono ais-field-meta">{prompt.length} chars</span>
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
          {prompt.length > 0 && (
            <button
              type="button"
              onClick={() => setPrompt("")}
              title="프롬프트 비우기"
              className="ais-prompt-clear"
              style={{ position: "absolute", bottom: 6, right: 10 }}
            >
              <Icon name="x" size={10} /> 비우기
            </button>
          )}
        </div>
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
          <SourceImageCard
            sourceImage={referenceImage}
            sourceLabel={referenceLabel}
            sourceWidth={referenceWidth}
            sourceHeight={referenceHeight}
            onChange={(image, label, w, h) => {
              setReferenceImage(image, label, w, h);
              toast.success("참조 이미지 업로드", label.split(" · ")[0]);
            }}
            onClear={() => {
              setReferenceImage(null);
              toast.info("참조 이미지 해제됨");
            }}
            onError={(msg) => toast.error(msg)}
            pasteRequireHover
          />
          {/* 인라인 수동 crop UI — 참조 이미지가 있을 때만 노출 (Phase 1 · 2026-04-28).
           *  onAreaChange → useEditStore.setReferenceCropArea 직결.
           *  Phase 2 의 "수정 생성" 클릭 시점에 store 의 area 를 적용해 cropped Blob 전송.
           */}
          {referenceImage && (
            <div>
              <div className="ais-field-header">
                <label
                  className="ais-field-label"
                  style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
                >
                  <SectionAccentBar accent="violet" />
                  사용 영역
                </label>
                <span className="mono ais-field-meta">manual crop</span>
              </div>
              {/* key={referenceImage} — 새 이미지 업로드 시 컴포넌트 local state
               *  (crop/zoom/aspectMode) 강제 reset (Codex Phase 1 리뷰 결함 #1).
               *  store 의 area 만 reset 되면 옛 cropper 가 새 이미지 위에 옛 좌표를
               *  재 emit 해 area 가 다시 채워지는 버그 차단. */}
              <EditReferenceCrop
                key={referenceImage}
                imageSrc={referenceImage}
                onAreaChange={setReferenceCropArea}
              />
            </div>
          )}
          <ReferenceRoleSelect
            selected={referenceRole}
            onSelect={setReferenceRole}
            customText={referenceRoleCustom}
            onCustomTextChange={setReferenceRoleCustom}
          />

          {/* v8 라이브러리 plan: 새 reference (라이브러리 픽이 아닌) 케이스만 저장 토글 노출.
           *  pickedTemplateId !== null 이면 이미 라이브러리 항목이므로 재저장 의미 없음. */}
          {referenceImage && pickedTemplateId === null && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Toggle
                checked={saveAsTemplate}
                onChange={setSaveAsTemplate}
                align="right"
                label="📌 라이브러리에 저장"
                desc={
                  saveAsTemplate
                    ? "수정 실행 시 템플릿으로 저장 + 비전 분석"
                    : "이번만 사용 (저장 X)"
                }
              />
              {saveAsTemplate && (
                <input
                  type="text"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="템플릿 이름 (예: 검정 미니 드레스)"
                  style={{
                    all: "unset",
                    display: "block",
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "8px 10px",
                    fontSize: 12,
                    border: "1px solid var(--line)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--surface)",
                    color: "var(--ink)",
                  }}
                />
              )}
            </div>
          )}
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
          setSaveAsTemplate(false);
          toast.success("템플릿 적용", t.name);
        }}
      />
    </StudioLeftPanel>
  );
}
