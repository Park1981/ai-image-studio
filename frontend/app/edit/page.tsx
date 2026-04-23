/**
 * Edit Mode Page — Zustand + Mock API + FileReader 업로드.
 *  - sourceImage 는 useEditStore (세션 한정)
 *  - 완료 시 useHistoryStore 에 추가
 *  - 우측 Before/After 슬라이더 비교
 *  - 히스토리에서 선택: 오버레이 팝업 (최근 이미지 12개에서 source 로 지정)
 */

"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Logo,
  TopBar,
  BackBtn,
  ModelBadge,
} from "@/components/chrome/Chrome";
import SettingsButton from "@/components/settings/SettingsButton";
import AiEnhanceCard from "@/components/studio/AiEnhanceCard";
import HistoryTile from "@/components/studio/HistoryTile";
import ImageLightbox from "@/components/studio/ImageLightbox";
import ProgressModal from "@/components/studio/ProgressModal";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import { useProcessStore } from "@/stores/useProcessStore";
import Icon from "@/components/ui/Icon";
import ImageTile from "@/components/ui/ImageTile";
import {
  SmallBtn,
  StepMark,
  Spinner,
  Toggle,
} from "@/components/ui/primitives";
import { EDIT_MODEL, countExtraLoras } from "@/lib/model-presets";
import { editImageStream } from "@/lib/api-client";
import { downloadImage, filenameFromRef } from "@/lib/image-actions";
import { useEditStore } from "@/stores/useEditStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";

/* 자동 파이프라인 4단계 정의 */
const PIPELINE_META = [
  {
    n: 1,
    label: "이미지 비전 분석",
    model: "gemma4-heretic:vision-q4km",
  },
  {
    n: 2,
    label: "설명 + 수정 요청 통합",
    model: "gemma4-un",
  },
  {
    n: 3,
    label: "사이즈/스타일 자동 추출",
    model: "auto-param-extractor",
  },
  {
    n: 4,
    label: "ComfyUI 실행",
    model: "qwen-image-edit-2511",
  },
];

