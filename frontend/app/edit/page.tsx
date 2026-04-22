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
  const compareX = useEditStore((s) => s.compareX);
  const setCompareX = useEditStore((s) => s.setCompareX);
  const resetPipeline = useEditStore((s) => s.resetPipeline);

  const lightningByDefault = useSettingsStore((s) => s.lightningByDefault);

  const items = useHistoryStore((s) => s.items);
  const addItem = useHistoryStore((s) => s.add);
  const selectHistory = useHistoryStore((s) => s.select);
  const historyForRight = items.slice(0, 12);
  const [afterId, setAfterId] = useState<string | null>(
    historyForRight[0]?.id ?? null,
  );
  const afterItem =
    historyForRight.find((x) => x.id === afterId) ?? historyForRight[0];

  const [drag, setDrag] = useState(false);
  const [historyPickerOpen, setHistoryPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      })) {
        if (evt.type === "step") {
          setStep(evt.step, evt.done);
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
      <TopBar
        left={
          <>
            <BackBtn onClick={() => router.push("/")} />
            <Logo />
          </>
        }
        center={
          <ModelBadge name={EDIT_MODEL.displayName} tag={EDIT_MODEL.tag} />
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
          gridTemplateColumns: "2fr 3fr",
          minHeight: "calc(100vh - 52px)",
        }}
      >
        {/* ── LEFT column ── */}
        <section
          style={{
            padding: "28px 32px",
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
                        <ImageTile seed={it.id} aspect="1/1" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                position: "relative",
                background: drag ? "var(--accent-soft)" : "rgba(74,158,255,.04)",
                border: `1.5px dashed ${drag ? "var(--accent)" : "rgba(74,158,255,.45)"}`,
                borderRadius: 12,
                padding: "22px 22px",
                minHeight: 180,
                display: "flex",
                gap: 16,
                alignItems: "center",
                transition: "all .2s",
                cursor: "pointer",
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
                sourceImage.startsWith("data:") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sourceImage}
                    alt={sourceLabel}
                    style={{
                      width: 130,
                      height: 130,
                      objectFit: "contain", // 잘리지 않게 letterbox
                      borderRadius: 10,
                      flexShrink: 0,
                      background: "var(--bg-2)",
                      display: "block",
                    }}
                  />
                ) : (
                  <ImageTile
                    seed={sourceImage}
                    aspect="1/1"
                    style={{ width: 130, flexShrink: 0 }}
                  />
                )
              ) : (
                <div
                  style={{
                    width: 130,
                    height: 130,
                    flexShrink: 0,
                    borderRadius: 10,
                    background:
                      "repeating-linear-gradient(135deg, #F4F1EB 0 10px, #EEEAE1 10px 20px)",
                    border: "1px dashed #D4CEC0",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--ink-4)",
                  }}
                >
                  <Icon name="upload" size={22} />
                </div>
              )}

              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--ink)",
                    marginBottom: 2,
                  }}
                >
                  {sourceImage ? "이미지 준비됨" : "이미지 드래그 또는 클릭"}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-3)",
                    marginBottom: 12,
                    lineHeight: 1.55,
                  }}
                >
                  히스토리에서도 선택할 수 있어요 · PNG · JPG · WebP
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    color: "var(--ink-4)",
                    letterSpacing: ".04em",
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "2px 8px",
                      background: "#fff",
                      border: "1px solid var(--line)",
                      borderRadius: 999,
                      color: sourceImage ? "var(--ink-2)" : "var(--ink-4)",
                    }}
                  >
                    {sourceImage && (
                      <Icon
                        name="check"
                        size={10}
                        style={{ color: "var(--green)" }}
                      />
                    )}
                    {sourceLabel}
                  </span>
                  {sourceImage && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSource(null);
                        toast.info("이미지 해제됨");
                      }}
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        color: "var(--ink-3)",
                        textDecoration: "underline",
                        textUnderlineOffset: 3,
                      }}
                    >
                      해제
                    </button>
                  )}
                </div>
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
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "var(--shadow-sm)",
              }}
            >
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
                  padding: "12px 14px",
                  fontFamily: "inherit",
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: "var(--ink)",
                  borderRadius: 12,
                }}
              />
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

          {/* CTA */}
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
              boxShadow: running
                ? "none"
                : "0 2px 10px rgba(74,158,255,.35), inset 0 1px 0 rgba(255,255,255,.2)",
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
              <SmallBtn icon="download">저장</SmallBtn>
              <SmallBtn icon="refresh">다시</SmallBtn>
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
                : "아직 수정 결과가 없어. [수정 생성] 누르면 여기에 Before/After 로 표시돼."}
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
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
            }}
          >
            {historyForRight.map((it) => (
              <ImageTile
                key={it.id}
                seed={it.id}
                label={it.label}
                onClick={() => {
                  setAfterId(it.id);
                  selectHistory(it.id);
                }}
                style={{
                  border:
                    afterId === it.id
                      ? "2px solid var(--accent)"
                      : "2px solid transparent",
                  boxShadow:
                    afterId === it.id
                      ? "0 0 0 4px rgba(74,158,255,.15)"
                      : "none",
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
