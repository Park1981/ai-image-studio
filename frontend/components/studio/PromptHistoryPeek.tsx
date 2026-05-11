/**
 * PromptHistoryPeek - 프롬프트 히스토리 메뉴.
 *
 * 2026-04-30 (Phase 1 · plan 2026-04-30-prompt-snippets-library.md):
 *  - Task 0: 모든 모드의 canonical source = usePromptHistoryStore 단일화
 *  - Task 2: 호버 → 클릭 트리거 + 외부 클릭 자동 닫기 + 각 row [X] + [전체 비우기]
 *
 * 동작:
 *  - 프롬프트 입력창 우상단 📜 트리거 → 클릭 시 패널 toggle
 *  - 패널 외부 클릭 → 자동 닫기
 *  - 리스트: DB 즐겨찾기 상단 + usePromptHistoryStore.entries 최근 prompt
 *  - 각 행: prompt 클램프 + 상대 시간 + [별] + [복사] + [사용] + [X]
 *  - 빈 상태 안내 + 하단 [최근 비우기] (즐겨찾기는 유지)
 */

"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
import {
  promptFavoriteKey,
  usePromptFavoritesStore,
} from "@/stores/usePromptFavoritesStore";
import {
  usePromptHistoryStore,
  type PromptHistoryMode,
} from "@/stores/usePromptHistoryStore";
import { toast } from "@/stores/useToastStore";

interface Props {
  mode: PromptHistoryMode;
  /** 프롬프트 선택 시 호출 — 입력창에 주입 */
  onSelect: (prompt: string) => void;
  /** 패널 정렬. "right" = 트리거 오른쪽 끝 기준 (기본). "left" = 왼쪽 끝 기준. */
  align?: "left" | "right";
}

const MODE_LABEL: Record<Props["mode"], string> = {
  generate: "생성",
  edit: "수정",
  video: "영상",
  compare: "비교",
};

const MAX_ITEMS = 20;
const PEEK_PANEL_WIDTH = 380;
const PEEK_PANEL_RIGHT_NUDGE = -30;

interface PromptPeekItem {
  id: string;
  prompt: string;
  createdAt: number;
  favoriteId?: string;
  isFavorite: boolean;
}

