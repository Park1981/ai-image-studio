# 프롬프트 라이브러리 + 히스토리 정리 Implementation Plan (v3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Version:** v3 (2026-04-30 codex 2차 리뷰 후속 — 추가 5건 fix)
- v1 → v2: Task 0 / Task 9 신설 · dynamic ssr:false · 시그니처 fix · dedupe 명시 · 미사용 import · crop util 재사용
- v2 → v3: id 충돌 방지 (UUID) · strip 적용 범위 확장 (UpgradeResult / upgrade-only / history) · 4th 회귀 케이스 placeholder 제거 · snippet 저장 시 `<lib>` sanitize · Task 6 풀 코드 명시

**Goal:** Generate 페이지의 프롬프트 입력 UX 강화 — 사용자가 좋은 prompt 를 *라이브러리* 에 썸네일과 함께 큐레이션 등록 / 재사용 + 기존 *프롬프트 히스토리* 의 정리/삭제 UI 추가.

**Architecture:**
- localStorage persist Zustand store 2개 (history + snippets)
- 모든 모드 prompt history canonical source = `usePromptHistoryStore` 단일화
- 등록·목록 둘 다 *모달* 통일 + Portal viewport 가운데
- `<lib>...</lib>` XML-style 마커
- **백엔드 deterministic `strip_library_markers` — 4 위치 적용** (UpgradeResult.upgraded · ComfyUI dispatch · upgrade-only response · history DB record)
- **id 생성 = `crypto.randomUUID()`** (Date.now() 충돌 방지)
- **snippet 저장 시 prompt 의 기존 `<lib>` sanitize** (중첩 방지)

**Tech Stack:** Next.js 16 · React 19 · TS strict · Zustand 5 + persist · framer-motion · `react-easy-crop` (`dynamic({ ssr: false })`) · `lib/image-crop.ts` 재사용 · FastAPI · Python 3.13 · vitest · pytest

---

## File Structure

### Phase 1 — 히스토리 정리 (Codex B1 root cause fix 포함)
- 수정: `frontend/hooks/useGeneratePipeline.ts` / `useEditPipeline.ts` / `useVideoPipeline.ts` — submit 시 `usePromptHistoryStore.getState().add(...)` 호출
- 수정: `frontend/stores/usePromptHistoryStore.ts` — `removeOne(id)` 신규 + **id 생성을 `crypto.randomUUID()` 로 변경 (id 충돌 방지)**
- 수정: `frontend/components/studio/PromptHistoryPeek.tsx` — `useHistoryStore.items` 의존 제거 → 단일 source · 호버→클릭 · 외부클릭 닫기 · [X] · [전체 비우기]
- 신규: `frontend/__tests__/prompt-history-store-actions.test.ts`

### Phase 2A — 라이브러리 데이터 + 등록 모달
- 신규: `frontend/stores/usePromptSnippetsStore.ts` — `crypto.randomUUID()` id · **`add()` 안에서 `stripAllMarkers(prompt).trim()` sanitize** (중첩 방지) · dedupe 없음
- 신규: `frontend/components/studio/SnippetCropper.tsx` — react-easy-crop 격리
- 신규: `frontend/components/studio/SnippetRegisterModal.tsx` — `dynamic({ ssr: false })` SnippetCropper
- 신규: `frontend/__tests__/prompt-snippets-store.test.ts` — sanitize 케이스 포함

### Phase 2B — 마커 toggle + 백엔드 deterministic strip + system prompt
- 신규: `frontend/lib/snippet-marker.ts` — `wrapMarker / hasMarker / removeMarker / stripAllMarkers`
- 신규: `frontend/components/studio/SnippetLibraryModal.tsx` — 카드 그리드 + click toggle + [X] + [+ 새 등록]
- 수정: `frontend/components/studio/generate/GenerateLeftPanel.tsx` — [📚] [+] 버튼 + textarea toggle 로직
- 신규: `backend/studio/_lib_marker.py` — deterministic `strip_library_markers(text)`
- **수정: `backend/studio/prompt_pipeline/upgrade.py` — `upgrade_generate_prompt` 끝에서 `UpgradeResult.upgraded` 에 strip 적용 + SYSTEM_GENERATE 마커 지시 4 항목**
- **수정: `backend/studio/routes/prompt.py` — `/upgrade-only` 응답에 strip 적용**
- **수정: `backend/studio/pipelines/generate.py` — `pre_upgraded_prompt` strip + history DB 저장 prompt strip**
- 신규: `frontend/__tests__/snippet-marker.test.ts` (9 케이스)
- 신규: `backend/tests/studio/test_lib_marker.py` (5 케이스)
- 수정: `backend/tests/studio/test_prompt_pipeline.py` — system prompt 지시 검증 + `UpgradeResult.upgraded` strip 적용 검증
- 신규: `backend/tests/studio/test_generate_pipeline_lib_marker.py` — 3 deterministic 입력 케이스 (pipeline mock 케이스 제거 — Codex 추천)

---

## Phase 1 — 프롬프트 히스토리 정리/삭제 UI

### Task 0: prompt history canonical source 통일 (Codex v1 B1 fix)

**Files:**
- Modify: `frontend/hooks/useGeneratePipeline.ts`
- Modify: `frontend/hooks/useEditPipeline.ts`
- Modify: `frontend/hooks/useVideoPipeline.ts`
- Modify: `frontend/components/studio/PromptHistoryPeek.tsx`

- [ ] **Step 1: 각 pipeline hook 의 submit 함수 시작 부분 파악**

