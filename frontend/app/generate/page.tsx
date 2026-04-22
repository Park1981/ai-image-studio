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
import AiEnhanceCard from "@/components/studio/AiEnhanceCard";
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
  getAspect,
  type AspectRatioLabel,
} from "@/lib/model-presets";
import { generateImageStream, researchPrompt } from "@/lib/api-client";
import { useGenerateStore } from "@/stores/useGenerateStore";
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

  const addItem = useHistoryStore((s) => s.add);
  const items = useHistoryStore((s) => s.items);
  const selectedId = useHistoryStore((s) => s.selectedId);
  const selectItem = useHistoryStore((s) => s.select);

  const showUpgradeStep = useSettingsStore((s) => s.showUpgradeStep);
  const lightningByDefault = useSettingsStore((s) => s.lightningByDefault);
  const ollamaStatus = useProcessStore((s) => s.ollama);
  const comfyuiStatus = useProcessStore((s) => s.comfyui);

  /* ── 생성 모드에서만 보이는 히스토리 필터 ── */
  const genItems = useMemo(
    () => items.filter((i) => i.mode === "generate"),
    [items],
  );
  const selectedItem = genItems.find((i) => i.id === selectedId);

  /* ── 진입 시 Lightning 기본값 적용 (1회) ── */
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    if (lightningByDefault && !lightning) applyLightning(true);
  }, [lightningByDefault, lightning, applyLightning]);

  const { width, height } = getAspect(aspect);
  const sizeLabel = `${width}×${height}`;

  /* ── 생성 실행 ── */
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

    setRunning(true, 0, "초기화");
    try {
      for await (const evt of generateImageStream({
        prompt,
        aspect,
        steps,
        cfg,
        seed,
        lightning,
        research,
      })) {
        if (evt.type === "done") {
          addItem(evt.item);
          resetRunning();
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
          return;
        }
        setRunning(true, evt.progress, evt.stageLabel);
      }
    } catch (err) {
      resetRunning();
      toast.error(
        "생성 실패",
        err instanceof Error ? err.message : "알 수 없는 오류",
      );
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

  /* ── 프리퍼런스 showUpgradeStep 은 Phase 2 에서 모달로 연결 예정.
        지금은 토스트로 일시 안내만. */
  void showUpgradeStep;
  void ollamaStatus;

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
          <ModelBadge
            name={GENERATE_MODEL.displayName}
            tag={GENERATE_MODEL.tag}
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
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="자연어로 자유롭게 입력. 예: 책 읽는 고양이, 창가, 늦은 오후..."
                rows={5}
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  background: "transparent",
                  padding: "14px 16px 38px",
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
                  <Pill mini>설정 &gt; 템플릿</Pill>
                  <Pill mini>Shift+Enter 생성</Pill>
                </div>
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
            lightning={lightning}
            steps={steps}
            cfg={cfg}
            seed={seed}
            onAspect={(v) => setAspect(v)}
            onLightning={applyLightning}
            onSteps={setSteps}
            onCfg={setCfg}
            onSeed={setSeed}
          />

          {/* Primary CTA */}
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
              boxShadow: generating
                ? "none"
                : "0 2px 10px rgba(74,158,255,.35), inset 0 1px 0 rgba(255,255,255,.2)",
              transition: "all .18s",
              marginTop: "auto",
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
              marginTop: -8,
            }}
          >
            평균 소요{" "}
            <span className="mono">~{research ? "42" : "28"}s</span> · 로컬 처리 ·
            데이터 전송 없음
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
              <IconBtn icon="grid" title="그리드" />
              <IconBtn icon="zoom-in" title="크게 보기" />
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
              <ImageTile seed={selectedItem.id} aspect="1/1" />
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
                <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
                  <SmallBtn icon="download">저장</SmallBtn>
                  <SmallBtn icon="copy">복사</SmallBtn>
                  <SmallBtn icon="refresh">재생성</SmallBtn>
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
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 12,
              }}
            >
              {genItems.map((it) => (
                <ImageTile
                  key={it.id}
                  seed={it.id}
                  label={it.label}
                  onClick={() => selectItem(it.id)}
                  style={{
                    border:
                      selectedId === it.id
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                    transition: "transform .15s",
                    boxShadow:
                      selectedId === it.id
                        ? "0 0 0 4px rgba(74,158,255,.15)"
                        : "none",
                  }}
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
  lightning,
  steps,
  cfg,
  seed,
  onAspect,
  onLightning,
  onSteps,
  onCfg,
  onSeed,
}: {
  aspect: AspectRatioLabel;
  sizeLabel: string;
  lightning: boolean;
  steps: number;
  cfg: number;
  seed: number;
  onAspect: (v: AspectRatioLabel) => void;
  onLightning: (v: boolean) => void;
  onSteps: (v: number) => void;
  onCfg: (v: number) => void;
  onSeed: (v: number) => void;
}) {
  const [open, setOpen] = useState(false);
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
          <Field label={`종횡비 · ${sizeLabel}`}>
            <SegControl
              options={ASPECT_RATIOS.map((r) => ({
                label: r.label,
                value: r.label,
              }))}
              value={aspect}
              onChange={(v) => onAspect(v as AspectRatioLabel)}
            />
          </Field>
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