export default function EditPage() {
  const router = useRouter();

  /* ── store ── */
  const sourceImage = useEditStore((s) => s.sourceImage);
  const sourceLabel = useEditStore((s) => s.sourceLabel);
  const sourceWidth = useEditStore((s) => s.sourceWidth);
  const sourceHeight = useEditStore((s) => s.sourceHeight);
  const setSource = useEditStore((s) => s.setSource);
  const prompt = useEditStore((s) => s.prompt);
  const setPrompt = useEditStore((s) => s.setPrompt);
  const lightning = useEditStore((s) => s.lightning);
  const setLightning = useEditStore((s) => s.setLightning);
  const running = useEditStore((s) => s.running);
  const setRunning = useEditStore((s) => s.setRunning);
  const currentStep = useEditStore((s) => s.currentStep);
  const stepDone = useEditStore((s) => s.stepDone);
  const setStep = useEditStore((s) => s.setStep);
  const recordStepDetail = useEditStore((s) => s.recordStepDetail);
  const setSampling = useEditStore((s) => s.setSampling);
  const setPipelineProgress = useEditStore((s) => s.setPipelineProgress);
  const compareX = useEditStore((s) => s.compareX);
  const setCompareX = useEditStore((s) => s.setCompareX);
  const resetPipeline = useEditStore((s) => s.resetPipeline);

  const lightningByDefault = useSettingsStore((s) => s.lightningByDefault);
  const ollamaModelSel = useSettingsStore((s) => s.ollamaModel);
  const visionModelSel = useSettingsStore((s) => s.visionModel);
  const comfyuiStatus = useProcessStore((s) => s.comfyui);

  const items = useHistoryStore((s) => s.items);
  const addItem = useHistoryStore((s) => s.add);
  const selectHistory = useHistoryStore((s) => s.select);
  // 수정 모드 우측 그리드는 edit 결과만 (generate 섞이면 Before/After 슬라이더가 엉뚱하게 매칭됨)
  const editResults = items.filter((x) => x.mode === "edit");
  const historyForRight = editResults.slice(0, 12);
  // afterId 는 기본 null. 새 수정이 완료되면 setAfterId 로 지정됨.
  // 히스토리 썸네일 클릭 시에도 사용자 의도대로 지정됨.
  const [afterId, setAfterId] = useState<string | null>(null);
  // fallback 제거: afterId 에 해당하는 아이템 없으면 undefined 리턴 → 슬라이더 placeholder 표시
  const afterItem = afterId
    ? historyForRight.find((x) => x.id === afterId)
    : undefined;

  const [drag, setDrag] = useState(false);
  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Lightbox ── */
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // 수정 히스토리 그리드는 3 컬럼 고정 (edit 은 결과 수가 적어 토글 불필요)
  const gridCols = 3;

  /* ── 진행 모달 open 상태 ── */
  const [progressOpen, setProgressOpen] = useState(false);
  useEffect(() => {
    if (running) setProgressOpen(true);
  }, [running]);
  useEffect(() => {
    if (running) return;
    if (!progressOpen) return;
    const t = setTimeout(() => setProgressOpen(false), 1200);
    return () => clearTimeout(t);
  }, [running, progressOpen]);

  /* ── sourceImage 변경 시 afterId 리셋 ──
     과거 edit 결과가 엉뚱한 Before/After 매칭으로 나타나는 현상 방지.
     새 수정이 완료되면 handleGenerate 의 done 핸들러에서 다시 setAfterId 해줌. */
  const prevSourceRef = useRef<string | null>(sourceImage);
  useEffect(() => {
    if (prevSourceRef.current !== sourceImage) {
      prevSourceRef.current = sourceImage;
      setAfterId(null);
    }
  }, [sourceImage]);

  /* ── 진입 시 Lightning 기본값 ── */
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    if (lightningByDefault && !lightning) setLightning(true);
  }, [lightningByDefault, lightning, setLightning]);

  /* ── 파일 업로드 → data URL + 크기 추출 ── */
  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드 가능");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // 이미지 크기 읽기
      const img = new Image();
      img.onload = () => {
        setSource(
          dataUrl,
          `${file.name} · ${img.naturalWidth}×${img.naturalHeight}`,
          img.naturalWidth,
          img.naturalHeight,
        );
        toast.success("이미지 업로드 완료", file.name);
      };
      img.onerror = () => {
        toast.error("이미지 로드 실패");
      };
      img.src = dataUrl;
    };
    reader.onerror = () => toast.error("파일 읽기 실패");
    reader.readAsDataURL(file);
  };

  /* ── 생성 (수정) 실행 ── */
  const handleGenerate = async () => {
    if (running) return;
    if (!sourceImage) {
      toast.warn("원본 이미지 먼저 업로드해줘");
      return;
    }
    if (!prompt.trim()) {
      toast.warn("수정 지시를 입력해줘");
      return;
    }

    setRunning(true);
    try {
      for await (const evt of editImageStream({
        sourceImage,
        prompt,
        lightning,
        ollamaModel: ollamaModelSel,
        visionModel: visionModelSel,
      })) {
        if (evt.type === "sampling") {
          // ComfyUI 샘플링 상세 (step 4 내부)
          setSampling(evt.samplingStep ?? null, evt.samplingTotal ?? null);
          continue;
        }
        if (evt.type === "step") {
          setStep(evt.step, evt.done);
          if (!evt.done) {
            // step 시작 시점 기록
            recordStepDetail({
              n: evt.step,
              startedAt: Date.now(),
              doneAt: null,
            });
          } else {
            // step 완료 + 상세 데이터 병합
            recordStepDetail({
              n: evt.step,
              startedAt: Date.now(), // merge 시 기존 값 유지됨
              doneAt: Date.now(),
              description: evt.description,
              finalPrompt: evt.finalPrompt,
              finalPromptKo: evt.finalPromptKo,
              provider: evt.provider,
            });
          }
        } else if (evt.type === "stage") {
          // 백엔드가 계산한 전체 파이프라인 진행률(0~100) 그대로 표시
          setPipelineProgress(evt.progress, evt.stageLabel);
        } else if (evt.type === "done") {
          resetPipeline();
          addItem(evt.item);
          setAfterId(evt.item.id);
          toast.success("수정 완료", evt.item.label);
          if (evt.item.comfyError) {
            toast.error(
              "ComfyUI 오류 (Mock 폴백 적용)",
              evt.item.comfyError.slice(0, 160),
            );
          } else if (evt.item.promptProvider === "fallback") {
            toast.warn(
              "gemma4 업그레이드 실패",
              "Ollama 상태 확인 필요",
            );
          }
          return;
        }
      }
    } catch (err) {
      resetPipeline();
      toast.error(
        "수정 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {progressOpen && (
        <ProgressModal mode="edit" onClose={() => setProgressOpen(false)} />
      )}
      <ImageLightbox
        src={lightboxSrc}
        alt={afterItem?.label}
        filename={
          afterItem
            ? filenameFromRef(
                afterItem.imageRef,
                `ais-edit-${afterItem.id}.png`,
              )
            : undefined
        }
        onClose={() => setLightboxSrc(null)}
        onDownload={() => {
          if (afterItem) {
            downloadImage(
              afterItem.imageRef,
              filenameFromRef(
                afterItem.imageRef,
                `ais-edit-${afterItem.id}.png`,
              ),
            );
          }
        }}
        onUseAsSource={
          afterItem
            ? () => {
                // Lightbox 에서 "원본으로" — 연속 수정 플로우
                setSource(
                  afterItem.imageRef,
                  `${afterItem.label} · ${afterItem.width}×${afterItem.height}`,
                  afterItem.width,
                  afterItem.height,
                );
                setAfterId(null);
                toast.info("원본으로 지정", afterItem.label);
              }
            : undefined
        }
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
            name={EDIT_MODEL.displayName}
            tag={EDIT_MODEL.tag}
            status={comfyuiStatus === "running" ? "ready" : "loading"}
          />
        }
        right={
          <>
            <div
              className="mono"
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                letterSpacing: ".05em",
                marginRight: 4,
              }}
            >
              VRAM 11.4 / 24 GB
            </div>
            <SettingsButton />
          </>
        }
      />

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "400px 1fr",
          minHeight: "calc(100vh - 52px)",
        }}
      >
        {/* ── LEFT column ── */}
        <section
          style={{
            padding: "24px 20px",
            borderRight: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            background: "var(--bg)",
          }}
        >
          {/* Dropzone */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
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

            {/* History picker overlay */}
            {historyPickerOpen && (
              <div
                style={{
                  marginBottom: 10,
                  padding: 10,
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                {items.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--ink-4)",
                      textAlign: "center",
                      padding: 12,
                    }}
                  >
                    아직 히스토리가 없어요.
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 6,
                    }}
                  >
                    {items.slice(0, 16).map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => {
                          setSource(
                            it.imageRef,
                            `${it.label} · ${it.width}×${it.height}`,
                            it.width,
                            it.height,
                          );
                          setHistoryPickerOpen(false);
                          toast.info("원본으로 지정", it.label);
                        }}
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          borderRadius: 6,
                          overflow: "hidden",
                        }}
                        title={it.label}
                      >
                        <ImageTile
                          seed={it.imageRef || it.id}
                          aspect="1/1"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 컴팩트 이미지 카드 — 이미지 우선, 상세정보는 ⓘ 클릭 시 팝오버 */}
            <div style={{ position: "relative" }}>
              {/* 정보 팝오버 — ⓘ 클릭 시 카드 위에 표시 */}
              {infoOpen && sourceImage && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    left: 0,
                    right: 0,
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    zIndex: 20,
                    boxShadow: "0 4px 16px rgba(0,0,0,.1)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 11.5,
                  }}
                >
                  <Icon name="check" size={10} style={{ color: "var(--green)", flexShrink: 0 }} />
                  <span
                    style={{
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--ink-2)",
                    }}
                  >
                    {sourceLabel}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSource(null);
                      setInfoOpen(false);
                      toast.info("이미지 해제됨");
                    }}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      color: "var(--ink-3)",
                      fontSize: 11,
                      textDecoration: "underline",
                      textUnderlineOffset: 3,
                      flexShrink: 0,
                    }}
                  >
                    해제
                  </button>
                </div>
              )}

              {/* 메인 카드 */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
                onClick={() => { if (!sourceImage) fileInputRef.current?.click(); }}
                style={{
                  position: "relative",
                  height: 256,
                  borderRadius: 12,
                  overflow: "hidden",
                  background: sourceImage
                    ? "var(--bg-2)"
                    : drag ? "var(--accent-soft)" : "rgba(74,158,255,.04)",
                  border: sourceImage
                    ? `1px solid var(--line)`
                    : `1.5px dashed ${drag ? "var(--accent)" : "rgba(74,158,255,.45)"}`,
                  transition: "all .2s",
                  cursor: sourceImage ? "default" : "pointer",
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleFiles(e.target.files)}
                  style={{ display: "none" }}
                />

                {sourceImage ? (
                  <>
                    {/* 이미지 풀커버 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={sourceImage}
                      alt={sourceLabel}
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#111" }}
                    />
                    {/* 하단 그라디언트 오버레이 */}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(to top, rgba(0,0,0,.55) 0%, transparent 55%)",
                        pointerEvents: "none",
                      }}
                    />
                    {/* 사이즈 배지 — 좌하단 */}
                    {sourceWidth && sourceHeight && (
                      <span
                        className="mono"
                        style={{
                          position: "absolute",
                          bottom: 8,
                          left: 10,
                          fontSize: 10,
                          color: "rgba(255,255,255,.85)",
                          letterSpacing: ".04em",
                          background: "rgba(0,0,0,.35)",
                          borderRadius: 4,
                          padding: "2px 6px",
                          pointerEvents: "none",
                        }}
                      >
                        {sourceWidth}×{sourceHeight}
                      </span>
                    )}
                    {/* 변경 버튼 — 우하단 */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      style={{
                        position: "absolute",
                        bottom: 8,
                        right: 8,
                        fontSize: 10,
                        color: "rgba(255,255,255,.8)",
                        background: "rgba(0,0,0,.35)",
                        border: "none",
                        borderRadius: 4,
                        padding: "2px 7px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      변경
                    </button>
                    {/* ⓘ 상세보기 — 좌상단 */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setInfoOpen((v) => !v); }}
                      style={{
                        position: "absolute",
                        top: 8,
                        left: 8,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: infoOpen ? "rgba(255,255,255,.9)" : "rgba(0,0,0,.4)",
                        color: infoOpen ? "var(--ink)" : "#fff",
                        border: "none",
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        fontFamily: "serif",
                        lineHeight: 1,
                      }}
                      title="상세 정보"
                    >
                      i
                    </button>
                    {/* × 해제 — 우상단 */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setSource(null); setInfoOpen(false); toast.info("이미지 해제됨"); }}
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "rgba(0,0,0,.4)",
                        color: "#fff",
                        border: "none",
                        cursor: "pointer",
                        display: "grid",
                        placeItems: "center",
                      }}
                      title="이미지 해제"
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </>
                ) : (
                  /* 빈 상태 — 업로드 유도 */
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "100%",
                      gap: 8,
                      color: "var(--ink-4)",
                    }}
                  >
                    <Icon name="upload" size={22} />
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink-3)" }}>
                      드래그 또는 클릭
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>
                      PNG · JPG · WebP
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Prompt */}
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
                수정 지시
              </label>
              <span
                className="mono"
                style={{ fontSize: 10.5, color: "var(--ink-4)" }}
              >
                {prompt.length} chars
              </span>
            </div>
            <div
              style={{
                position: "relative",
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "var(--shadow-sm)",
              }}
            >
              {/* 숨김 스프링 프롬프트 히스토리 메뉴 */}
              <PromptHistoryPeek
                mode="edit"
                onSelect={(p) => setPrompt(p)}
              />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="어떻게 수정할까요? 예: 배경을 바다로 바꿔줘"
                rows={3}
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  background: "transparent",
                  padding: "12px 42px 30px 14px",
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: "var(--ink)",
                  borderRadius: 12,
                }}
              />
              {/* 비우기 버튼 — Generate 페이지와 통일 */}
              {prompt.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPrompt("")}
                  title="프롬프트 비우기"
                  style={{
                    all: "unset",
                    cursor: "pointer",
                    position: "absolute",
                    bottom: 6,
                    right: 10,
                    fontSize: 11,
                    color: "var(--ink-4)",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    padding: "4px 6px",
                    borderRadius: 6,
                    transition: "background .12s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "var(--bg-2)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "transparent";
                  }}
                >
                  <Icon name="x" size={10} /> 비우기
                </button>
              )}
            </div>
          </div>

          {/* Lightning toggle (간단 UI) */}
          <Toggle
            checked={lightning}
            onChange={setLightning}
            label={lightning ? "⚡ Lightning 4-step" : "표준 40-step"}
            desc={
              lightning
                ? "빠름 · 약간 낮은 디테일"
                : "풀 퀄리티 · 약 ~38s 예상"
            }
          />

          {/* Pipeline (4단계 초록박스) */}
          <div
            style={{
              background: "var(--green-soft)",
              border: "1px solid rgba(82,196,26,.28)",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--green-ink)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  letterSpacing: "-0.005em",
                }}
              >
                <Icon name="cpu" size={13} />
                자동 처리 단계
              </div>
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--green-ink)",
                  opacity: 0.7,
                  letterSpacing: ".05em",
                }}
              >
                AUTO · 4 STEPS
              </span>
            </div>

            <ol
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {PIPELINE_META.map((step) => {
                const done = stepDone >= step.n;
                const isRunning = running && currentStep === step.n && !done;
                return (
                  <li
                    key={step.n}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 12,
                      color: "var(--ink-2)",
                      padding: "4px 0",
                    }}
                  >
                    <StepMark done={done} running={isRunning} />
                    <div
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "baseline",
                        gap: 10,
                        minWidth: 0,
                      }}
                    >
                      <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>
                        {step.n}. {step.label}
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 10.5,
                          color: "var(--ink-4)",
                          letterSpacing: ".02em",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {step.model}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: "1px dashed rgba(82,196,26,.3)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--green-ink)",
              }}
            >
              <Icon name="arrow-right" size={12} />
              <span style={{ fontWeight: 500 }}>
                ComfyUI · LoRA +{countExtraLoras(EDIT_MODEL)}
              </span>
              <span
                className="mono"
                style={{
                  color: "var(--ink-4)",
                  marginLeft: "auto",
                  letterSpacing: ".04em",
                }}
              >
                ~{lightning ? "12" : "38"}s 예상
              </span>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          {/* CTA — sticky 하단 (페이지 스크롤 시에도 viewport 하단에 고정) */}
          <div
            style={{
              position: "sticky",
              bottom: 12,
              paddingTop: 10,
              zIndex: 4,
              background:
                "linear-gradient(to bottom, transparent, var(--bg) 45%)",
            }}
          >
          <button
            type="button"
            onClick={handleGenerate}
            disabled={running || !sourceImage || !prompt.trim()}
            style={{
              all: "unset",
              cursor:
                running || !sourceImage || !prompt.trim()
                  ? "not-allowed"
                  : "pointer",
              textAlign: "center",
              background:
                running || !sourceImage || !prompt.trim()
                  ? "#B9CEE5"
                  : "var(--accent)",
              color: "#fff",
              padding: "14px 20px",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              boxSizing: "border-box",
              boxShadow: running
                ? "none"
                : "0 4px 18px rgba(74,158,255,.42), inset 0 1px 0 rgba(255,255,255,.2)",
              transition: "all .18s",
            }}
            onMouseEnter={(e) => {
              if (!running && sourceImage && prompt.trim())
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--accent-ink)";
            }}
            onMouseLeave={(e) => {
              if (!running && sourceImage && prompt.trim())
                (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--accent)";
            }}
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
        </section>

        {/* ── RIGHT column ── */}
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
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                Before · After
              </h3>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink-4)",
                  letterSpacing: ".04em",
                }}
              >
                slider compare
              </span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <SmallBtn
                icon="zoom-in"
                onClick={() => {
                  if (!afterItem) return;
                  setLightboxSrc(afterItem.imageRef);
                }}
              >
                크게
              </SmallBtn>
              <SmallBtn
                icon="download"
                onClick={() => {
                  if (!afterItem) return;
                  downloadImage(
                    afterItem.imageRef,
                    filenameFromRef(
                      afterItem.imageRef,
                      `ais-edit-${afterItem.id}.png`,
                    ),
                  );
                }}
              >
                저장
              </SmallBtn>
              <SmallBtn
                icon="refresh"
                onClick={() => {
                  if (!afterItem) return;
                  // 수정 지시 + Lightning 설정 복원
                  setPrompt(afterItem.prompt);
                  setLightning(afterItem.lightning);
                  toast.info("수정 설정 복원", "[수정 생성] 눌러");
                }}
              >
                다시
              </SmallBtn>
            </div>
          </div>

          {/* Before/After */}
          {sourceImage && afterItem ? (
            <>
              <BeforeAfter
                beforeSrc={sourceImage}
                afterSeed={afterItem.imageRef || afterItem.id}
                compareX={compareX}
                setCompareX={setCompareX}
                aspectRatio={
                  sourceWidth && sourceHeight
                    ? `${sourceWidth} / ${sourceHeight}`
                    : "16 / 10"
                }
              />
              <AiEnhanceCard item={afterItem} />
            </>
          ) : (
            <div
              style={{
                background: "var(--surface)",
                border: "1px dashed var(--line-2)",
                borderRadius: 14,
                aspectRatio: "16 / 10",
                display: "grid",
                placeItems: "center",
                color: "var(--ink-4)",
                fontSize: 12.5,
                textAlign: "center",
                padding: 20,
              }}
            >
              {!sourceImage
                ? "왼쪽에서 원본 이미지부터 올려봐"
                : "아직 이 원본의 수정 결과가 없어. [수정 생성] 또는 아래 히스토리에서 선택하면 표시돼."}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 4,
              borderTop: "1px solid var(--line)",
              marginTop: 4,
            }}
          >
            <h3 style={{ margin: "10px 0 0", fontSize: 13, fontWeight: 600 }}>
              수정 히스토리
            </h3>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 10 }}
            >
              {historyForRight.length} items
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
              gap: 12,
            }}
          >
            {historyForRight.map((it) => (
              <HistoryTile
                key={it.id}
                item={it}
                selected={afterId === it.id}
                onClick={() => {
                  setAfterId(it.id);
                  selectHistory(it.id);
                }}
                onDoubleClick={() => setLightboxSrc(it.imageRef)}
                onAfterDelete={() => {
                  if (afterId === it.id) setAfterId(null);
                }}
                onUseAsSource={() => {
                  // 이 결과 이미지를 다시 수정 원본으로 (연속 수정 플로우)
                  setSource(
                    it.imageRef,
                    `${it.label} · ${it.width}×${it.height}`,
                    it.width,
                    it.height,
                  );
                  setAfterId(null); // 비교 슬라이더 초기화
                  toast.info("원본으로 지정", it.label);
                }}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ─────────────────────────────────
   BeforeAfter 슬라이더 (before 는 dataURL 또는 seed)
   ───────────────────────────────── */
function BeforeAfter({
  beforeSrc,
  afterSeed,
  compareX,
  setCompareX,
  aspectRatio = "16 / 10",
}: {
  beforeSrc: string;
  afterSeed: string;
  compareX: number;
  setCompareX: (v: number) => void;
  /** 원본 이미지 실제 비율 (예: "1920 / 1080"). 없으면 16:10 폴백. */
  aspectRatio?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  const onDrag = (clientX: number) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setCompareX(Math.max(2, Math.min(98, pct)));
  };

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault(); // 브라우저 기본 이미지 드래그·텍스트 선택 차단
    // 드래그 동안 전역 user-select 잠궈서 화면 어디로 가든 하이라이트 안 생기게
    const prevBodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const move = (evt: MouseEvent) => onDrag(evt.clientX);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = prevBodyUserSelect;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // before: data URL 이면 <img contain>, 아니면 seed 기반 ImageTile
  const renderBefore = beforeSrc.startsWith("data:") ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={beforeSrc}
      alt="before"
      draggable={false} // 기본 이미지 고스트 드래그 방지
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        display: "block",
        // @ts-expect-error — 비표준 Webkit 속성
        WebkitUserDrag: "none",
        userSelect: "none",
      }}
    />
  ) : (
    <ImageTile
      seed={beforeSrc}
      aspect={aspectRatio}
      style={{ width: "100%", height: "100%", borderRadius: 0 }}
    />
  );

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        borderRadius: 14,
        overflow: "hidden",
        background: "var(--bg-2)",
        boxShadow: "var(--shadow-sm)",
        border: "1px solid var(--line)",
        aspectRatio,
        maxHeight: "70vh",
        // 슬라이더 전 영역에서 텍스트·이미지 선택 UI 발생 억제
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* After (full) */}
      <ImageTile
        seed={afterSeed}
        aspect={aspectRatio}
        style={{ width: "100%", height: "100%", borderRadius: 0 }}
      />
      {/* Before (clipped) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: `inset(0 ${100 - compareX}% 0 0)`,
        }}
      >
        {renderBefore}
      </div>

      <CornerBadge pos="tl">Before</CornerBadge>
      <CornerBadge pos="tr">After</CornerBadge>

      <div
        onMouseDown={startDrag}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${compareX}%`,
          width: 2,
          background: "#fff",
          transform: "translateX(-1px)",
          cursor: "ew-resize",
          boxShadow: "0 0 0 1px rgba(0,0,0,.15)",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,.2)",
            display: "grid",
            placeItems: "center",
            color: "var(--ink-2)",
          }}
        >
          <div style={{ display: "flex", gap: 0, alignItems: "center" }}>
            <Icon
              name="chevron-right"
              size={12}
              style={{ transform: "rotate(180deg)" }}
            />
            <Icon name="chevron-right" size={12} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CornerBadge({
  pos,
  children,
}: {
  pos: "tl" | "tr" | "bl" | "br";
  children: ReactNode;
}) {
  const p: Record<string, CSSProperties> = {
    tl: { top: 10, left: 10 },
    tr: { top: 10, right: 10 },
    bl: { bottom: 10, left: 10 },
    br: { bottom: 10, right: 10 },
  };
  return (
    <div
      className="mono"
      style={{
        position: "absolute",
        ...p[pos],
        fontSize: 10,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        color: "#fff",
        background: "rgba(0,0,0,.55)",
        backdropFilter: "blur(4px)",
        padding: "3px 8px",
        borderRadius: 4,
      }}
    >
      {children}
    </div>
  );
}