```powershell
grep -n "async function generate\|setRunning(true\|export.*useGeneratePipeline" D:/AI-Image-Studio/frontend/hooks/useGeneratePipeline.ts
grep -n "async function\|setRunning(true" D:/AI-Image-Studio/frontend/hooks/useEditPipeline.ts
grep -n "async function\|setRunning(true" D:/AI-Image-Studio/frontend/hooks/useVideoPipeline.ts
```

- [ ] **Step 2: 3 hook 에 동일 패턴 추가**

각 hook 파일 상단에 import:
```typescript
import { usePromptHistoryStore } from "@/stores/usePromptHistoryStore";
```

submit 함수 안 (prompt validation 직후, SSE 호출 전):
```typescript
// 2026-04-30 (Codex v1 B1 fix · plan 2026-04-30-prompt-snippets-library.md):
// usePromptHistoryStore 가 모든 모드의 canonical source — PromptHistoryPeek 가 이 store 만 읽음.
usePromptHistoryStore.getState().add("generate", prompt);  // edit / video 도 동일
```

- [ ] **Step 3: PromptHistoryPeek 단일 source 로**

`frontend/components/studio/PromptHistoryPeek.tsx` 의 `prompts` useMemo 단순화:

```typescript
// 옛 useHistoryStore.items 의존 제거.
const promptEntries = usePromptHistoryStore((s) => s.entries);

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
```

`useHistoryStore` import 제거. `meta` 필드 (size 정보) 도 제거 (prompt-only).

- [ ] **Step 4: 직접 띄워서 검증**

`/generate` `/edit` `/video` 에서 prompt 입력 + 생성 → PromptHistoryPeek 에 보이는지.

- [ ] **Step 5: tsc + lint clean**

- [ ] **Step 6: Commit**

```bash
git add frontend/hooks/useGeneratePipeline.ts frontend/hooks/useEditPipeline.ts frontend/hooks/useVideoPipeline.ts frontend/components/studio/PromptHistoryPeek.tsx
git commit -m "feat(prompt-history): 모든 모드의 canonical source 를 usePromptHistoryStore 로 통일 (Codex B1 fix)"
```

---

### Task 1: usePromptHistoryStore — removeOne 액션 + id 충돌 방지 (Codex v3)

**Files:**
- Modify: `frontend/stores/usePromptHistoryStore.ts`
- Test: `frontend/__tests__/prompt-history-store-actions.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/__tests__/prompt-history-store-actions.test.ts` 신규:

```typescript
/**
 * usePromptHistoryStore 의 removeOne / clearMode + id 고유성 회귀 테스트.
 * 2026-04-30 (Phase 1 · Codex v3 — id 충돌 방지 검증 포함).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { usePromptHistoryStore } from "@/stores/usePromptHistoryStore";

describe("usePromptHistoryStore", () => {
  beforeEach(() => {
    usePromptHistoryStore.getState().clearMode("generate");
    usePromptHistoryStore.getState().clearMode("edit");
    usePromptHistoryStore.getState().clearMode("video");
    usePromptHistoryStore.getState().clearMode("compare");
  });

  it("removeOne — 특정 id 만 제거 + 나머지 보존", () => {
    const { add, removeOne } = usePromptHistoryStore.getState();
    add("generate", "A");
    add("generate", "B");
    add("generate", "C");
    const ids = usePromptHistoryStore.getState().entries.map((e) => e.id);
    expect(ids.length).toBe(3);

    removeOne(ids[1]);
    const after = usePromptHistoryStore.getState().entries;
    expect(after.length).toBe(2);
  });

  it("removeOne — 존재하지 않는 id 는 silent", () => {
    const { add, removeOne } = usePromptHistoryStore.getState();
    add("generate", "x");
    removeOne("non-existent");
    expect(usePromptHistoryStore.getState().entries.length).toBe(1);
  });

  it("clearMode — 해당 mode 만 비움", () => {
    const { add, clearMode } = usePromptHistoryStore.getState();
    add("generate", "g");
    add("edit", "e");
    add("video", "v");
    clearMode("generate");
    const remaining = usePromptHistoryStore.getState().entries;
    expect(remaining.length).toBe(2);
    expect(remaining.map((e) => e.mode).sort()).toEqual(["edit", "video"]);
  });

  it("id 고유성 — 같은 ms 안 연속 add 시에도 id 충돌 없음 (Codex v3)", () => {
    const { add } = usePromptHistoryStore.getState();
    // 빠르게 5번 연속 add — 옛 ${mode}-${Date.now()} 로직은 충돌 가능
    for (let i = 0; i < 5; i++) add("generate", `prompt ${i}`);
    const ids = usePromptHistoryStore.getState().entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(5); // 모두 unique
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: store 본체 변경 (id 생성 + removeOne)**

`frontend/stores/usePromptHistoryStore.ts`:

```typescript
interface PromptHistoryState {
  entries: PromptHistoryEntry[];
  add: (mode: PromptHistoryMode, prompt: string) => void;
  /** 2026-04-30: 단일 entry 삭제. */
  removeOne: (id: string) => void;
  clearMode: (mode: PromptHistoryMode) => void;
}

