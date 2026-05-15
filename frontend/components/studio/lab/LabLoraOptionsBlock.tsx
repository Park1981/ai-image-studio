"use client";

import { SectionAccentBar } from "@/components/studio/StudioResultHeader";
import V5MotionCard from "@/components/studio/V5MotionCard";
import { Toggle } from "@/components/ui/primitives";
import { LAB_LTX_SULPHUR_PRESET } from "@/lib/lab-presets";
import { useVideoLabStore } from "@/stores/useVideoLabStore";

export default function LabLoraOptionsBlock() {
  const activeLoraIds = useVideoLabStore((s) => s.activeLoraIds);
  const loraStrengths = useVideoLabStore((s) => s.loraStrengths);
  const setDistillVariant = useVideoLabStore((s) => s.setDistillVariant);
  const setLoraActive = useVideoLabStore((s) => s.setLoraActive);
  const setLoraStrength = useVideoLabStore((s) => s.setLoraStrength);

  const distillOptions = LAB_LTX_SULPHUR_PRESET.loraOptions.filter(
    (option) => option.role === "lightning",
  );
  const adultOptions = LAB_LTX_SULPHUR_PRESET.loraOptions.filter(
    (option) => option.role === "adult",
  );
  const activeDistill =
    distillOptions.find((option) => activeLoraIds.includes(option.id))?.id ??
    distillOptions[0]?.id;

  return (
    <V5MotionCard className="ais-toggle-card ais-sig-ai" data-active="true">
      <div style={{ display: "grid", gap: 12 }}>
        <div className="ais-field-header" style={{ margin: 0 }}>
          <label
            className="ais-field-label"
            style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}
          >
            <SectionAccentBar accent="violet" />
            Lab LoRA
          </label>
          <span className="mono ais-field-meta">
            {LAB_LTX_SULPHUR_PRESET.displayName}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {distillOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setDistillVariant(option.id)}
              className="ais-ah-nav-link"
              data-active={activeDistill === option.id ? "true" : undefined}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {option.id === "distill_sulphur" ? "Sulphur" : "Default"}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {adultOptions.map((option) => {
            const checked = activeLoraIds.includes(option.id);
            const strength = loraStrengths[option.id] ?? option.defaultStrength;
            return (
              <div key={option.id} style={{ display: "grid", gap: 6 }}>
                <Toggle
                  flat
                  icon="flame"
                  checked={checked}
                  onChange={(v) => setLoraActive(option.id, v)}
                  align="right"
                  label={option.displayName}
                />
                {checked && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="range"
                      min={option.strengthMin}
                      max={option.strengthMax}
                      step={option.strengthStep}
                      value={strength}
                      onChange={(e) =>
                        setLoraStrength(option.id, Number(e.target.value))
                      }
                    />
                    <span className="mono" style={{ fontSize: 11 }}>
                      {strength.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </V5MotionCard>
  );
}
