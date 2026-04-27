# QA Checklist

Date: 2026-04-27

## Generate

- Start ComfyUI, open `/generate`, enter a prompt, run generation.
- Expected: stage timeline reaches done, image appears, history item persists after refresh.
- Check: no `mock-seed://` result unless `COMFY_MOCK_FALLBACK=true`.

## Edit

- Open `/edit`, upload a valid image under 20MB, enter an edit instruction, run edit.
- Expected: vision analysis stage completes, result image appears, `sourceRef` is saved for comparison.
- Check: invalid or empty image returns a clear error before ComfyUI dispatch.

## Video

- Open `/video`, upload a valid source image, run a short prompt with Lightning on.
- Expected: video pipeline reaches done, result card plays or opens the saved video.
- Check: ComfyUI sampling does not overlap with a separate vision/compare request.

## Vision

- Open `/vision`, upload one image, run analysis.
- Expected: 9-slot recipe fields populate, width/height/size are shown correctly.
- Check: while a long ComfyUI job is running, request is rejected or delayed by GPU gate instead of overlapping.

## Compare

- From an edit result or `/vision/compare`, run source-vs-result comparison.
- Expected: analysis returns scores/comments and saves only when a valid history item is supplied.
- Check: concurrent compare/vision/ComfyUI work is serialized by the shared GPU gate.

## Regression Commands

```powershell
cd D:\AI-Image-Studio\backend
D:\AI-Image-Studio\.venv\Scripts\python.exe -m ruff check .
D:\AI-Image-Studio\.venv\Scripts\python.exe -m pytest tests

cd D:\AI-Image-Studio\frontend
npm test
npm run lint
npm run build
```