export default function PromptHistoryPeek({
  mode,
  onSelect,
  align = "right",
}: Props) {
  const promptEntries = usePromptHistoryStore((s) => s.entries);
  const removeOne = usePromptHistoryStore((s) => s.removeOne);
  const clearMode = usePromptHistoryStore((s) => s.clearMode);
  const favoriteEntries = usePromptFavoritesStore((s) => s.entries);
  const hydrateFavorites = usePromptFavoritesStore((s) => s.hydrate);
  const toggleFavorite = usePromptFavoritesStore((s) => s.toggle);
  const [open, setOpen] = useState(false);
  const [triggerHover, setTriggerHover] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void hydrateFavorites().catch(() => {
      toast.warn("즐겨찾기 불러오기 실패", "백엔드 상태를 확인해줘.");
    });
  }, [open, hydrateFavorites]);

  const favoriteByPrompt = useMemo(() => {
    const map = new Map<string, (typeof favoriteEntries)[number]>();
    for (const e of favoriteEntries) {
      map.set(promptFavoriteKey(e.mode, e.prompt), e);
    }
    return map;
  }, [favoriteEntries]);

  const favoritePrompts = useMemo<PromptPeekItem[]>(() => {
    return favoriteEntries
      .filter((e) => e.mode === mode)
      .map((e) => ({
        id: `fav-row-${e.id}`,
        prompt: e.prompt,
        createdAt: e.updatedAt,
        favoriteId: e.id,
        isFavorite: true,
      }));
  }, [favoriteEntries, mode]);

  // mode 별 prompt 추출 + dedupe (최신 우선) — 단일 source.
  const recentPrompts = useMemo(() => {
    const seen = new Set<string>();
    const out: PromptPeekItem[] = [];
    for (const e of promptEntries) {
      if (e.mode !== mode) continue;
      const key = e.prompt.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const favorite = favoriteByPrompt.get(promptFavoriteKey(mode, key));
      if (favorite) continue;
      out.push({
        id: e.id,
        prompt: e.prompt,
        createdAt: e.createdAt,
        isFavorite: false,
      });
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }, [promptEntries, mode, favoriteByPrompt]);

  const visibleCount = favoritePrompts.length + recentPrompts.length;

  // 외부 클릭 → 패널 자동 닫기 (Task 2)
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  const handleCopy = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.info("프롬프트 복사됨", prompt.slice(0, 40));
    } catch {
      toast.warn("복사 실패", "브라우저 권한 확인");
    }
  };

  const handleSelect = (prompt: string) => {
    onSelect(prompt);
    setOpen(false);
    toast.info("프롬프트 적용", prompt.slice(0, 40));
  };

  const handleToggleFavorite = async (prompt: string) => {
    try {
      const active = await toggleFavorite(mode, prompt);
      toast.info(
        active ? "즐겨찾기 저장" : "즐겨찾기 해제",
        prompt.slice(0, 40),
      );
    } catch {
      toast.warn("즐겨찾기 변경 실패", "백엔드 상태를 확인해줘.");
    }
  };

  const handleClearAll = () => {
    if (
      typeof window !== "undefined" &&
      window.confirm(
        `${MODE_LABEL[mode]} 최근 프롬프트를 비울까요? 즐겨찾기는 유지돼요.`,
      )
    ) {
      clearMode(mode);
      setOpen(false);
    }
  };

  const alignRight = align === "right";

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        top: 10,
        [alignRight ? "right" : "left"]: 10,
        zIndex: open ? 8 : 5,
      }}
    >
      {/* 트리거 아이콘 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setTriggerHover(true)}
        onMouseLeave={() => setTriggerHover(false)}
        title={`이전 ${MODE_LABEL[mode]} 프롬프트 (${visibleCount}개)`}
        style={{
          all: "unset",
          cursor: "pointer",
          width: 26,
          height: 26,
          borderRadius: "var(--radius-sm)",
          display: "grid",
          placeItems: "center",
          background: open
            ? "var(--accent)"
            : triggerHover
              ? "var(--bg-2)"
              : "var(--surface)",
          color: open ? "#fff" : triggerHover ? "var(--ink-2)" : "var(--ink-3)",
          border: `1px solid ${
            open ? "var(--accent-ink)" : triggerHover ? "var(--line-2)" : "var(--line)"
          }`,
          transition:
            "background .15s, color .15s, border-color .15s, box-shadow .15s, transform .18s",
          transform: open
            ? "scale(1.05)"
            : triggerHover
              ? "translateY(-1px)"
              : "scale(1)",
          boxShadow: open
            ? "0 2px 8px rgba(74,158,255,.3)"
            : triggerHover
              ? "0 2px 8px rgba(0,0,0,.08)"
              : "none",
        }}
      >
        <Icon name="clock" size={13} />
      </button>

      {/* 패널 */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="peek-panel"
            initial={{ opacity: 0, y: -12, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{
              type: "spring",
              stiffness: 380,
              damping: 22,
              mass: 0.7,
            }}
            style={{
              position: "absolute",
              top: 34,
              [alignRight ? "right" : "left"]: alignRight
                ? PEEK_PANEL_RIGHT_NUDGE
                : 0,
              width: PEEK_PANEL_WIDTH,
              maxHeight: 360,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-lg)",
              transformOrigin:
                alignRight ? "top right" : "top left",
            }}
          >
            <div
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "var(--bg-2)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: ".06em",
                  color: "var(--ink-3)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Icon name="clock" size={11} />
                이전 프롬프트
              </div>
              <span
                className="mono"
                style={{ fontSize: 10, color: "var(--ink-4)" }}
              >
                {visibleCount}
              </span>
            </div>

            {visibleCount === 0 ? (
              <div
                style={{
                  padding: "20px 16px",
                  color: "var(--ink-4)",
                  fontSize: 12,
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                저장된 {MODE_LABEL[mode]} 프롬프트가 없어요.
              </div>
            ) : (
              <>
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: "4px 0",
                    overflowY: "auto",
                    flex: 1,
                  }}
                >
                  {favoritePrompts.length > 0 && (
                    <PeekSectionLabel label="즐겨찾기" />
                  )}
                  {favoritePrompts.map((it) => (
                    <PeekRow
                      key={it.id}
                      item={it}
                      onCopy={() => handleCopy(it.prompt)}
                      onSelect={() => handleSelect(it.prompt)}
                      onToggleFavorite={() => handleToggleFavorite(it.prompt)}
                      onRemove={() => {
                        if (it.favoriteId) {
                          void handleToggleFavorite(it.prompt);
                        }
                      }}
                    />
                  ))}
                  {favoritePrompts.length > 0 && recentPrompts.length > 0 && (
                    <PeekSectionLabel label="최근 프롬프트" />
                  )}
                  {recentPrompts.map((it) => (
                    <PeekRow
                      key={it.id}
                      item={it}
                      onCopy={() => handleCopy(it.prompt)}
                      onSelect={() => handleSelect(it.prompt)}
                      onToggleFavorite={() => handleToggleFavorite(it.prompt)}
                      onRemove={() => removeOne(it.id)}
                    />
                  ))}
                </ul>
                <div
                  style={{
                    borderTop: "1px solid var(--line)",
                    padding: "8px 12px",
                    display: "flex",
                    justifyContent: "flex-end",
                    background: "var(--bg-2)",
                  }}
                >
                  <button
                    type="button"
                    onClick={handleClearAll}
                    style={{
                      all: "unset",
                      cursor: "pointer",
                      fontSize: 11,
                      color: "var(--ink-4)",
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    최근 비우기
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PeekSectionLabel({ label }: { label: string }) {
  return (
    <li
      style={{
        padding: "8px 12px 4px",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: ".08em",
        color: "var(--ink-4)",
      }}
    >
      {label}
    </li>
  );
}

/* ── 개별 행 ── */
function PeekRow({
  item,
  onCopy,
  onSelect,
  onToggleFavorite,
  onRemove,
}: {
  item: PromptPeekItem;
  onCopy: () => void;
  onSelect: () => void;
  onToggleFavorite: () => Promise<void>;
  onRemove: () => void;
}) {
  const [rowHover, setRowHover] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  return (
    <li
      onMouseEnter={() => setRowHover(true)}
      onMouseLeave={() => setRowHover(false)}
      style={{
        padding: "8px 12px",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 8,
        alignItems: "center",
        background: rowHover ? "var(--bg-2)" : "transparent",
        cursor: "pointer",
        transition: "background .12s",
      }}
      onClick={onSelect}
      title="클릭하면 프롬프트 입력창에 적용"
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 12,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.4,
          }}
        >
          {item.prompt}
        </div>
        <div
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--ink-4)",
            marginTop: 2,
            letterSpacing: ".03em",
          }}
        >
          {formatRelativeTime(item.createdAt)}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          gap: 2,
          opacity: rowHover ? 1 : 0.45,
          transition: "opacity .12s",
        }}
      >
        <StarBtn
          active={item.isFavorite}
          disabled={favoritePending}
          onClick={async (e) => {
            e.stopPropagation();
            if (favoritePending) return;
            setFavoritePending(true);
            try {
              await onToggleFavorite();
            } finally {
              setFavoritePending(false);
            }
          }}
        />
        <IconBtn
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          title="복사"
          iconName="copy"
        />
        <IconBtn
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          title="이 프롬프트 사용"
          iconName="arrow-right"
          accent
        />
        <RemoveBtn
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        />
      </div>
    </li>
  );
}

