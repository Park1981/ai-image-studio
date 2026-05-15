/**
 * Lab video preset mirror.
 *
 * Backend source of truth: backend/studio/lab_presets.py.
 */

export type LabLoraRole = "lightning" | "adult";

export interface LabLoraOption {
  id: string;
  displayName: string;
  fileName: string;
  defaultStrength: number;
  strengthMin: number;
  strengthMax: number;
  strengthStep: number;
  role: LabLoraRole;
  appliesTo: readonly string[];
  note: string;
}

export interface LabVideoPreset {
  id: string;
  displayName: string;
  tag: string;
  loraOptions: readonly LabLoraOption[];
}

export const LAB_LTX_SULPHUR_PRESET: LabVideoPreset = {
  id: "ltx-sulphur",
  displayName: "LTX 2.3 · Sulphur Lab",
  tag: "LoRA 검증",
  loraOptions: [
    {
      id: "distill_default",
      displayName: "Distill: Default (384)",
      fileName: "ltx-2.3-22b-distilled-lora-384.safetensors",
      defaultStrength: 0.5,
      strengthMin: 0,
      strengthMax: 1.5,
      strengthStep: 0.05,
      role: "lightning",
      appliesTo: ["base", "upscale"],
      note: "production LTX distill baseline",
    },
    {
      id: "distill_sulphur",
      displayName: "Distill: Sulphur (1.1_fro90)",
      fileName:
        "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
      defaultStrength: 0.5,
      strengthMin: 0,
      strengthMax: 1.5,
      strengthStep: 0.05,
      role: "lightning",
      appliesTo: ["base", "upscale"],
      note: "Sulphur distill LoRA",
    },
    {
      id: "adult_eros",
      displayName: "Adult: Eros",
      fileName: "ltx2310eros_beta.safetensors",
      defaultStrength: 0.5,
      strengthMin: 0,
      strengthMax: 1.5,
      strengthStep: 0.05,
      role: "adult",
      appliesTo: ["single"],
      note: "production adult LoRA",
    },
    {
      id: "adult_sulphur",
      displayName: "Adult: Sulphur",
      fileName: "sulphur_lora_rank_768.safetensors",
      defaultStrength: 0.7,
      strengthMin: 0,
      strengthMax: 1.5,
      strengthStep: 0.05,
      role: "adult",
      appliesTo: ["single"],
      note: "Sulphur 2 NSFW finetune LoRA",
    },
  ],
} as const;

export const LAB_VIDEO_PRESETS = [LAB_LTX_SULPHUR_PRESET] as const;

export function getLabVideoPreset(id: string): LabVideoPreset {
  return LAB_VIDEO_PRESETS.find((preset) => preset.id === id) ?? LAB_VIDEO_PRESETS[0];
}

export function getLabLoraOption(id: string): LabLoraOption | undefined {
  return LAB_LTX_SULPHUR_PRESET.loraOptions.find((option) => option.id === id);
}
