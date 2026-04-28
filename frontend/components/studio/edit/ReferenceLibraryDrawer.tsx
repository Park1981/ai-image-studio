/**
 * ReferenceLibraryDrawer — 저장된 reference templates 라이브러리 뷰어 (v8 plan).
 *
 * 사용 흐름:
 *  1. 저장된 templates grid 표시 (이름 + 썸네일 + role + 비전 description)
 *  2. 클릭 → onPick(template) + drawer 닫음 + last_used_at 자동 갱신 (touch)
 *  3. 우측 [×] → 확인 모달 후 삭제
 *
 * 본 컴포넌트는 *살아있는* templates 만 보여주므로 onError 404 fallback 불필요.
 * 옛 history 행의 referenceRef 가 깨진 경우는 `BeforeAfterSlider` /
 * `ResultInfoModal` / `HistoryGallery` 쪽에서 별도 onError 처리 필요 (Task 6 보강).
 */

"use client";

import { useEffect, useState } from "react";

import {
  deleteReferenceTemplate,
  listReferenceTemplates,
  touchReferenceTemplate,
} from "@/lib/api/reference-templates";
import type { ReferenceTemplate } from "@/lib/api/types";
import { toast } from "@/stores/useToastStore";

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (template: ReferenceTemplate) => void;
}

export default function ReferenceLibraryDrawer({
  open,
  onClose,
  onPick,
}: Props) {
  const [templates, setTemplates] = useState<ReferenceTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list = await listReferenceTemplates();
      if (!cancelled) {
        setTemplates(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handlePick = (t: ReferenceTemplate) => {
    onPick(t);
    onClose();
    // 결과 무시 — 실패해도 UX 영향 0 (정렬만 약간 부정확해질 뿐)
    void touchReferenceTemplate(t.id);
  };

  const handleDelete = async (t: ReferenceTemplate) => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        `"${t.name}" 템플릿을 삭제할까요? (되돌릴 수 없음)`,
      );
      if (!ok) return;
    }
    const success = await deleteReferenceTemplate(t.id);
    if (!success) {
      toast.error("삭제 실패");
      return;
    }
    setTemplates((prev) => prev.filter((p) => p.id !== t.id));
    toast.success("템플릿 삭제됨");
  };

  if (!open) return null;

  return (
    <>
      {/* Overlay — 클릭하면 닫힘 */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(23,20,14,.32)",
          zIndex: 50,
        }}
      />
      {/* Drawer 본체 */}
      <aside
        role="dialog"
        aria-label="참조 템플릿 라이브러리"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          maxWidth: "100vw",
          background: "var(--bg)",
          borderLeft: "1px solid var(--line)",
          boxShadow: "var(--shadow-lg)",
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          padding: "20px 24px",
          gap: 14,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--ink)",
              margin: 0,
            }}
          >
            📂 참조 템플릿 라이브러리
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            style={{
              all: "unset",
              cursor: "pointer",
              fontSize: 18,
              color: "var(--ink-3)",
              padding: "4px 8px",
            }}
          >
            ×
          </button>
        </div>

        {loading && (
          <div style={{ fontSize: 12, color: "var(--ink-4)" }}>
            불러오는 중…
          </div>
        )}

        {!loading && templates.length === 0 && (
          <div
            style={{
              padding: "30px 20px",
              textAlign: "center",
              fontSize: 12.5,
              color: "var(--ink-4)",
              border: "1px dashed var(--line-2, var(--line))",
              borderRadius: "var(--radius)",
            }}
          >
            저장된 템플릿이 없어요.
            <br />
            참조 이미지 사용 시 &quot;템플릿으로 저장&quot; 으로 추가하세요.
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onPick={() => handlePick(t)}
              onDelete={() => handleDelete(t)}
            />
          ))}
        </div>
      </aside>
    </>
  );
}

function TemplateCard({
  template,
  onPick,
  onDelete,
}: {
  template: ReferenceTemplate;
  onPick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      style={{
        position: "relative",
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color .15s",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={template.imageRef}
        alt={template.name}
        style={{
          width: "100%",
          height: 140,
          objectFit: "cover",
          display: "block",
          background: "var(--bg-2)",
        }}
      />
      <div style={{ padding: "8px 10px" }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {template.name}
        </div>
        {template.roleDefault && (
          <div
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              marginTop: 2,
            }}
          >
            {template.roleDefault}
          </div>
        )}
        {template.visionDescription && (
          <div
            style={{
              fontSize: 10.5,
              color: "var(--ink-3)",
              marginTop: 4,
              lineHeight: 1.4,
              maxHeight: 28,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={template.visionDescription}
          >
            {template.visionDescription}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={`${template.name} 삭제`}
        title="삭제"
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(0,0,0,.55)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
          fontSize: 12,
          display: "grid",
          placeItems: "center",
        }}
      >
        ×
      </button>
    </div>
  );
}
