/**
 * Generate Mode Page — Zustand 스토어 + Mock API 연결.
 * 프롬프트/고급 설정은 useGenerateStore, 히스토리는 useHistoryStore, 프리퍼런스는 useSettingsStore.
 * 입력값은 부분 영속화, 진행 상태는 세션 한정.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Logo,
  TopBar,
  BackBtn,
  IconBtn,
  ModelBadge,
} from "@/components/chrome/Chrome";
import SettingsButton from "@/components/settings/SettingsButton";
import VramBadge from "@/components/chrome/VramBadge";
import AiEnhanceCard from "@/components/studio/AiEnhanceCard";
import HistoryTile from "@/components/studio/HistoryTile";
import ImageLightbox from "@/components/studio/ImageLightbox";
import ProgressModal from "@/components/studio/ProgressModal";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import UpgradeConfirmModal from "@/components/studio/UpgradeConfirmModal";
import Icon from "@/components/ui/Icon";
import ImageTile from "@/components/ui/ImageTile";
import {
  Pill,
  Field,
  SegControl,
  Range,
  Meta,
  SmallBtn,
  Spinner,
  Toggle,
  inputStyle,
  iconBtnStyle,
} from "@/components/ui/primitives";
import {
  ASPECT_RATIOS,
  GENERATE_MODEL,
  activeLoras,
  countExtraLoras,
  type AspectRatioLabel,
} from "@/lib/model-presets";
import {
  generateImageStream,
  researchPrompt,
  upgradeOnly,
  type UpgradeOnlyResult,
} from "@/lib/api-client";
import {
  downloadImage,
  copyImageToClipboard,
  filenameFromRef,
  urlToDataUrl,
} from "@/lib/image-actions";
import { useEditStore } from "@/stores/useEditStore";
import { useGenerateStore, type AspectValue } from "@/stores/useGenerateStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useProcessStore } from "@/stores/useProcessStore";
import { toast } from "@/stores/useToastStore";

export default function GeneratePage() {
  const router = useRouter();

  /* ── store subscribe ── */
  const prompt = useGenerateStore((s) => s.prompt);
  const setPrompt = useGenerateStore((s) => s.setPrompt);
  const aspect = useGenerateStore((s) => s.aspect);
  const setAspect = useGenerateStore((s) => s.setAspect);
  const width = useGenerateStore((s) => s.width);
  const height = useGenerateStore((s) => s.height);
  const setWidth = useGenerateStore((s) => s.setWidth);
  const setHeight = useGenerateStore((s) => s.setHeight);
  const setDimensions = useGenerateStore((s) => s.setDimensions);
  const aspectLocked = useGenerateStore((s) => s.aspectLocked);
  const setAspectLocked = useGenerateStore((s) => s.setAspectLocked);
  const research = useGenerateStore((s) => s.research);
  const setResearch = useGenerateStore((s) => s.setResearch);
  const lightning = useGenerateStore((s) => s.lightning);
  const applyLightning = useGenerateStore((s) => s.applyLightning);
  const steps = useGenerateStore((s) => s.steps);
  const setSteps = useGenerateStore((s) => s.setSteps);
  const cfg = useGenerateStore((s) => s.cfg);
  const setCfg = useGenerateStore((s) => s.setCfg);
  const seed = useGenerateStore((s) => s.seed);
  const setSeed = useGenerateStore((s) => s.setSeed);
  const generating = useGenerateStore((s) => s.generating);
  const progress = useGenerateStore((s) => s.progress);
  const stage = useGenerateStore((s) => s.stage);
  const setRunning = useGenerateStore((s) => s.setRunning);
  const resetRunning = useGenerateStore((s) => s.resetRunning);
  const pushStage = useGenerateStore((s) => s.pushStage);
  const setSampling = useGenerateStore((s) => s.setSampling);

  const addItem = useHistoryStore((s) => s.add);
  const items = useHistoryStore((s) => s.items);
  const selectedId = useHistoryStore((s) => s.selectedId);
  const selectItem = useHistoryStore((s) => s.select);

  const showUpgradeStep = useSettingsStore((s) => s.showUpgradeStep);
  const lightningByDefault = useSettingsStore((s) => s.lightningByDefault);
  const ollamaModelSel = useSettingsStore((s) => s.ollamaModel);
  const visionModelSel = useSettingsStore((s) => s.visionModel);
  const addTemplate = useSettingsStore((s) => s.addTemplate);
  const comfyuiStatus = useProcessStore((s) => s.comfyui);

  /* ── 생성 모드에서만 보이는 히스토리 필터 ── */
  const genItems = useMemo(
    () => items.filter((i) => i.mode === "generate"),
    [items],
  );
  const selectedItem = genItems.find((i) => i.id === selectedId);

  /* ── Upgrade 확인 모달 상태 ── */
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeResult, setUpgradeResult] = useState<UpgradeOnlyResult | null>(
    null,
  );

  /* ── Lightbox + 그리드 컬럼 토글 ── */
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [gridCols, setGridCols] = useState<2 | 3 | 4>(3);
  const cycleGrid = () =>
    setGridCols((c) => (c === 2 ? 3 : c === 3 ? 4 : 2));

  /* ── 진행 모달 open 상태 ── */
  const [progressOpen, setProgressOpen] = useState(false);
  useEffect(() => {
    if (generating) setProgressOpen(true);
  }, [generating]);
  // 생성 끝나고 1.2초 후 자동 close (단, 사용자가 이미 닫았다면 무시)
  useEffect(() => {
    if (generating) return;
    if (!progressOpen) return;
    const t = setTimeout(() => setProgressOpen(false), 1200);
    return () => clearTimeout(t);
  }, [generating, progressOpen]);

  /* ── 진입 시 Lightning 기본값 적용 (1회) ── */
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    if (lightningByDefault && !lightning) applyLightning(true);
  }, [lightningByDefault, lightning, applyLightning]);

  const sizeLabel = `${width}×${height}`;

  /* ── 실제 생성 스트림 실행 (preUpgraded / preResearchHints 유무 분기) ── */
  const runGenerateStream = async (
    preUpgraded?: string,
    preResearchHints?: string[],
  ) => {
    setRunning(true, 0, "초기화");
    try {
      for await (const evt of generateImageStream({
        prompt,
        aspect,
        width,
        height,
        steps,
        cfg,
        seed,
        lightning,
        research,
        ollamaModel: ollamaModelSel,
        visionModel: visionModelSel,
        preUpgradedPrompt: preUpgraded,
        preResearchHints,
      })) {
        if (evt.type === "done") {
          addItem(evt.item);
          resetRunning();
          // 모달은 훅에서 자동 close. running=false 로 바뀌면 닫힘
          toast.success(
            "생성 완료",
            `${evt.item.width}×${evt.item.height} · seed ${evt.item.seed}`,
          );
          // 에러/폴백 상세 토스트 (백엔드가 item 에 실어 보내는 힌트)
          if (evt.item.comfyError) {
            toast.error(
              "ComfyUI 오류 (Mock 폴백 적용)",
              evt.item.comfyError.slice(0, 160),
            );
          } else if (evt.item.promptProvider === "fallback") {
            toast.warn(
              "gemma4 업그레이드 실패",
              "원본 프롬프트로 생성됨. Ollama 상태 확인 또는 설정에서 재시작해봐.",
            );
          }
          // 히스토리 DB 저장 실패 — 프론트 localStorage 에는 들어가지만 서버 재기동 시 사라짐
          if (!evt.savedToHistory) {
            toast.warn(
              "히스토리 DB 저장 실패",
              "결과는 화면에서 유지되지만 서버 재기동 후 사라질 수 있어.",
            );
          }
          return;
        }
        setRunning(true, evt.progress, evt.stageLabel);
        pushStage({
          type: evt.type,
          label: evt.stageLabel,
          progress: evt.progress,
        });
        // ComfyUI 샘플링 스텝 정보 (있는 경우만)
        if (evt.type === "comfyui-sampling") {
          setSampling(evt.samplingStep ?? null, evt.samplingTotal ?? null);
        }
      }
    } catch (err) {
      resetRunning();
      toast.error(
        "생성 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
    }
  };

  /* ── 생성 실행 진입점 (showUpgradeStep 따라 모달 우회) ── */
  const handleGenerate = async () => {
    if (generating) return;
    if (!prompt.trim()) {
      toast.warn("프롬프트를 입력해줘");
      return;
    }
    if (comfyuiStatus === "stopped") {
      toast.warn(
        "ComfyUI 정지 상태",
        "설정에서 시작해도 되고, Mock 은 그대로 돌아가.",
      );
    }

    if (showUpgradeStep) {
      // 업그레이드 확인 모달 경유 — upgrade-only 먼저 호출
      setUpgradeOpen(true);
      setUpgradeLoading(true);
      setUpgradeResult(null);
      try {
        const result = await upgradeOnly({
          prompt,
          research,
          ollamaModel: ollamaModelSel,
        });
        setUpgradeResult(result);
      } catch (err) {
        toast.error(
          "업그레이드 실패",
          err instanceof Error ? err.message : "원본으로 바로 생성할게",
        );
        setUpgradeOpen(false);
        // 폴백: 업그레이드 없이 바로 생성
        await runGenerateStream();
      } finally {
        setUpgradeLoading(false);
      }
      return;
    }

    // 기본 플로우 — 바로 생성
    await runGenerateStream();
  };

  const handleUpgradeConfirm = async (p: {
    finalPrompt: string;
    researchHints: string[];
  }) => {
    setUpgradeOpen(false);
    // research 토글 ON + upgrade-only 단계에서 이미 조사된 힌트가 있으면 재호출 방지.
    // 토글 OFF 면 힌트 자체를 보내지 않아 백엔드가 research 단계를 스킵.
    await runGenerateStream(
      p.finalPrompt,
      research ? p.researchHints : undefined,
    );
  };

  const handleUpgradeRerun = async () => {
    setUpgradeLoading(true);
    try {
      const result = await upgradeOnly({
        prompt,
        research,
        ollamaModel: ollamaModelSel,
      });
      setUpgradeResult(result);
    } catch (err) {
      toast.error("재업그레이드 실패", err instanceof Error ? err.message : "");
    } finally {
      setUpgradeLoading(false);
    }
  };

  /* ── "조사 필요" 단독 실행 (모달 대신 토스트 힌트) ── */
  const handleResearchNow = async () => {
    toast.info("Claude CLI 호출 중…", "최신 팁을 조사하는 중이야");
    try {
      const { hints } = await researchPrompt(prompt, GENERATE_MODEL.displayName);
      toast.success("조사 완료", hints.slice(0, 2).join(" · "));
    } catch (err) {
      toast.error(
        "조사 실패",
        err instanceof Error ? err.message : "",
      );
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {progressOpen && (
        <ProgressModal mode="generate" onClose={() => setProgressOpen(false)} />
      )}
      <UpgradeConfirmModal
        open={upgradeOpen}
        loading={upgradeLoading}
        original={prompt}
        result={upgradeResult}
        onConfirm={handleUpgradeConfirm}
        onRerun={handleUpgradeRerun}
        onCancel={() => {
          setUpgradeOpen(false);
          toast.info("생성 취소됨");
        }}
      />
      <ImageLightbox
        src={lightboxSrc}
        alt={selectedItem?.label}
        filename={
          selectedItem
            ? filenameFromRef(
                selectedItem.imageRef,
                `ais-${selectedItem.id}.png`,
              )
            : undefined
        }
        onClose={() => setLightboxSrc(null)}
        onDownload={() => {
          if (selectedItem) {
            downloadImage(
              selectedItem.imageRef,
              filenameFromRef(
                selectedItem.imageRef,
                `ais-${selectedItem.id}.png`,
              ),
            );
          }
        }}
      />
      <TopBar
        left={
          <>
            <BackBtn onClick={() => router.push("/")} />
            <Logo />
          </>
        }
        center={
          <ModelBadge
            name={GENERATE_MODEL.displayName}
            tag={GENERATE_MODEL.tag}
            status={comfyuiStatus === "running" ? "ready" : "loading"}
          />
        }
        right={
          <>
            <VramBadge />
            <SettingsButton />
          </>
        }
      />

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "2fr 3fr",
          minHeight: "calc(100vh - 52px)",
        }}
      >
        {/* ── LEFT: 입력 영역 ── */}
        <section
          style={{
            padding: "28px 32px",
            borderRight: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 20,
            background: "var(--bg)",
          }}
        >
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <label
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: "var(--ink-2)",
                  letterSpacing: "-0.005em",
                }}
              >
                프롬프트
              </label>
              <span
                className="mono"
                style={{ fontSize: 10.5, color: "var(--ink-4)" }}
              >
                {prompt.length} chars · KO
              </span>
            </div>
            <div
              style={{
                position: "relative",
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                transition: "border .15s",
                boxShadow: "var(--shadow-sm)",
              }}
            >
              {/* 숨김 스프링 프롬프트 히스토리 메뉴 (우상단) */}
              <PromptHistoryPeek
                mode="generate"
                onSelect={(p) => setPrompt(p)}
              />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  // Shift+Enter — 즉시 생성 (툴팁 ⇧↵ 배지와 일치)
                  if (e.key === "Enter" && e.shiftKey) {
                    e.preventDefault();
                    if (!generating && prompt.trim()) handleGenerate();
                  }
                }}
                placeholder="자연어로 자유롭게 입력. 예: 책 읽는 고양이, 창가, 늦은 오후..."
                rows={5}
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  background: "transparent",
                  padding: "14px 44px 38px 16px",
                  fontFamily: "inherit",
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "var(--ink)",
                  borderRadius: 12,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 8,
                  left: 10,
                  right: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "var(--ink-4)",
                }}
              >
                <div style={{ display: "flex", gap: 6 }}>
                  <Pill mini>Shift+Enter 생성</Pill>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!prompt.trim()) {
                        toast.warn("저장할 프롬프트가 없어");
                        return;
                      }
                      const name =
                        typeof window !== "undefined"
                          ? window.prompt("템플릿 이름?", prompt.slice(0, 20))
                          : null;
                      if (!name) return;
                      addTemplate({ name: name.trim(), text: prompt });
                      toast.success(
                        "템플릿 저장됨",
                        "⚙️ 설정 > 프롬프트 템플릿에서 불러오기",
                      );
                    }}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      fontSize: 11,
                      color: "var(--accent-ink)",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                    title="현재 프롬프트를 템플릿으로 저장"
                  >
                    <Icon name="sparkle" size={11} /> 템플릿 저장
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrompt("")}
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
                    <Icon name="x" size={11} /> 비우기
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 조사 필요 배너 */}
          <label
            style={{
              display: "flex",
              gap: 12,
              padding: "14px 16px",
              background: "var(--amber-soft)",
              border: "1px solid rgba(250,173,20,.35)",
              borderRadius: 10,
              cursor: "pointer",
              alignItems: "flex-start",
            }}
          >
            <input
              type="checkbox"
              checked={research}
              onChange={(e) => setResearch(e.target.checked)}
              style={{
                marginTop: 3,
                accentColor: "var(--amber-ink)",
                width: 15,
                height: 15,
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--amber-ink)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  letterSpacing: "-0.005em",
                }}
              >
                <Icon name="search" size={13} />
                조사 필요{" "}
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 500,
                    background: "#FFF",
                    border: "1px solid rgba(250,173,20,.35)",
                    borderRadius: 4,
                    padding: "1px 6px",
                    color: "var(--amber-ink)",
                  }}
                >
                  퀄리티 업
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    handleResearchNow();
                  }}
                  style={{
                    marginLeft: "auto",
                    all: "unset",
                    cursor: "pointer",
                    fontSize: 10.5,
                    color: "var(--amber-ink)",
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: "1px solid rgba(250,173,20,.35)",
                    background: "#fff",
                  }}
                  title="지금 바로 조사만 실행"
                >
                  미리보기
                </button>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-2)",
                  marginTop: 4,
                  lineHeight: 1.55,
                }}
              >
                Claude CLI로 최신 모델 정보·프롬프트 스타일을 조사한 뒤 반영합니다.
                <span style={{ color: "var(--ink-4)" }}> 약 +15s</span>
              </div>
            </div>
          </label>

          {/* 고급 accordion */}
          <AdvancedAccordion
            aspect={aspect}
            sizeLabel={sizeLabel}
            width={width}
            height={height}
            aspectLocked={aspectLocked}
            lightning={lightning}
            steps={steps}
            cfg={cfg}
            seed={seed}
            onAspect={(v) => setAspect(v)}
            onWidth={setWidth}
            onHeight={setHeight}
            onAspectLocked={setAspectLocked}
            onLightning={applyLightning}
            onSteps={setSteps}
            onCfg={setCfg}
            onSeed={setSeed}
          />

          {/* Primary CTA — sticky 하단 (페이지 스크롤 시 viewport 하단에 고정) */}
          <div
            style={{
              position: "sticky",
              bottom: 12,
              marginTop: "auto",
              paddingTop: 10,
              zIndex: 4,
              // 하단 그라데이션으로 "떠있는 느낌"
              background:
                "linear-gradient(to bottom, transparent, var(--bg) 45%)",
            }}
          >
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            style={{
              all: "unset",
              cursor: generating || !prompt.trim() ? "not-allowed" : "pointer",
              textAlign: "center",
              background:
                generating || !prompt.trim() ? "#B9CEE5" : "var(--accent)",
              color: "#fff",
              padding: "14px 20px",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "-0.005em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              boxSizing: "border-box",
              boxShadow: generating
                ? "none"
                : "0 4px 18px rgba(74,158,255,.42), inset 0 1px 0 rgba(255,255,255,.2)",
              transition: "all .18s",
              position: "relative",
              overflow: "hidden",
            }}
            onMouseEnter={(e) => {
              if (!generating && prompt.trim())
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--accent-ink)";
            }}
            onMouseLeave={(e) => {
              if (!generating && prompt.trim())
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--accent)";
            }}
          >
            {generating ? (
              <>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${progress}%`,
                    background: "rgba(255,255,255,.18)",
                    transition: "width .2s",
                  }}
                />
                <span
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Spinner />
                  {stage} · {Math.round(progress)}%
                </span>
              </>
            ) : (
              <>
                <Icon name="sparkle" size={15} />
                생성
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    opacity: 0.8,
                    fontWeight: 500,
                    marginLeft: 4,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "rgba(255,255,255,.18)",
                  }}
                >
                  ⇧↵
                </span>
              </>
            )}
          </button>

          <div
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              textAlign: "center",
              marginTop: 6,
            }}
          >
            평균 소요{" "}
            <span className="mono">~{research ? "42" : "28"}s</span> · 로컬 처리 ·
            데이터 전송 없음
          </div>
          </div>
        </section>

        {/* ── RIGHT: 갤러리 ── */}
        <section
          style={{
            padding: "24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingBottom: 2,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink)",
                }}
              >
                결과 · 히스토리
              </h3>
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-4)", letterSpacing: ".04em" }}
              >
                {genItems.length} images
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <IconBtn
                icon="grid"
                title={`그리드 (${gridCols} 컬럼 · 클릭으로 변경)`}
                onClick={cycleGrid}
              />
              <IconBtn
                icon="zoom-in"
                title="크게 보기"
                onClick={() => {
                  if (selectedItem?.imageRef) {
                    setLightboxSrc(selectedItem.imageRef);
                  } else {
                    toast.warn("선택된 이미지가 없어");
                  }
                }}
              />
            </div>
          </div>

          {/* 선택 프리뷰 */}
          {selectedItem ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) 220px",
                gap: 16,
                padding: 16,
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 14,
                boxShadow: "var(--shadow-sm)",
              }}
            >
              <ImageTile
                seed={selectedItem.imageRef || selectedItem.id}
                aspect="1/1"
              />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  minWidth: 0,
                }}
              >
                <div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--ink-4)",
                      letterSpacing: ".08em",
                    }}
                  >
                    #{selectedItem.id.slice(-6).toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      marginTop: 4,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {selectedItem.label}
                  </div>
                </div>
                <Meta k="모델" v={selectedItem.model} />
                <Meta
                  k="사이즈"
                  v={`${selectedItem.width}×${selectedItem.height}`}
                />
                <Meta
                  k="스텝/CFG"
                  v={`${selectedItem.steps} · ${selectedItem.cfg}${selectedItem.lightning ? " ⚡" : ""}`}
                />
                <Meta
                  k="Seed"
                  v={<span className="mono">{selectedItem.seed}</span>}
                />
                <Meta
                  k="LoRA"
                  v={`${activeLoras(GENERATE_MODEL, selectedItem.lightning).length} 적용 (+${countExtraLoras(GENERATE_MODEL)})`}
                />
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 6,
                    marginTop: "auto",
                  }}
                >
                  <SmallBtn
                    icon="download"
                    onClick={() =>
                      downloadImage(
                        selectedItem.imageRef,
                        filenameFromRef(
                          selectedItem.imageRef,
                          `ais-${selectedItem.id}.png`,
                        ),
                      )
                    }
                  >
                    저장
                  </SmallBtn>
                  <SmallBtn
                    icon="copy"
                    onClick={() => copyImageToClipboard(selectedItem.imageRef)}
                  >
                    복사
                  </SmallBtn>
                  <SmallBtn
                    icon="edit"
                    onClick={async () => {
                      // 이미지를 data URL 로 변환 → useEditStore 에 source 로 저장 → /edit 이동
                      toast.info("수정으로 전송 중…");
                      const res = await urlToDataUrl(selectedItem.imageRef);
                      if (!res) {
                        toast.error("전송 실패", "이미지를 불러올 수 없음");
                        return;
                      }
                      useEditStore
                        .getState()
                        .setSource(
                          res.dataUrl,
                          `${selectedItem.label} · ${res.width}×${res.height}`,
                          res.width,
                          res.height,
                        );
                      router.push("/edit");
                    }}
                  >
                    수정으로
                  </SmallBtn>
                  <SmallBtn
                    icon="sparkle"
                    onClick={() => {
                      // 프롬프트/사이즈/시드/옵션을 현재 폼에 완전 복원 (픽셀 기준 권위)
                      setPrompt(selectedItem.prompt);
                      // 실제 픽셀 사이즈를 그대로 복원 — 프리셋/커스텀 여부 무관.
                      // setDimensions 는 aspectLocked 무시하고 원자적으로 양쪽 세팅 + aspect 라벨 매칭.
                      setDimensions(selectedItem.width, selectedItem.height);
                      setSeed(selectedItem.seed);
                      setSteps(selectedItem.steps);
                      setCfg(selectedItem.cfg);
                      if (selectedItem.lightning !== lightning) {
                        applyLightning(selectedItem.lightning);
                      }
                      toast.info(
                        "재생성 준비",
                        `${selectedItem.width}×${selectedItem.height} · [생성] 눌러`,
                      );
                    }}
                  >
                    재생성
                  </SmallBtn>
                </div>
              </div>
            </div>
          ) : null}

          {/* AI 보강 결과 카드 (선택된 아이템에 한해) */}
          {selectedItem && <AiEnhanceCard item={selectedItem} />}

          {!selectedItem && (
            <div
              style={{
                padding: "28px 20px",
                background: "var(--surface)",
                border: "1px dashed var(--line-2)",
                borderRadius: 14,
                textAlign: "center",
                color: "var(--ink-4)",
                fontSize: 12.5,
              }}
            >
              아직 생성된 이미지가 없어요. 프롬프트 입력 후 <b>생성</b> 버튼을
              눌러봐.
            </div>
          )}

          {/* 그리드 */}
          <div style={{ flex: 1, minHeight: 0 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                gap: 12,
              }}
            >
              {genItems.map((it) => (
                <HistoryTile
                  key={it.id}
                  item={it}
                  selected={selectedId === it.id}
                  onClick={() => selectItem(it.id)}
                  onDoubleClick={() => setLightboxSrc(it.imageRef)}
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ─────────────────────────────────
   고급 accordion (지역 컴포넌트)
   ───────────────────────────────── */
function AdvancedAccordion({
  aspect,
  sizeLabel,
  width,
  height,
  aspectLocked,
  lightning,
  steps,
  cfg,
  seed,
  onAspect,
  onWidth,
  onHeight,
  onAspectLocked,
  onLightning,
  onSteps,
  onCfg,
  onSeed,
}: {
  aspect: AspectValue;
  sizeLabel: string;
  width: number;
  height: number;
  aspectLocked: boolean;
  lightning: boolean;
  steps: number;
  cfg: number;
  seed: number;
  onAspect: (v: AspectRatioLabel) => void;
  onWidth: (v: number) => void;
  onHeight: (v: number) => void;
  onAspectLocked: (v: boolean) => void;
  onLightning: (v: boolean) => void;
  onSteps: (v: number) => void;
  onCfg: (v: number) => void;
  onSeed: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
  // 입력 중 raw string — blur/Enter 시에만 store 커밋 (중간값 clamp 방지)
  const [rawW, setRawW] = useState(String(width));
  const [rawH, setRawH] = useState(String(height));

  // store 값이 외부에서 바뀌면(프리셋 칩 클릭 등) raw 도 동기화
  const prevWidth = useRef(width);
  const prevHeight = useRef(height);
  useEffect(() => {
    if (prevWidth.current !== width) { setRawW(String(width)); prevWidth.current = width; }
    if (prevHeight.current !== height) { setRawH(String(height)); prevHeight.current = height; }
  }, [width, height]);

  const commitW = () => { const n = parseInt(rawW, 10); if (!isNaN(n)) onWidth(n); else setRawW(String(width)); };
  const commitH = () => { const n = parseInt(rawH, 10); if (!isNaN(n)) onHeight(n); else setRawH(String(height)); };

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        overflow: "hidden",
        transition: "all .2s",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          all: "unset",
          cursor: "pointer",
          width: "100%",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 13,
          color: "var(--ink-2)",
          fontWeight: 500,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          고급
          <span
            className="mono"
            style={{
              fontSize: 10.5,
              color: "var(--ink-4)",
              letterSpacing: ".04em",
            }}
          >
            {aspect} · {sizeLabel} · {steps} steps · CFG {cfg}
            {lightning && " · ⚡"}
          </span>
        </span>
        <div
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0)",
            transition: "transform .2s",
            color: "var(--ink-3)",
          }}
        >
          <Icon name="chevron-down" size={15} />
        </div>
      </button>
      {open && (
        <div
          style={{
            padding: "6px 16px 18px",
            borderTop: "1px solid var(--line)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "16px 20px",
          }}
        >
          <div style={{ gridColumn: "1 / -1" }}>
          <Field
            label={`사이즈 · ${sizeLabel}${aspect === "custom" ? "" : ` · ${aspect}`}`}
          >
            {/* W × H 숫자 입력 + 비율 잠금 토글 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                className="mono"
                type="number"
                min={256}
                max={2048}
                step={8}
                value={rawW}
                onChange={(e) => setRawW(e.target.value)}
                onBlur={commitW}
                onKeyDown={(e) => { if (e.key === "Enter") { commitW(); (e.target as HTMLInputElement).blur(); } }}
                style={{ ...inputStyle, width: 78, textAlign: "right" }}
                aria-label="width px"
              />
              <button
                type="button"
                onClick={() => onAspectLocked(!aspectLocked)}
                title={
                  aspectLocked
                    ? "비율 잠금 ON — 한쪽 수정 시 반대쪽 자동 계산"
                    : "비율 잠금 OFF — 자유 입력"
                }
                style={{
                  ...iconBtnStyle,
                  background: aspectLocked
                    ? "var(--accent-soft)"
                    : iconBtnStyle.background,
                  color: aspectLocked ? "var(--accent)" : iconBtnStyle.color,
                  borderColor: aspectLocked
                    ? "var(--accent)"
                    : iconBtnStyle.borderColor,
                }}
              >
                <Icon name={aspectLocked ? "lock" : "unlock"} size={13} />
              </button>
              <input
                className="mono"
                type="number"
                min={256}
                max={2048}
                step={8}
                value={rawH}
                onChange={(e) => setRawH(e.target.value)}
                onBlur={commitH}
                onKeyDown={(e) => { if (e.key === "Enter") { commitH(); (e.target as HTMLInputElement).blur(); } }}
                style={{ ...inputStyle, width: 78, textAlign: "right" }}
                aria-label="height px"
              />
            </div>
            {/* 프리셋 칩 — 원터치로 익숙한 비율 설정 */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                marginTop: 6,
              }}
            >
              {ASPECT_RATIOS.map((r) => {
                const active = aspect === r.label;
                return (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => onAspect(r.label)}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      fontSize: 10.5,
                      fontWeight: 500,
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: `1px solid ${
                        active ? "var(--accent)" : "var(--line)"
                      }`,
                      background: active
                        ? "var(--accent-soft)"
                        : "transparent",
                      color: active ? "var(--accent)" : "var(--ink-3)",
                    }}
                    title={`${r.width}×${r.height}`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </Field>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Lightning 모드">
            <Toggle
              checked={lightning}
              onChange={onLightning}
              label={lightning ? "⚡ 4-step (빠름)" : "표준 (고퀄)"}
              desc={
                lightning
                  ? "Lightning LoRA ON · 약 4배 빠름"
                  : "Lightning LoRA OFF · 풀 퀄리티"
              }
            />
          </Field>
          </div>
          <Field label={`스텝 · ${steps}`}>
            <Range min={4} max={50} value={steps} onChange={onSteps} />
          </Field>
          <Field label={`CFG · ${cfg}`}>
            <Range min={1} max={10} step={0.5} value={cfg} onChange={onCfg} />
          </Field>
          <Field label="Seed">
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="mono"
                value={seed}
                onChange={(e) =>
                  onSeed(
                    Number(e.target.value.replace(/\D/g, "").slice(0, 15)) || 0,
                  )
                }
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => onSeed(Math.floor(Math.random() * 1e15))}
                style={iconBtnStyle}
                title="랜덤"
              >
                <Icon name="refresh" size={14} />
              </button>
            </div>
          </Field>
        </div>
      )}
    </div>
  );
}