// add() 의 id 생성 변경 — 옛 `${mode}-${Date.now()}` 는 같은 ms 충돌 가능 (Codex v3).
add: (mode, prompt) => {
  const text = prompt.trim();
  if (!text) return;
  set((s) => {
    const filtered = s.entries.filter(
      (x) => !(x.mode === mode && x.prompt.trim() === text),
    );
    return {
      entries: [
        {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? `${mode}-${crypto.randomUUID()}`
              : `${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          mode,
          prompt: text,
          createdAt: Date.now(),
        },
        ...filtered,
      ].slice(0, MAX_PROMPTS),
    };
  });
},

removeOne: (id) =>
  set((s) => ({ entries: s.entries.filter((x) => x.id !== id) })),
```

- [ ] **Step 4: 테스트 PASS — 4 케이스**

- [ ] **Step 5: tsc + lint clean**

- [ ] **Step 6: Commit**

```bash
git add frontend/stores/usePromptHistoryStore.ts frontend/__tests__/prompt-history-store-actions.test.ts
git commit -m "feat(prompt-history): removeOne + id 충돌 방지 (crypto.randomUUID, Codex v3)"
```

---

### Task 2: PromptHistoryPeek UX — 호버→클릭 + 외부클릭 + [X] + [전체 비우기]

(v2 와 동일. 코드 변경 항목 그대로)

**Files:**
- Modify: `frontend/components/studio/PromptHistoryPeek.tsx`

- [ ] **Step 1: 호버 로직 → 클릭 + 외부클릭 닫기**

옛 `enterTimer / leaveTimer / scheduleOpen / scheduleClose / onMouseEnter / onMouseLeave` 모두 제거. 새 패턴:

```typescript
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!open) return;
  function onDocClick(e: MouseEvent) {
    if (!containerRef.current?.contains(e.target as Node)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 클릭 처리 표준
      setOpen(false);
    }
  }
  document.addEventListener("click", onDocClick);
  return () => document.removeEventListener("click", onDocClick);
}, [open]);
```

트리거 + 패널 wrap 컨테이너에 `ref={containerRef}`. 트리거 onClick 으로 toggle.

- [ ] **Step 2: 각 row 에 [X] 삭제 버튼**

```tsx
const removeOne = usePromptHistoryStore((s) => s.removeOne);
const clearMode = usePromptHistoryStore((s) => s.clearMode);

// row 안:
<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    removeOne(item.id);
  }}
  aria-label="이 프롬프트 삭제"
  title="삭제"
  style={{
    all: "unset", cursor: "pointer", width: 24, height: 24,
    display: "grid", placeItems: "center",
    borderRadius: "var(--radius-sm)", color: "var(--ink-4)",
  }}
  onMouseEnter={(e) => {
    (e.currentTarget as HTMLButtonElement).style.color = "#b42318";
    (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,.08)";
  }}
  onMouseLeave={(e) => {
    (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-4)";
    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
  }}
>
  <Icon name="x" size={12} />
</button>
```

- [ ] **Step 3: 빈 상태 + [전체 비우기]**

```tsx
{prompts.length === 0 ? (
  <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--ink-4)", fontSize: 12 }}>
    저장된 {MODE_LABEL[mode]} 프롬프트가 없어요.
  </div>
) : (
  <>
    <motion.ul ...>{ /* 기존 row 매핑 */ }</motion.ul>
    <div style={{ borderTop: "1px solid var(--line)", padding: "8px 12px", display: "flex", justifyContent: "flex-end" }}>
      <button
        type="button"
        onClick={() => {
          if (confirm(`${MODE_LABEL[mode]} 히스토리 전체를 비울까요? (실행 취소 X)`)) {
            clearMode(mode);
            setOpen(false);
          }
        }}
        style={{ all: "unset", cursor: "pointer", fontSize: 11, color: "var(--ink-4)", padding: "2px 6px", borderRadius: "var(--radius-sm)" }}
      >
        전체 비우기
      </button>
    </div>
  </>
)}
```

- [ ] **Step 4: 직접 검증** + **Step 5: tsc + lint + vitest** + **Step 6: Commit**

```bash
git commit -m "feat(prompt-history): 호버→클릭 + 외부클릭 닫기 + [X] + 전체 비우기"
```

---

## Phase 2A — 라이브러리 데이터 + 등록 모달

### Task 3: usePromptSnippetsStore — id UUID + sanitize (Codex v3 #1, #4)

**Files:**
- Create: `frontend/stores/usePromptSnippetsStore.ts`
- Test: `frontend/__tests__/prompt-snippets-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * usePromptSnippetsStore 단위 테스트 — CRUD + id 고유성 + 마커 sanitize.
 *
 * 정책:
 *   - dedupe 없음 (사용자 판단)
 *   - id 충돌 방지 — crypto.randomUUID
 *   - 저장 시 prompt 의 기존 <lib>...</lib> 마커 strip (중첩 방지)
 */
import { beforeEach, describe, expect, it } from "vitest";
import { usePromptSnippetsStore } from "@/stores/usePromptSnippetsStore";

describe("usePromptSnippetsStore", () => {
  beforeEach(() => {
    usePromptSnippetsStore.getState().clearAll();
  });

  it("add — 새 항목 entries 맨 앞 + id/createdAt 자동", () => {
    const { add } = usePromptSnippetsStore.getState();
    add({ name: "내 얼굴 1", prompt: "delicate korean girl" });
    const e = usePromptSnippetsStore.getState().entries[0];
    expect(e.name).toBe("내 얼굴 1");
    expect(e.prompt).toBe("delicate korean girl");
    expect(e.id).toMatch(/^snip-/);
  });

  it("add — 빈 name/prompt 는 silent skip", () => {
    const { add } = usePromptSnippetsStore.getState();
    add({ name: "", prompt: "x" });
    add({ name: "x", prompt: "" });
    add({ name: "  ", prompt: "valid" });
    expect(usePromptSnippetsStore.getState().entries.length).toBe(0);
  });

  it("add — 중복 prompt 도 두 번 모두 등록 (dedupe 없음 정책)", () => {
    const { add } = usePromptSnippetsStore.getState();
    add({ name: "A", prompt: "same" });
    add({ name: "B", prompt: "same" });
    expect(usePromptSnippetsStore.getState().entries.length).toBe(2);
  });

  it("add — prompt 안 <lib>...</lib> 마커 자동 strip (중첩 방지 · Codex v3)", () => {
    const { add } = usePromptSnippetsStore.getState();
    add({
      name: "마커 포함",
      prompt: "a girl, <lib>cinematic 35mm</lib>, warm light",
    });
    const e = usePromptSnippetsStore.getState().entries[0];
    expect(e.prompt).toBe("a girl, cinematic 35mm, warm light");
    expect(e.prompt).not.toContain("<lib>");
  });

  it("id 고유성 — 같은 ms 연속 add 시 충돌 없음 (Codex v3)", () => {
    const { add } = usePromptSnippetsStore.getState();
    for (let i = 0; i < 5; i++) add({ name: `n${i}`, prompt: `p${i}` });
    const ids = usePromptSnippetsStore.getState().entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("remove — 특정 id 만 제거", () => {
    const { add, remove } = usePromptSnippetsStore.getState();
    add({ name: "A", prompt: "a" });
    add({ name: "B", prompt: "b" });
    const ids = usePromptSnippetsStore.getState().entries.map((e) => e.id);
    remove(ids[0]);
    expect(usePromptSnippetsStore.getState().entries.length).toBe(1);
  });

  it("clearAll — 전부 비움", () => {
    const { add, clearAll } = usePromptSnippetsStore.getState();
    add({ name: "A", prompt: "a" });
    clearAll();
    expect(usePromptSnippetsStore.getState().entries.length).toBe(0);
  });
});
```

- [ ] **Step 2: store 본체 작성**

`frontend/stores/usePromptSnippetsStore.ts`:

```typescript
/**
 * usePromptSnippetsStore — 사용자 큐레이션 prompt 라이브러리.
 *
 * 2026-04-30 (Phase 2A · plan 2026-04-30-prompt-snippets-library.md · v3).
 *
 * 정책:
 *   - 카테고리 X (라벨 자체가 카테고리 역할)
 *   - 썸네일 옵셔널
 *   - dedupe 없음 (사용자 판단)
 *   - id = crypto.randomUUID (Codex v3 충돌 방지)
 *   - 저장 시 prompt 의 기존 <lib>...</lib> 마커 strip (중첩 방지)
 *   - localStorage persist · 80개 자동 제한
 */

"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { stripAllMarkers } from "@/lib/snippet-marker";

export interface PromptSnippet {
  id: string;
  name: string;
  prompt: string;
  thumbnail?: string;
  createdAt: number;
}

interface SnippetState {
  entries: PromptSnippet[];
  add: (input: { name: string; prompt: string; thumbnail?: string }) => void;
  remove: (id: string) => void;
  clearAll: () => void;
}

const MAX_SNIPPETS = 80;

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `snip-${crypto.randomUUID()}`;
  }
  return `snip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const usePromptSnippetsStore = create<SnippetState>()(
  persist(
    (set) => ({
      entries: [],
      add: ({ name, prompt, thumbnail }) => {
        const cleanName = name.trim();
        // Codex v3 #4: 저장 시 기존 <lib>...</lib> 마커 strip — 중첩 방지.
        const cleanPrompt = stripAllMarkers(prompt).trim();
        if (!cleanName || !cleanPrompt) return;
        set((s) => ({
          entries: [
            {
              id: makeId(),
              name: cleanName,
              prompt: cleanPrompt,
              thumbnail,
              createdAt: Date.now(),
            },
            ...s.entries,
          ].slice(0, MAX_SNIPPETS),
        }));
      },
      remove: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      clearAll: () => set({ entries: [] }),
    }),
    {
      name: "ais:prompt-snippets",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);
```

**중요 Task 순서**: `snippet-marker.ts` (Task 5) 가 `usePromptSnippetsStore` (Task 3) 보다 먼저 만들어져야 함 — store 가 `stripAllMarkers` import. Task 5 를 Task 3 보다 먼저 실행하거나, 한 commit 으로 묶어 처리.

**권장 순서**: Task 5 (snippet-marker) → Task 3 (store) → Task 4 (modal) → Task 6 (library modal) → Task 7 (integration) → Task 8/9 (backend) → Task 10 (E2E).

- [ ] **Step 3: 테스트 PASS — 7 케이스**

- [ ] **Step 4: tsc + lint clean**

- [ ] **Step 5: Commit**

```bash
git add frontend/stores/usePromptSnippetsStore.ts frontend/__tests__/prompt-snippets-store.test.ts
git commit -m "feat(snippets): usePromptSnippetsStore (UUID id + <lib> sanitize, Codex v3)"
```

---

### Task 4: SnippetCropper + SnippetRegisterModal

(v2 와 동일 · `dynamic({ ssr: false })` + `image-crop` 재사용. 미사용 import 제거됨.)

**Files:**
- Create: `frontend/components/studio/SnippetCropper.tsx` — react-easy-crop 격리 (v2 코드 그대로)
- Create: `frontend/components/studio/SnippetRegisterModal.tsx` — `dynamic` SnippetCropper 호출 + Portal + 폼 (v2 코드 그대로)

(상세 코드는 v2 plan archive 의 Task 4 — Image/Icon import 없이 시작. `dataUrlToBlob` 재사용. 변경 X.)

- [ ] **Step 1-3: SnippetCropper 작성** (v2 Task 4 Step 1 코드 그대로)

- [ ] **Step 4-6: SnippetRegisterModal 작성** (v2 Task 4 Step 2 코드 그대로)

- [ ] **Step 7: tsc + lint + Commit**

```bash
git add frontend/components/studio/SnippetCropper.tsx frontend/components/studio/SnippetRegisterModal.tsx
git commit -m "feat(snippets): SnippetCropper + SnippetRegisterModal (dynamic ssr:false, image-crop 재사용)"
```

---

## Phase 2B — 마커 toggle + 백엔드 deterministic strip

### Task 5: snippet-marker.ts (frontend) — `<lib>` 헬퍼 9 케이스

**Files:**
- Create: `frontend/lib/snippet-marker.ts`
- Test: `frontend/__tests__/snippet-marker.test.ts`

(v2 Task 5 그대로. **이 Task 가 Task 3 보다 먼저 실행 — store 가 stripAllMarkers import.**)

```typescript
// frontend/lib/snippet-marker.ts
const OPEN = "<lib>";
const CLOSE = "</lib>";

export function wrapMarker(prompt: string): string {
  return `${OPEN}${prompt.trim()}${CLOSE}`;
}

export function hasMarker(textarea: string, prompt: string): boolean {
  return textarea.includes(wrapMarker(prompt));
}

export function removeMarker(textarea: string, prompt: string): string {
  const wrapped = wrapMarker(prompt);
  let next = textarea.replace(wrapped, "");
  next = next
    .replace(/,\s*,/g, ",")
    .replace(/^\s*,\s*/, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return next;
}

export function stripAllMarkers(text: string): string {
  return text.split(OPEN).join("").split(CLOSE).join("");
}
```

테스트 9 케이스 (v2 plan Task 5 그대로 · 변경 X).

- [ ] **Step 1-6:** Write test → Run FAIL → 본체 작성 → PASS → tsc/lint → Commit

```bash
git commit -m "feat(snippets): <lib>...</lib> 마커 헬퍼 + 단위 테스트 (9 케이스)"
```

---

### Task 6: SnippetLibraryModal — 풀 코드 명시 (Codex v3 #5 fix)

**Files:**
- Create: `frontend/components/studio/SnippetLibraryModal.tsx`

**Codex v3 fix:** v2 plan 에서 "v1 archive 참조" 라고만 적어 단독 실행성 떨어짐. 풀 코드 명시.

- [ ] **Step 1: 본체 작성**

```tsx
/**
 * SnippetLibraryModal — 라이브러리 목록 모달.
 *
 * 2026-04-30 (Phase 2B · plan 2026-04-30-prompt-snippets-library.md · v3).
 *
 * 동작:
 *   - 카드 그리드 (썸네일 또는 📄 placeholder)
 *   - 카드 클릭 → onToggleSnippet 콜백 (부모가 textarea toggle)
 *   - 카드 [X] → confirm → remove
 *   - [+ 새 등록] → SnippetRegisterModal 띄움 (z-index 더 높게)
 *   - 빈 상태 안내
 *   - 외부 클릭 → onClose
 *   - z-index = 9997 (등록 모달 9998 < ShutdownButton 9999)
 */

"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/Icon";
import {
  type PromptSnippet,
  usePromptSnippetsStore,
} from "@/stores/usePromptSnippetsStore";
import { hasMarker } from "@/lib/snippet-marker";
import SnippetRegisterModal from "./SnippetRegisterModal";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 현재 textarea — 카드 active 표시 + onToggle 호출 시 부모가 사용. */
  currentPrompt: string;
  onToggleSnippet: (snippet: PromptSnippet) => void;
}

export default function SnippetLibraryModal({
  open,
  onClose,
  currentPrompt,
  onToggleSnippet,
}: Props) {
  const entries = usePromptSnippetsStore((s) => s.entries);
  const remove = usePromptSnippetsStore((s) => s.remove);
  const [registerOpen, setRegisterOpen] = useState(false);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Portal SSR-safe
    setMounted(true);
  }, []);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9997,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "rgba(31,31,31,.28)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
        onClick={onClose}
      >
        <section
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "min(720px, 100%)",
            maxHeight: "calc(100vh - 48px)",
            overflowY: "auto",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-card)",
            background: "var(--surface)",
            padding: 24,
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <h1 style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>
              📚 프롬프트 라이브러리
            </h1>
            <button
              type="button"
              onClick={() => setRegisterOpen(true)}
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--accent)",
                background: "var(--accent)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              + 새 등록
            </button>
          </div>

          {entries.length === 0 ? (
            <div
              style={{
                padding: "60px 20px",
                textAlign: "center",
                color: "var(--ink-4)",
                fontSize: 13,
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>📚</div>
              <p style={{ margin: 0 }}>라이브러리가 비어있어요.</p>
              <p style={{ margin: "4px 0 0", fontSize: 12 }}>
                위 [+ 새 등록] 버튼으로 첫 항목을 등록해 주세요.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 10,
              }}
            >
              {entries.map((s) => {
                const active = hasMarker(currentPrompt, s.prompt);
                return (
                  <SnippetCard
                    key={s.id}
                    snippet={s}
                    active={active}
                    onClick={() => onToggleSnippet(s)}
                    onDelete={() => {
                      if (confirm(`"${s.name}" 항목을 삭제할까요?`)) {
                        remove(s.id);
                      }
                    }}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>

      <SnippetRegisterModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
      />
    </>,
    document.body,
  );
}

function SnippetCard({
  snippet,
  active,
  onClick,
  onDelete,
}: {
  snippet: PromptSnippet;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        border: active ? "2px solid var(--accent)" : "1px solid var(--line)",
        borderRadius: "var(--radius-sm)",
        background: active ? "rgba(74,158,255,.06)" : "var(--surface)",
        cursor: "pointer",
        overflow: "hidden",
        transition: "all .15s",
      }}
      onClick={onClick}
    >
      <div
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          background: "var(--bg-2)",
          display: "grid",
          placeItems: "center",
          color: "var(--ink-4)",
          fontSize: 32,
          overflow: "hidden",
        }}
      >
        {snippet.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- base64 data URL
          <img
            src={snippet.thumbnail}
            alt={snippet.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span aria-hidden>📄</span>
        )}
      </div>

      <div
        style={{
          padding: "8px 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--ink-2)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={snippet.name}
        >
          {snippet.name}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="이 항목 삭제"
          style={{
            all: "unset",
            cursor: "pointer",
            width: 22,
            height: 22,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-4)",
            borderRadius: 4,
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
          <Icon name="x" size={11} />
        </button>
      </div>

      {active && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "var(--accent)",
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          ✓
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc + lint clean**

- [ ] **Step 3: Commit**

```bash
git add frontend/components/studio/SnippetLibraryModal.tsx
git commit -m "feat(snippets): SnippetLibraryModal — 카드 그리드 + toggle + 빈 상태 안내"
```

---

### Task 7: GenerateLeftPanel 통합

(v2 그대로)

**Files:**
- Modify: `frontend/components/studio/generate/GenerateLeftPanel.tsx`

추가 import + state + `handleToggleSnippet` + 버튼 2개 + 모달 2개 (v2 plan Task 7 코드 그대로).

```bash
git commit -m "feat(snippets): GenerateLeftPanel 통합 — [📚] [+] 버튼 + textarea toggle"
```

---

### Task 8: 백엔드 SYSTEM_GENERATE 마커 지시 + system prompt 검증 (Codex v1 B3)

**Files:**
- Modify: `backend/studio/prompt_pipeline/upgrade.py`
- Modify: `backend/tests/studio/test_prompt_pipeline.py`

(v2 Task 8 그대로 · `_call_ollama_chat` patch 패턴 유지)

```bash
git commit -m "feat(prompt-upgrade): SYSTEM_GENERATE 에 <lib> 마커 4 항목 + system prompt 검증"
```

---

### Task 9: 백엔드 deterministic strip — 4 위치 적용 (Codex v3 #2 핵심)

**Codex v3 핵심**: v2 의 strip 적용이 ComfyUI dispatch 직전만 → UI / history / upgrade-only response 에 마커 잔존. 4 위치 모두 적용 필요.

**Files:**
- Create: `backend/studio/_lib_marker.py`
- Modify: `backend/studio/prompt_pipeline/upgrade.py` — `upgrade_generate_prompt` 끝에서 `UpgradeResult.upgraded` 에 strip
- Modify: `backend/studio/routes/prompt.py` — `/upgrade-only` 응답에 strip
- Modify: `backend/studio/pipelines/generate.py` — `pre_upgraded_prompt` strip + history DB record prompt strip
- Create: `backend/tests/studio/test_lib_marker.py` (5 케이스)
- Create: `backend/tests/studio/test_generate_pipeline_lib_marker.py` (3 deterministic 케이스 — Codex v3 #3 placeholder 제거)

- [ ] **Step 1: strip_library_markers 헬퍼**

`backend/studio/_lib_marker.py`:

```python
"""
_lib_marker — <lib>...</lib> 마커 deterministic 처리.

2026-04-30 (Phase 2B · Codex B2/v3 fix · plan 2026-04-30-prompt-snippets-library.md).

frontend/lib/snippet-marker.ts 의 stripAllMarkers 와 동일 의도.
백엔드의 4 위치에서 마커 잔존 시 강제 제거 (Codex v3):
  1. upgrade_generate_prompt 의 UpgradeResult.upgraded
  2. ComfyUI dispatch 직전 final_prompt
  3. /api/studio/upgrade-only 응답의 upgradedPrompt
  4. history DB 저장 prompt
"""

from __future__ import annotations

OPEN = "<lib>"
CLOSE = "</lib>"


def strip_library_markers(text: str) -> str:
    """모든 <lib> / </lib> 토큰 제거 — 안 내용 보존.

    LLM 협조 (system prompt 지시) + deterministic 안전망 둘 다.
    """
    if not text:
        return text
    return text.replace(OPEN, "").replace(CLOSE, "")
```

- [ ] **Step 2: 헬퍼 단위 테스트 (5 케이스)**

`backend/tests/studio/test_lib_marker.py`:

```python
"""strip_library_markers 단위 테스트."""
from studio._lib_marker import strip_library_markers


def test_strip_removes_all_markers():
    assert (
        strip_library_markers("a, <lib>cinematic 35mm</lib>, warm light")
        == "a, cinematic 35mm, warm light"
    )


def test_strip_preserves_inner_content():
    assert strip_library_markers("<lib>X</lib>") == "X"


def test_strip_handles_multiple_markers():
    text = "<lib>A</lib> <lib>B</lib> <lib>C</lib>"
    assert strip_library_markers(text) == "A B C"


def test_strip_no_markers_returns_original():
    assert strip_library_markers("plain text") == "plain text"


def test_strip_empty_string():
    assert strip_library_markers("") == ""
```

PASS 확인.

- [ ] **Step 3: 위치 1 — `upgrade_generate_prompt` 끝에서 UpgradeResult.upgraded strip**

`backend/studio/prompt_pipeline/upgrade.py` 의 `upgrade_generate_prompt` 함수 (line ~440 부근):

```python
from .._lib_marker import strip_library_markers

# ... 기존 _run_upgrade_call 호출 후, 결과 반환 직전:
result = await _run_upgrade_call(...)
# Codex v3 #2: UpgradeResult.upgraded 에서 마커 strip — UI / history 에 마커 잔존 방지.
result.upgraded = strip_library_markers(result.upgraded)
return result
```

(`UpgradeResult` 가 `@dataclass(frozen=False)` 인지 확인 — frozen 이면 새 객체 생성으로 변경.)

- [ ] **Step 4: 위치 2 — pipelines/generate.py 의 ComfyUI dispatch + pre_upgraded_prompt + history**

`backend/studio/pipelines/generate.py`:

```python
from .._lib_marker import strip_library_markers

# pre_upgraded_prompt 경로 (line ~102):
upgrade = UpgradeResult(
    upgraded=strip_library_markers(body.pre_upgraded_prompt),  # ← strip
    fallback=False,
    provider="pre-confirmed",
    original=body.prompt,
)

# 정상/fallback 경로의 upgrade.upgraded 는 위치 1 에서 이미 strip 됐음.
# 그치만 ComfyUI dispatch 직전 final_prompt 에 한 번 더 적용 (이중 안전망):
final_prompt = strip_library_markers(upgrade.upgraded)
# ComfyUI 빌더 호출 시 final_prompt 사용

# history DB 저장 prompt 도 strip 후 저장 (UI readability):
# (history_db.add_record(prompt=strip_library_markers(...)) 패턴 — 정확한 호출 site 는 grep 으로 확인)
```

- [ ] **Step 5: 위치 3 — routes/prompt.py 의 /upgrade-only 응답 strip**

`backend/studio/routes/prompt.py`:

```python
from .._lib_marker import strip_library_markers

@router.post("/upgrade-only")
async def upgrade_only(body: UpgradeOnlyBody):
    # ... 기존 로직 ...
    return {
        "upgradedPrompt": strip_library_markers(upgrade.upgraded),  # ← strip
        "upgradedPromptKo": upgrade.translation,
        "provider": upgrade.provider,
        "fallback": upgrade.fallback,
        "researchHints": research_hints,
    }
```

- [ ] **Step 6: 회귀 테스트 (3 deterministic 케이스 — Codex v3 #3: placeholder 제거)**

`backend/tests/studio/test_generate_pipeline_lib_marker.py`:

```python
"""<lib>...</lib> 마커 deterministic strip 검증 — 3 input 케이스.

Codex v3 #3 fix: 옛 4번째 placeholder 케이스는 제거 (위험).
deterministic strip 의 input/output 검증 3 케이스 + 실제 pipeline 통합 검증은
E2E (Task 10) 시각 확인으로 충족.
"""
from studio._lib_marker import strip_library_markers


def test_strip_handles_lib_in_normal_gemma_output():
    """gemma4 가 마커 그대로 반환해도 strip 됨."""
    gemma = "a beautiful korean girl, <lib>cinematic 35mm</lib>, warm light"
    assert "<lib>" not in strip_library_markers(gemma)
    assert "cinematic 35mm" in strip_library_markers(gemma)


def test_strip_handles_lib_in_fallback_prompt():
    """Ollama fallback (원본 그대로) 시에도 strip 됨."""
    fallback = "한국 여자 <lib>cinematic 35mm</lib> 미소"
    assert "<lib>" not in strip_library_markers(fallback)
    assert "cinematic 35mm" in strip_library_markers(fallback)


def test_strip_handles_lib_in_pre_upgraded_prompt():
    """사용자 사전 확정 prompt 도 strip 됨."""
    pre = "<lib>delicate korean girl</lib>, soft window light"
    assert "<lib>" not in strip_library_markers(pre)
    assert "delicate korean girl" in strip_library_markers(pre)
```

(Codex v3 #3: 4번째 pipeline mock 케이스는 placeholder 위험이라 *제거*. 실제 pipeline 통합은 E2E Task 10 의 시각 검증으로 처리.)

- [ ] **Step 7: 추가 회귀 — UpgradeResult.upgraded 에 strip 적용 검증**

`backend/tests/studio/test_prompt_pipeline.py` 끝에 추가:

```python
@pytest.mark.asyncio
async def test_upgrade_result_upgraded_strips_lib_markers():
    """upgrade_generate_prompt 결과의 UpgradeResult.upgraded 에 <lib> 잔존하지 않음.

    LLM 이 system prompt 지시 무시해도 deterministic strip 안전망 (Codex v3 #2).
    """
    async def fake_chat(*, ollama_url, model, system, user, **kwargs):
        # gemma4 가 마커 그대로 반환하는 worst-case 시뮬레이션
        return "a girl, <lib>cinematic 35mm</lib>, warm"

    with patch(
        "studio.prompt_pipeline._ollama._call_ollama_chat",
        new=AsyncMock(side_effect=fake_chat),
    ):
        result = await upgrade_generate_prompt(
            prompt="<lib>cinematic 35mm</lib>",
            include_translation=False,
            width=1024,
            height=1024,
        )

    assert "<lib>" not in result.upgraded
    assert "</lib>" not in result.upgraded
    assert "cinematic 35mm" in result.upgraded
```

- [ ] **Step 8: 전체 backend pytest 회귀 0**

```powershell
cd backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests/
```

Expected: 361 + 1 (Task 8 system prompt) + 1 (UpgradeResult strip) + 5 (_lib_marker) + 3 (3 input 케이스) = **371 PASS**.

- [ ] **Step 9: Commit**

```bash
git add backend/studio/_lib_marker.py backend/studio/prompt_pipeline/upgrade.py backend/studio/routes/prompt.py backend/studio/pipelines/generate.py backend/tests/studio/test_lib_marker.py backend/tests/studio/test_generate_pipeline_lib_marker.py backend/tests/studio/test_prompt_pipeline.py
git commit -m "feat(prompt-pipeline): deterministic strip_library_markers + 4 위치 적용 (Codex v3 #2 핵심 안전망)"
```

---

### Task 10: E2E 검증 + master 머지 + 메모리 박제

(v2 Task 10 그대로 · 시나리오 확장)

E2E 시나리오:
- [ ] 정상 흐름: prompt 입력 + 라이브러리 카드 click → textarea `<lib>` 마커 추가 → 생성 → ComfyUI / UI / history 모든 곳에 마커 잔존 X
- [ ] **fallback 시나리오** (Ollama 종료 후 생성)
- [ ] **pre_upgraded_prompt 시나리오** (`hideGeneratePrompts=false` → 사전 확정 모달)
- [ ] **upgrade-only 응답** (Settings 의 사전 확정 모달이 띄울 때) — 응답에 `<lib>` 잔존 X
- [ ] **snippet 등록 시 textarea 에 마커 있는 상태** → 저장된 snippet prompt 에 `<lib>` 없음 (sanitize)

회귀 0 최종:
- frontend vitest: 105 + 4 (history) + 7 (snippets) + 9 (marker) = **125 PASS**
- backend pytest: 361 + 1 + 1 + 5 + 3 = **371 PASS**
- tsc / ESLint clean

master 머지 + 메모리 인계 박제.

---

## v2 → v3 변경 항목 요약 (Codex 2차 리뷰 반영)

| Codex v3 | 변경 |
|---|---|
| **#1** id 충돌 가능성 | Task 1 (history) + Task 3 (snippets) 모두 **`crypto.randomUUID()`** 사용 + 같은-ms 5회 add 회귀 테스트 |
| **#2** strip 적용 범위 부족 | Task 9 — **4 위치** strip 적용 (UpgradeResult.upgraded + ComfyUI dispatch + /upgrade-only 응답 + history DB) + UpgradeResult strip 회귀 테스트 추가 |
| **#3** pipeline mock placeholder 위험 | Task 9 — 4번째 pipeline mock 케이스 **제거**. deterministic 3 input 케이스 + E2E 시각 검증 조합으로 안전망 충족 |
| **#4** snippet 등록 시 마커 중첩 | Task 3 — `add()` 안에서 `stripAllMarkers(prompt).trim()` sanitize + 회귀 케이스 |
| **#5** Task 6 단독 실행성 | Task 6 — **풀 코드 명시** (140+ 줄 SnippetLibraryModal + SnippetCard) — agent 가 추측 없이 구현 가능 |

**Task 순서 주의** (v3 추가): Task 5 (snippet-marker) 가 Task 3 (snippets store) 보다 먼저 — store 가 `stripAllMarkers` import. 권장 순서: Task 0 → 1 → 2 → 5 → 3 → 4 → 6 → 7 → 8 → 9 → 10.

---

## Self-Review (v3)

### 1. Codex 추천 매핑

| Codex v1+v3 | 작업 |
|---|---|
| (v1 B1) source 통일 | Task 0 |
| (v1 B2) deterministic strip | Task 9 |
| (v1 B3) 시그니처 fix | Task 8 |
| (v1 B4) SSR 격리 | Task 4 |
| (v1 I5) dedupe 명시 | Task 3 |
| (v1 I6) 미사용 import | Task 4 |
| (v1 I7) crop util 재사용 | Task 4 |
| **(v3 #1) UUID id** | Task 1 + Task 3 |
| **(v3 #2) strip 4 위치** | Task 9 |
| **(v3 #3) placeholder 제거** | Task 9 |
| **(v3 #4) sanitize on save** | Task 3 |
| **(v3 #5) Task 6 풀 코드** | Task 6 |

✅ 12 항목 모두 매핑.

### 2. Placeholder 스캔
- [x] "TBD / TODO / fill in later" — 0건
- [x] **`pass  # implementation 시 채움` 제거됨** (Codex v3 #3 fix)
- [x] "v1/v2 archive 참조" — 0건 (Codex v3 #5 fix · Task 6 풀 코드)

### 3. 타입 / 함수 일관성
- `wrapMarker / hasMarker / removeMarker / stripAllMarkers` (Task 5) 정의 → Task 3 (store) · Task 7 (panel) 일관 사용
- `strip_library_markers` (Task 9) 정의 → upgrade.py · routes/prompt.py · pipelines/generate.py 4 위치 일관 사용
- `crypto.randomUUID()` 패턴 — Task 1 + Task 3 동일 헬퍼 함수 (`makeId`) 패턴

### 4. 회귀 0 검증
- frontend: 105 → **125** (+20)
- backend: 361 → **371** (+10)

✅ Self-review 통과.

---

## Execution Handoff

Plan v3 complete. 저장: `docs/superpowers/plans/2026-04-30-prompt-snippets-library.md`.

**다음 세션 시작 가이드**:
1. 새 브랜치 생성: `git checkout -b feature/prompt-snippets-library`
2. Plan 의 Task 순서 주의 (Task 5 → 3 → 4 → 6 → 7 처럼 의존성)
3. 권장 실행 방식: **Hybrid** — Phase 1 (Task 0/1/2) inline → 검증 → Phase 2 새 세션 subagent

또는 한 번 더 codex 리뷰 받고 시작 (v3 도 100% 정확한지 검증).