function StarBtn({
  active,
  disabled,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  onClick: (e: React.MouseEvent) => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? "즐겨찾기 해제" : "즐겨찾기 저장"}
      title={active ? "즐겨찾기 해제" : "즐겨찾기 저장"}
      disabled={disabled}
      style={{
        all: "unset",
        cursor: disabled ? "wait" : "pointer",
        width: 22,
        height: 22,
        borderRadius: "var(--radius-sm)",
        display: "grid",
        placeItems: "center",
        color: active ? "#d97706" : "var(--ink-4)",
        opacity: disabled ? 0.55 : 1,
        transition: "background .12s, color .12s, transform .12s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          active ? "rgba(217,119,6,.12)" : "var(--surface)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <Icon name="star" size={13} stroke={active ? 1.9 : 1.5} />
    </button>
  );
}

function IconBtn({
  onClick,
  title,
  iconName,
  accent = false,
}: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  iconName: "copy" | "arrow-right";
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        all: "unset",
        cursor: "pointer",
        width: 22,
        height: 22,
        borderRadius: "var(--radius-sm)",
        display: "grid",
        placeItems: "center",
        color: accent ? "var(--accent)" : "var(--ink-3)",
        transition: "background .12s, color .12s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--surface)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <Icon name={iconName} size={12} />
    </button>
  );
}

/* ── [X] 삭제 버튼 (Task 2) ── */
function RemoveBtn({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="이 프롬프트 삭제"
      title="삭제"
      style={{
        all: "unset",
        cursor: "pointer",
        width: 22,
        height: 22,
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--radius-sm)",
        color: "var(--ink-4)",
        transition: "background .12s, color .12s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "#b42318";
        (e.currentTarget as HTMLButtonElement).style.background =
          "rgba(239,68,68,.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-4)";
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <Icon name="x" size={12} />
    </button>
  );
}

/* ── 상대 시간 포맷 ── */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
