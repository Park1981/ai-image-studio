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
import VramBadge from "@/components/chrome/VramBadge";
import AiEnhanceCard from "@/components/studio/AiEnhanceCard";
import HistoryPicker from "@/components/studio/HistoryPicker";
import HistoryTile from "@/components/studio/HistoryTile";
import ImageLightbox from "@/components/studio/ImageLightbox";
import PipelineSteps, { type PipelineStepMeta } from "@/components/studio/PipelineSteps";
import ProgressModal from "@/components/studio/ProgressModal";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import SourceImageCard from "@/components/studio/SourceImageCard";
import { useProcessStore } from "@/stores/useProcessStore";
import Icon from "@/components/ui/Icon";
import ImageTile from "@/components/ui/ImageTile";
import { SmallBtn, Spinner, Toggle } from "@/components/ui/primitives";
import { EDIT_MODEL } from "@/lib/model-presets";
import { editImageStream } from "@/lib/api-client";
import { downloadImage, filenameFromRef } from "@/lib/image-actions";
import { useEditStore } from "@/stores/useEditStore";
import { useHistoryStore } from "@/stores/useHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { toast } from "@/stores/useToastStore";

/* 자동 파이프라인 4단계 정의 — PipelineSteps 컴포넌트에 전달 */
const PIPELINE_META: PipelineStepMeta[] = [
  { n: 1, label: "이미지 비전 분석", model: "gemma4-heretic:vision-q4km" },
  { n: 2, label: "설명 + 수정 요청 통합", model: "gemma4-un" },
  { n: 3, label: "사이즈/스타일 자동 추출", model: "auto-param-extractor" },
  { n: 4, label: "ComfyUI 실행", model: "qwen-image-edit-2511" },
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
  // 그리드는 최근 12개만 노출 (과다 스크롤 방지)
  const historyForRight = editResults.slice(0, 12);
  // afterId 는 기본 null. 새 수정이 완료되면 setAfterId 로 지정됨.
  // 히스토리 썸네일 클릭 시에도 사용자 의도대로 지정됨.
  const [afterId, setAfterId] = useState<string | null>(null);
  // afterItem 은 전체 editResults 에서 검색 — 12개 넘어간 오래된 결과라도
  // 사용자가 선택해둔 것이면 슬라이더에 정상 표시됨.
  const afterItem = afterId
    ? editResults.find((x) => x.id === afterId)
    : undefined;

  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);

  /* ── 소스 이미지 해제 (SourceImageCard 의 × 와 팝오버 링크 공통 경로) ── */
  const handleClearSource = () => {
    setSource(null);
    toast.info("이미지 해제됨");
  };

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

  /* ── 파일 업로드 결과 수신 (SourceImageCard 에서 호출) ── */
  const handleSourceChange = (
    image: string,
    label: string,
    w: number,
    h: number,
  ) => {
    setSource(image, label, w, h);
    toast.success("이미지 업로드 완료", label.split(" · ")[0]);
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
          // 히스토리 DB 저장 실패 힌트 (백엔드 B10)
          if (!evt.savedToHistory) {
            toast.warn(
              "히스토리 DB 저장 실패",
              "결과는 화면에서 유지되지만 서버 재기동 후 사라질 수 있어.",
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
            <VramBadge />
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
            <HistoryPicker
              open={historyPickerOpen}
              items={items}
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

            {/* 컴팩트 이미지 카드 */}
            <SourceImageCard
              sourceImage={sourceImage}
              sourceLabel={sourceLabel}
              sourceWidth={sourceWidth}
              sourceHeight={sourceHeight}
              onChange={handleSourceChange}
              onClear={handleClearSource}
              onError={(msg) => toast.error(msg)}
            />
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
          <PipelineSteps
            steps={PIPELINE_META}
            stepDone={stepDone}
            currentStep={currentStep}
            running={running}
            lightning={lightning}
          />

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
