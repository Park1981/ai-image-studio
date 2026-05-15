# Sulphur LoRA 다운로드 가이드 (Plan A Task 5)

이 파일은 Plan A Phase 1.5 의 사용자 수동 단계 가이드다. Task 5 진입 전 수행한다.

## 1. HuggingFace 페이지

`https://huggingface.co/SulphurAI/Sulphur-2-base`

- gated=false: 로그인 / EULA 동의 불필요
- 브라우저 또는 `huggingface-cli download` 모두 가능

## 2. 받을 파일

| 파일 | 크기 | HF 경로 |
|---|---:|---|
| `sulphur_lora_rank_768.safetensors` | 10.3 GB | root |
| `ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors` | 631 MB | `distill_loras/` |

HF `distill_loras/` subfolder 안에 있어도 basename 만 사용해서 ComfyUI `loras` 루트 폴더에 평탄 배치한다.

## 3. ComfyUI LoRA 디렉토리

권장 위치는 현재 ComfyUI 실행 설정의 LoRA 디렉토리다.

1. `backend/config.py` 의 `comfyui_extra_paths_config` 가 가리키는 `extra_model_paths.yaml` 안의 `loras:` 경로
2. `backend/config.py` 의 `comfyui_base_dir` 가 설정되어 있으면 `<comfyui_base_dir>\models\loras\`
3. ComfyUI Desktop / 외부 ComfyUI 를 직접 쓰는 경우 그 인스턴스의 `models\loras\`

예시:

```text
ComfyUI/models/loras/
├── sulphur_lora_rank_768.safetensors
├── ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors
└── ltx-2.3-22b-distilled-lora-384.safetensors
```

## 4. 다음 단계

두 파일 배치 후 ComfyUI 를 재시작하고 Plan A Task 5 의 capture / verify / runtime smoke 를 실행한다.
