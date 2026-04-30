/**
 * PromptHistoryPeek - 프롬프트 히스토리 메뉴.
 *
 * 2026-04-30 (Phase 1 Task 0 · plan 2026-04-30-prompt-snippets-library.md):
 * 모든 모드의 canonical source = usePromptHistoryStore 단일화.
 * 옛 useHistoryStore.items 의존 제거 — pipeline hook 들이 submit 시 add 호출.
 *
 * 동작:
 *  - 프롬프트 입력창 우상단 📜 트리거 → 클릭 시 패널 펼침 (외부 클릭 자동 닫기 · Task 2)
 *  - 리스트: usePromptHistoryStore.entries 에서 mode 로 필터 + dedupe + 최근 20개
 *  - 각 행: prompt 원문 클램프 + 상대 시간 + [복사] + [사용] + [X] 삭제 (Task 2)
 *  - 빈 상태 안내 + [전체 비우기] (Task 2)
 */

"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import Icon from "@/components/ui/Icon";
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
const ENTER_DELAY = 150;
const LEAVE_DELAY = 300;

interface PromptPeekItem {
  id: string;
  prompt: string;
  createdAt: number;
}

export default function PromptHistoryPeek({
  mode,
  onSelect,
  align = "right",
}: Props) {
  const promptEntries = usePromptHistoryStore((s) => s.entries);
  const [open, setOpen] = useState(false);
  // hover 타이머 (Task 2 에서 클릭 + 외부클릭 패턴으로 교체 예정)
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // mode 별 prompt 추출 + dedupe (최신 우선) — 단일 source.
  const prompts = useMemo(() => {
    const seen = new Set<string>();
    const out: PromptPeekItem[] = [];
    for (const e of promptEntries) {
      if (e.mode !== mode) continue;
      const key = e.prompt.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: e.id,
        prompt: e.prompt,
        createdAt: e.createdAt,
      });
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }, [promptEntries, mode]);

  const scheduleOpen = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (open) return;
    enterTimer.current = setTimeout(() => setOpen(true), ENTER_DELAY);
  };

  const scheduleClose = () => {
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    if (!open) return;
    leaveTimer.current = setTimeout(() => setOpen(false), LEAVE_DELAY);
  };

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

  const alignRight = align === "right";

  return (
    <div
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      style={{
        position: "absolute",
        top: 6,
        [alignRight ? "right" : "left"]: 6,
        zIndex: 5,
      }}
    >
      {/* 트리거 아이콘 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`이전 ${MODE_LABEL[mode]} 프롬프트 (${prompts.length}개)`}
        style={{
          all: "unset",
          cursor: "pointer",
          width: 26,
          height: 26,
          borderRadius: "var(--radius-sm)",
          display: "grid",
          placeItems: "center",
          background: open ? "var(--accent)" : "var(--surface)",
          color: open ? "#fff" : "var(--ink-3)",
          border: "1px solid var(--line)",
          transition: "background .15s, color .15s, transform .18s",
          transform: open ? "scale(1.05)" : "scale(1)",
          boxShadow: open ? "0 2px 8px rgba(74,158,255,.3)" : "none",
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
              [alignRight ? "right" : "left"]: 0,
              width: 340,
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
                {prompts.length}
              </span>
            </div>

            {prompts.length === 0 ? (
              <div
                style={{
                  padding: "18px 14px",
                  color: "var(--ink-4)",
                  fontSize: 12,
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                아직 저장된 {MODE_LABEL[mode]} 프롬프트가 없습니다.
              </div>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: "4px 0",
                  overflowY: "auto",
                  flex: 1,
                }}
              >
                {prompts.map((it) => (
                  <PeekRow
                    key={it.id}
                    item={it}
                    onCopy={() => handleCopy(it.prompt)}
                    onSelect={() => handleSelect(it.prompt)}
                  />
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── 개별 행 ── */
function PeekRow({
  item,
  onCopy,
  onSelect,
}: {
  item: PromptPeekItem;
  onCopy: () => void;
  onSelect: () => void;
}) {
  const [rowHover, setRowHover] = useState(false);
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
          gap: 4,
          opacity: rowHover ? 1 : 0.35,
          transition: "opacity .12s",
        }}
      >
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
      </div>
    </li>
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
        width: 24,
        height: 24,
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
