# Legacy Code (참조용 · 수정 금지)

2026-04-22 전면 재설계 이전의 옛 코드. **active 코드는 없음**.

## 정책 (task #9 · 2026-04-26)
- **수정 금지** — 신규 기능은 `frontend/{components/studio,hooks,stores,lib/api}` 사용
- **참조 only** — 옛 패턴 확인 시 여기서 읽기
- **tsconfig.json `exclude` 등록** — 컴파일 그래프에서 분리 (실수 방지)

## 보존 이유
사용자 의지 (CLAUDE.md memory 명시): 옛 흐름 reference 보존.
삭제하려면 사용자 명시 동의 필요.

## 구조
- `components/` — 옛 Creation/History/Settings 패널 + 페이지 컴포넌트
- `hooks/` — 옛 useGenerate/useEditMode/useEnhance/useModels/useProcessStatus/useWebSocket/useModelPresets
- `stores/` — 옛 useAppStore (466줄) + slices/
- `lib/` — 옛 api.ts / presets.ts

## 신규 → 옛 매핑
| 신규 | 옛 |
|------|-----|
| `app/{generate,edit,video,vision}/page.tsx` | `components/CreationPanel.tsx` 등 |
| `hooks/useGeneratePipeline.ts` | `hooks/useGenerate.ts` |
| `hooks/useEditPipeline.ts` | `hooks/useEditMode.ts` |
| `stores/useGenerateStore.ts` | `stores/useAppStore.ts` (slice 일부) |
| `stores/useHistoryStore.ts` | `stores/slices/historySlice.ts` |
| `lib/api-client.ts` + `lib/api/*` | `lib/api.ts` |
| `lib/model-presets.ts` | `lib/presets.ts` |
